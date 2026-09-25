require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const crypto = require('crypto');

const app = express();

// Stripe webhooks need the raw request body for signature verification, so the
// JSON parser must skip that one route.
app.use((req, res, next) => {
    if (req.originalUrl === '/api/webhooks/stripe') return next();
    return express.json()(req, res, next);
});
app.use(cookieParser());

// -------------------------------------------------------------
// CORS Configuration
// -------------------------------------------------------------
const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5500,http://127.0.0.1:5500,http://localhost:5501,http://127.0.0.1:5501')
    .split(',')
    .map(o => o.trim());

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true
}));

// -------------------------------------------------------------
// Database Connection Pool
// -------------------------------------------------------------
const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'ceekay',
    database: process.env.DB_NAME || 'ceekay_db',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const JWT_SECRET = process.env.JWT_SECRET || 'ceekay_secret_key_change_in_production';
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'ceekay_admin_secret_change_in_production';
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || '';

// Where the frontend is reachable — used to build password-reset links.
const APP_BASE_URL = (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3007}`).replace(/\/$/, '');
const RESET_TOKEN_TTL_MIN = 60;

// -------------------------------------------------------------
// Outbound email (password-reset links, etc.)
// Configure EITHER  SMTP_URL=smtp://user:pass@host:port
//         OR the discrete SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS vars.
// -------------------------------------------------------------
const nodemailer = require('nodemailer');

const MAIL = {
    from: process.env.MAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@ceekay.local',
    configured: !!(process.env.SMTP_URL || (process.env.SMTP_HOST && process.env.SMTP_USER))
};

let mailTransport = null;
if (MAIL.configured) {
    try {
        mailTransport = process.env.SMTP_URL
            ? nodemailer.createTransport(process.env.SMTP_URL)
            : nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: Number(process.env.SMTP_PORT) || 587,
                secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
                auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            });
        mailTransport.verify()
            .then(() => console.log(`✉  Mail transport ready (from: ${MAIL.from})`))
            .catch((e) => console.warn('✉  Mail transport configured but verify() failed:', e.message));
    } catch (e) {
        console.error('✉  Failed to create mail transport:', e.message);
        mailTransport = null;
    }
} else {
    console.log('✉  No SMTP configured — password-reset emails will be logged to the console instead of sent.');
}

async function sendMail({ to, subject, text, html }) {
    if (!mailTransport) return { sent: false, error: 'SMTP not configured' };
    try {
        const info = await mailTransport.sendMail({ from: MAIL.from, to, subject, text, html });
        return { sent: true, id: info.messageId };
    } catch (err) {
        console.error(`✉  send to ${to} failed:`, err.message);
        return { sent: false, error: err.message };
    }
}

// -------------------------------------------------------------
// Payment configuration
// -------------------------------------------------------------
const BANK_TRANSFER = {
    enabled: process.env.BANK_TRANSFER_ENABLED !== 'false',
    accountName: process.env.BANK_ACC_NAME || '',
    bsb: process.env.BANK_BSB || '',
    accountNumber: process.env.BANK_ACC_NUMBER || ''
};
const PAYPAL = {
    enabled: !!process.env.PAYPAL_CLIENT_ID,
    clientId: process.env.PAYPAL_CLIENT_ID || '',
    env: process.env.PAYPAL_ENV || 'sandbox'
};
const STRIPE = {
    enabled: !!(process.env.STRIPE_PUBLISHABLE_KEY && process.env.STRIPE_SECRET_KEY),
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || ''
};
const STRIPE_CURRENCY = (process.env.STRIPE_CURRENCY || 'aud').toLowerCase();
const stripe = STRIPE.enabled ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
if (STRIPE.enabled && String(process.env.STRIPE_SECRET_KEY).startsWith('sk_live_')) {
    console.warn('⚠  Stripe is running with a LIVE key — real cards will be charged.');
}

// -------------------------------------------------------------
// Facebook Page auto-posting (new/published products)
// -------------------------------------------------------------
const FB_PAGE_ID = process.env.FB_PAGE_ID || '';
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN || '';
const FB_CONFIGURED = !!(FB_PAGE_ID && FB_PAGE_ACCESS_TOKEN);
if (FB_CONFIGURED) console.log(`📘 Facebook Page posting ready (page ${FB_PAGE_ID})`);

// Posts a product's photo + caption to the connected Facebook Page. The image
// is uploaded as raw bytes (not a URL) so this works even while the site is
// only reachable at localhost — Facebook never needs to fetch anything from us.
async function postProductToFacebook(product) {
    if (!FB_CONFIGURED) {
        return { posted: false, error: 'Facebook is not connected. Add FB_PAGE_ID and FB_PAGE_ACCESS_TOKEN to .env.' };
    }
    if (/localhost|127\.0\.0\.1/.test(APP_BASE_URL)) {
        return { posted: false, error: 'APP_BASE_URL is still localhost — Facebook (and your customers) can\'t reach it. Deploy the site and set APP_BASE_URL to the public domain first.' };
    }
    try {
        const price = Number(product.base_retail_price || 0).toFixed(2);
        const productUrl = `${APP_BASE_URL}/sproduct.html?id=${encodeURIComponent(product.product_id)}`;
        // No URL in the message itself — the `link` field below is what makes
        // Facebook render a real clickable preview card pointing at the product.
        const message = `${product.title}\n\n$${price} AUD — shop now at Ceekay.`;

        const form = new FormData();
        form.append('message', message);
        form.append('link', productUrl);
        form.append('access_token', FB_PAGE_ACCESS_TOKEN);

        const resp = await fetch(`https://graph.facebook.com/v19.0/${FB_PAGE_ID}/feed`, { method: 'POST', body: form });
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error(data.error?.message || `Facebook API error (${resp.status})`);

        console.log(`📘 Posted "${product.title}" to Facebook (post ${data.id})`);
        return { posted: true, postId: data.id };
    } catch (err) {
        console.error('Facebook post failed:', err.message);
        return { posted: false, error: err.message };
    }
}

// -------------------------------------------------------------
// Instagram auto-posting (via the Instagram Business account linked to
// the same Facebook Page — reuses FB_PAGE_ACCESS_TOKEN, needs the
// instagram_basic + instagram_content_publish permissions on that token).
// -------------------------------------------------------------
const IG_BUSINESS_ACCOUNT_ID = process.env.IG_BUSINESS_ACCOUNT_ID || '';
const IG_CONFIGURED = !!(IG_BUSINESS_ACCOUNT_ID && FB_PAGE_ACCESS_TOKEN);
if (IG_CONFIGURED) console.log(`📸 Instagram posting ready (account ${IG_BUSINESS_ACCOUNT_ID})`);

function toPublicImageUrl(imagePath) {
    if (!imagePath) return null;
    if (/^https?:\/\//i.test(imagePath)) return imagePath;
    return `${APP_BASE_URL}/${String(imagePath).replace(/^\/+/, '')}`;
}

// Unlike Facebook's link-post (which just needs a URL Facebook can crawl for
// an OG preview), Instagram's Graph API needs a direct, publicly-fetchable
// image URL — a two-step create-container-then-publish flow.
async function postProductToInstagram(product) {
    if (!IG_CONFIGURED) {
        return { posted: false, error: 'Instagram is not connected. Add IG_BUSINESS_ACCOUNT_ID to .env (reuses FB_PAGE_ACCESS_TOKEN).' };
    }
    if (/localhost|127\.0\.0\.1/.test(APP_BASE_URL)) {
        return { posted: false, error: 'APP_BASE_URL is still localhost — Instagram needs a publicly reachable image URL. Deploy the site first.' };
    }
    const imageUrl = toPublicImageUrl(product.default_image);
    if (!imageUrl) return { posted: false, error: 'Product has no image to post.' };

    try {
        const price = Number(product.base_retail_price || 0).toFixed(2);
        const productUrl = `${APP_BASE_URL}/sproduct.html?id=${encodeURIComponent(product.product_id)}`;
        const caption = `${product.title}\n\n$${price} AUD — shop now, link in bio.\n${productUrl}`;

        const createResp = await fetch(`https://graph.facebook.com/v19.0/${IG_BUSINESS_ACCOUNT_ID}/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_url: imageUrl, caption, access_token: FB_PAGE_ACCESS_TOKEN })
        });
        const createData = await createResp.json();
        if (!createResp.ok || createData.error) throw new Error(createData.error?.message || `Instagram API error (${createResp.status})`);

        const publishResp = await fetch(`https://graph.facebook.com/v19.0/${IG_BUSINESS_ACCOUNT_ID}/media_publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ creation_id: createData.id, access_token: FB_PAGE_ACCESS_TOKEN })
        });
        const publishData = await publishResp.json();
        if (!publishResp.ok || publishData.error) throw new Error(publishData.error?.message || `Instagram publish error (${publishResp.status})`);

        console.log(`📸 Posted "${product.title}" to Instagram (media ${publishData.id})`);
        return { posted: true, postId: publishData.id };
    } catch (err) {
        console.error('Instagram post failed:', err.message);
        return { posted: false, error: err.message };
    }
}

// Runs every minute: fires off anything scheduled for now-or-earlier.
async function runDueScheduledPosts() {
    try {
        const [due] = await pool.query(
            `SELECT sp.id AS schedule_id, sp.platforms, p.product_id, p.title, p.base_retail_price, p.default_image
             FROM scheduled_posts sp
             JOIN products p ON p.product_id = sp.product_id
             WHERE sp.status = 'pending' AND sp.scheduled_at <= NOW()
             LIMIT 20`
        );
        for (const row of due) {
            const platforms = row.platforms.split(',');
            const results = {};
            if (platforms.includes('facebook')) results.facebook = await postProductToFacebook(row);
            if (platforms.includes('instagram')) results.instagram = await postProductToInstagram(row);

            const allOk = Object.values(results).every(r => r.posted);
            await pool.query(
                'UPDATE scheduled_posts SET status = ?, result = ? WHERE id = ?',
                [allOk ? 'posted' : 'failed', JSON.stringify(results), row.schedule_id]
            );
        }
    } catch (err) {
        console.error('Scheduled post worker error:', err.message);
    }
}
setInterval(runDueScheduledPosts, 60 * 1000);

// What the checkout UI is allowed to offer. card + googlepay both ride on Stripe.
function enabledPaymentMethods() {
    const list = [];
    if (BANK_TRANSFER.enabled && BANK_TRANSFER.bsb && BANK_TRANSFER.accountNumber) list.push('bank_transfer');
    if (PAYPAL.enabled) list.push('paypal');
    if (STRIPE.enabled) { list.push('card'); list.push('googlepay'); }
    return list;
}

function authCookieOptions() {
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000
    };
}

// ===============================================================
// AUTH MIDDLEWARE
// ===============================================================
const auth = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: 'Invalid token' });
    }
};

// Populates req.user when a valid session cookie is present, but does NOT
// reject the request when it isn't — for endpoints that serve both guests
// and logged-in users (e.g. GET /api/cart).
const optionalAuth = (req, res, next) => {
    const token = req.cookies.token;
    if (token) {
        try { req.user = jwt.verify(token, JWT_SECRET); } catch { /* ignore invalid/expired token */ }
    }
    next();
};

const requireAdmin = (req, res, next) => {
    const token = req.cookies.admin_token;
    if (!token) return res.status(401).json({ error: 'Admin login required' });
    try {
        req.admin = jwt.verify(token, ADMIN_JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: 'Invalid or expired admin session' });
    }
};

const requireOwner = (req, res, next) => {
    if (!req.admin || req.admin.role !== 'owner') {
        return res.status(403).json({ error: 'Only the store owner can do this' });
    }
    next();
};

const requireBotOrAdmin = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (SCRAPER_API_KEY && apiKey && apiKey === SCRAPER_API_KEY) {
        req.isBot = true;
        return next();
    }
    return requireAdmin(req, res, next);
};

async function logAudit(admin, action, details) {
    try {
        await pool.query(
            'INSERT INTO admin_audit_log (admin_id, admin_email, action, details) VALUES (?, ?, ?, ?)',
            [admin?.id || null, admin?.email || 'scraper-bot', action, JSON.stringify(details || {})]
        );
    } catch (err) {
        console.error('Failed to write audit log:', err.message);
    }
}

// ===============================================================
// PASSWORD RESET HELPERS (shared by customer + admin flows)
// ===============================================================
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// Small in-memory throttle for the forgot-password endpoints:
// max 5 requests per key (email+ip) per 15 minutes.
const forgotHits = new Map();
function forgotRateLimited(key) {
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;
    const recent = (forgotHits.get(key) || []).filter((t) => now - t < windowMs);
    recent.push(now);
    forgotHits.set(key, recent);
    return recent.length > 5;
}

// Create a single-use reset token, invalidating any earlier unused ones.
// Returns the raw token (only the sha256 hash is stored).
async function issuePasswordReset(userType, userId) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MIN * 60 * 1000);
    await pool.query(
        'UPDATE password_resets SET used_at = NOW() WHERE user_type = ? AND user_id = ? AND used_at IS NULL',
        [userType, userId]
    );
    await pool.query(
        'INSERT INTO password_resets (user_type, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)',
        [userType, userId, sha256(rawToken), expiresAt]
    );
    return rawToken;
}

// Validate + burn a reset token. Returns the user_id, or null if bad/expired/used.
async function consumePasswordReset(userType, rawToken) {
    if (!rawToken) return null;
    const [rows] = await pool.query(
        'SELECT * FROM password_resets WHERE user_type = ? AND token_hash = ? LIMIT 1',
        [userType, sha256(rawToken)]
    );
    const row = rows[0];
    if (!row || row.used_at || new Date(row.expires_at) < new Date()) return null;
    await pool.query('UPDATE password_resets SET used_at = NOW() WHERE id = ?', [row.id]);
    return row.user_id;
}

// Optional email delivery. Enabled only when SMTP_URL is set and the
// `nodemailer` package is installed; otherwise the caller falls back to
// logging / returning the link in development.
async function sendResetEmail(to, resetUrl, audience) {
    const who = audience === 'admin' ? 'Ceekay admin' : 'Ceekay';
    const result = await sendMail({
        to,
        subject: `Reset your ${who} password`,
        text:
            `We received a request to reset your ${who} password.\n\n` +
            `Open this link within ${RESET_TOKEN_TTL_MIN} minutes to choose a new one:\n${resetUrl}\n\n` +
            `If you didn't request this, you can safely ignore this email.`,
        html:
            `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#333">
                <h2 style="color:#b88a44;margin:0 0 12px">Reset your password</h2>
                <p>We received a request to reset your <strong>${who}</strong> password.</p>
                <p style="margin:24px 0">
                    <a href="${resetUrl}" style="background:#b88a44;color:#fff;text-decoration:none;padding:12px 26px;border-radius:24px;display:inline-block;font-weight:bold">Choose a new password</a>
                </p>
                <p style="font-size:13px;color:#777">This link expires in ${RESET_TOKEN_TTL_MIN} minutes. If the button doesn't work, paste this URL into your browser:<br>
                    <span style="word-break:break-all">${resetUrl}</span></p>
                <p style="font-size:13px;color:#777">If you didn't request this, you can safely ignore this email.</p>
            </div>`
    });
    if (result.sent) console.log(`✉  reset email sent to ${to} (${result.id})`);
    return result; // { sent, error?, id? }
}

// Health Check
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Which payment methods the checkout should show, plus the public bits each needs.
app.get('/api/payment-config', (req, res) => {
    const methods = enabledPaymentMethods();
    res.json({
        methods,
        bankTransfer: methods.includes('bank_transfer')
            ? { accountName: BANK_TRANSFER.accountName, bsb: BANK_TRANSFER.bsb, accountNumber: BANK_TRANSFER.accountNumber }
            : null,
        paypal: PAYPAL.enabled ? { clientId: PAYPAL.clientId, env: PAYPAL.env } : null,
        stripe: STRIPE.enabled ? { publishableKey: STRIPE.publishableKey } : null
    });
});

// ===============================================================
// 1. CUSTOMER AUTHENTICATION
// ===============================================================
app.post('/api/auth/register', async (req, res) => {
    console.log('--- REGISTER ATTEMPT ---', req.body);
    const { email, password, name, address, street, city, state, postcode, newsletterOptIn } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const finalStreet = street || address?.street || null;
    const finalCity = city || address?.city || null;
    const finalState = state || address?.state || null;
    const finalPostcode = postcode || address?.postcode || null;

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const [result] = await pool.query(
            'INSERT INTO users (email, password_hash, name, street, city, state, postcode, newsletter_opt_in) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [email, hashedPassword, name || null, finalStreet, finalCity, finalState, finalPostcode, !!newsletterOptIn]
        );

        const userId = result.insertId;
        const token = jwt.sign({ id: userId, email, name }, JWT_SECRET, { expiresIn: '7d' });

        res.cookie('token', token, authCookieOptions());
        res.json({ ok: true, user: { id: userId, email, name } });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An account with this email already exists.', code: 'EMAIL_EXISTS' });
        if (err.code === 'ER_NO_SUCH_TABLE') return res.status(500).json({ error: 'Database tables are not set up yet. Run schema.sql.' });
        console.error('Registration Error:', err);
        res.status(500).json({ error: err.message || 'Registration failed' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        const user = users[0];

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
        res.cookie('token', token, authCookieOptions());
        res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name } });
    } catch (err) {
        if (err.code === 'ER_NO_SUCH_TABLE') return res.status(500).json({ error: 'Database tables are not set up yet. Run schema.sql.' });
        console.error('Login Error:', err);
        res.status(500).json({ error: err.message || 'Login failed' });
    }
});

app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('token', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));

// --- Forgot / reset password (customer) ---
app.post('/api/auth/forgot-password', async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email is required' });
    if (forgotRateLimited(`c:${email}:${req.ip}`)) {
        return res.status(429).json({ error: 'Too many requests. Please wait a few minutes and try again.' });
    }

    // Same response whether or not the account exists (no user enumeration).
    const generic = { ok: true, message: "If an account exists for that email, we've sent a reset link." };
    try {
        const [users] = await pool.query('SELECT id, email FROM users WHERE email = ?', [email]);
        const user = users[0];
        if (!user) return res.json(generic);

        const rawToken = await issuePasswordReset('customer', user.id);
        const resetUrl = `${APP_BASE_URL}/reset-password.html?token=${rawToken}`;
        console.log(`[password-reset] customer <${email}>: ${resetUrl}`);
        const mail = await sendResetEmail(user.email, resetUrl, 'customer');

        const body = { ...generic };
        if (process.env.NODE_ENV !== 'production') {
            body.emailSent = mail.sent;
            if (mail.error) body.emailError = mail.error;
            if (!mail.sent) body.resetUrl = resetUrl; // dev fallback when no mail delivery
        }
        res.json(body);
    } catch (err) {
        if (err.code === 'ER_NO_SUCH_TABLE') {
            return res.status(500).json({ error: 'Run migrations-add-password-resets.sql first.' });
        }
        console.error('forgot-password error:', err);
        res.status(500).json({ error: 'Could not process the request' });
    }
});

app.post('/api/auth/reset-password', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and new password are required' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    try {
        const userId = await consumePasswordReset('customer', token);
        if (!userId) return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });

        const hash = await bcrypt.hash(password, 10);
        await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, userId]);
        res.json({ ok: true, message: 'Password updated. You can now log in.' });
    } catch (err) {
        console.error('reset-password error:', err);
        res.status(500).json({ error: 'Could not reset the password' });
    }
});

// ===============================================================
// 2. PRODUCTS
// ===============================================================
app.get('/api/products', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM products WHERE active = TRUE');
        const products = rows.map(row => ({
            ...row,
            variants: typeof row.variants === 'string' ? JSON.parse(row.variants) : row.variants
        }));
        res.json(products);
    } catch (err) {
        console.error('Failed to fetch products from DB:', err.message);
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

app.get('/api/products/:id', async (req, res) => {
    try {
        const [products] = await pool.query('SELECT * FROM products WHERE product_id = ?', [req.params.id]);
        if (!products[0]) return res.status(404).json({ error: 'Product not found' });

        const [images] = await pool.query(
            'SELECT image_url FROM product_images WHERE product_id = ? ORDER BY display_order ASC',
            [req.params.id]
        );

        res.json({ product: products[0], images: images.map(img => img.image_url) });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch product details' });
    }
});

app.post('/api/admin/products', requireBotOrAdmin, async (req, res) => {
    const { productId, productName, price, imageUrl, category, variants, description, stockQuantity } = req.body;
    if (!productId || !productName) return res.status(400).json({ error: 'productId and productName required' });

    try {
        const [result] = await pool.query(
            `INSERT INTO products (product_id, title, category, description, base_retail_price, default_image, variants, stock_quantity)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE title = VALUES(title), category = VALUES(category),
                description = VALUES(description), base_retail_price = VALUES(base_retail_price),
                default_image = VALUES(default_image), variants = VALUES(variants),
                stock_quantity = VALUES(stock_quantity)`,
            [productId, productName, category || null, description || null, price || 0, imageUrl || null, JSON.stringify(variants || []), stockQuantity ?? 0]
        );
        await logAudit(req.admin, 'product.upsert', { productId, productName, viaBot: !!req.isBot });

        // MySQL's upsert affectedRows: 1 = a brand-new row was inserted.
        let facebookPost = null;
        if (result.affectedRows === 1) {
            facebookPost = await postProductToFacebook({
                product_id: productId, title: productName,
                base_retail_price: price || 0, default_image: imageUrl
            });
        }
        res.json({ ok: true, facebookPost });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to save product' });
    }
});

app.get('/api/admin/products', requireAdmin, async (req, res) => {
    try {
        let soldByProduct = {};
        try {
            const [sold] = await pool.query(
                `SELECT oi.product_id, SUM(oi.quantity) AS units_sold
                 FROM order_items oi JOIN orders o ON o.id = oi.order_id
                 WHERE o.status <> 'cancelled'
                 GROUP BY oi.product_id`
            );
            soldByProduct = Object.fromEntries(sold.map(r => [r.product_id, Number(r.units_sold)]));
        } catch (_) { /* order tables may not exist yet */ }

        const [rows] = await pool.query('SELECT * FROM products ORDER BY updated_at DESC');
        res.json(rows.map(row => ({
            ...row,
            variants: typeof row.variants === 'string' ? JSON.parse(row.variants) : row.variants,
            units_sold: soldByProduct[row.product_id] || 0
        })));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

// Full detail for one product: row + parsed variants + gallery + sales stats.
app.get('/api/admin/products/:id', requireAdmin, async (req, res) => {
    try {
        const [[product]] = await pool.query('SELECT * FROM products WHERE product_id = ?', [req.params.id]);
        if (!product) return res.status(404).json({ error: 'Product not found' });
        product.variants = typeof product.variants === 'string'
            ? JSON.parse(product.variants || '[]') : (product.variants || []);

        const [imgRows] = await pool.query(
            'SELECT image_url FROM product_images WHERE product_id = ? ORDER BY display_order ASC', [req.params.id]
        );

        let stats = { units_sold: 0, gross_revenue: 0, order_count: 0, last_ordered: null };
        try {
            const [[s]] = await pool.query(
                `SELECT COALESCE(SUM(oi.quantity), 0)              AS units_sold,
                        COALESCE(SUM(oi.quantity * oi.price), 0)   AS gross_revenue,
                        COUNT(DISTINCT oi.order_id)                AS order_count,
                        MAX(o.created_at)                          AS last_ordered
                 FROM order_items oi
                 JOIN orders o ON o.id = oi.order_id
                 WHERE oi.product_id = ? AND o.status <> 'cancelled'`,
                [req.params.id]
            );
            stats = s;
        } catch (_) { /* order tables may not exist yet */ }

        res.json({ product, images: imgRows.map(r => r.image_url), stats });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch product' });
    }
});

// Replace a product's whole gallery with an ordered list of URLs.
app.put('/api/admin/products/:id/images', requireAdmin, async (req, res) => {
    const images = Array.isArray(req.body.images)
        ? req.body.images.map(s => String(s).trim()).filter(Boolean) : [];
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        await conn.query('DELETE FROM product_images WHERE product_id = ?', [req.params.id]);
        for (let i = 0; i < images.length; i++) {
            await conn.query(
                'INSERT INTO product_images (product_id, image_url, display_order) VALUES (?, ?, ?)',
                [req.params.id, images[i], i]
            );
        }
        if (images[0]) {
            await conn.query('UPDATE products SET default_image = ? WHERE product_id = ?', [images[0], req.params.id]);
        }
        await conn.commit();
        await logAudit(req.admin, 'product.images_update', { productId: req.params.id, count: images.length });
        res.json({ ok: true, images });
    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.status(500).json({ error: 'Failed to update images' });
    } finally {
        conn.release();
    }
});

app.patch('/api/admin/products/:id', requireAdmin, async (req, res) => {
    const { title, category, description, vendor_url, base_retail_price, default_image, stock_quantity, active, variants } = req.body;
    const fields = [];
    const values = [];
    const map = { title, category, description, vendor_url, base_retail_price, default_image, stock_quantity, active };
    for (const [key, val] of Object.entries(map)) {
        if (val !== undefined) { fields.push(`${key} = ?`); values.push(val); }
    }
    if (variants !== undefined) { fields.push('variants = ?'); values.push(JSON.stringify(variants)); }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    // Detect a hidden -> published transition before we overwrite it, so we
    // know whether this update is the one that should announce the product.
    let wasInactive = false;
    if (active !== undefined) {
        const [[prior]] = await pool.query('SELECT active FROM products WHERE product_id = ?', [req.params.id]);
        wasInactive = !!prior && !prior.active;
    }

    values.push(req.params.id);
    try {
        await pool.query(`UPDATE products SET ${fields.join(', ')} WHERE product_id = ?`, values);
        await logAudit(req.admin, 'product.update', { productId: req.params.id, fields: Object.keys(map).filter(k => map[k] !== undefined) });

        let facebookPost = null;
        if (wasInactive && (active === true || active === 1 || active === '1')) {
            const [[product]] = await pool.query('SELECT * FROM products WHERE product_id = ?', [req.params.id]);
            facebookPost = await postProductToFacebook(product);
        }
        res.json({ ok: true, facebookPost });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update product' });
    }
});

// Manual/on-demand post — lets the owner (re)announce any product on request.
app.post('/api/admin/products/:id/post-to-facebook', requireAdmin, async (req, res) => {
    try {
        const [[product]] = await pool.query('SELECT * FROM products WHERE product_id = ?', [req.params.id]);
        if (!product) return res.status(404).json({ error: 'Product not found' });

        const result = await postProductToFacebook(product);
        if (!result.posted) return res.status(400).json({ error: result.error });

        await logAudit(req.admin, 'product.facebook_post', { productId: req.params.id, postId: result.postId });
        res.json({ ok: true, postId: result.postId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to post to Facebook' });
    }
});

app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM products WHERE product_id = ?', [req.params.id]);
        await logAudit(req.admin, 'product.delete', { productId: req.params.id });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete product' });
    }
});

// Queue a product to auto-post to Facebook / Instagram at a future time —
// picked up by runDueScheduledPosts() once a minute.
app.post('/api/admin/products/:id/schedule-post', requireAdmin, async (req, res) => {
    const { scheduledAt, facebook, instagram } = req.body;
    if (!scheduledAt) return res.status(400).json({ error: 'scheduledAt is required' });

    const when = new Date(scheduledAt);
    if (Number.isNaN(when.getTime())) return res.status(400).json({ error: 'Invalid date/time' });

    const platforms = [facebook ? 'facebook' : null, instagram ? 'instagram' : null].filter(Boolean);
    if (platforms.length === 0) return res.status(400).json({ error: 'Choose at least one platform' });

    try {
        const [[product]] = await pool.query('SELECT product_id FROM products WHERE product_id = ?', [req.params.id]);
        if (!product) return res.status(404).json({ error: 'Product not found' });

        const [result] = await pool.query(
            'INSERT INTO scheduled_posts (product_id, platforms, scheduled_at, created_by) VALUES (?, ?, ?, ?)',
            [req.params.id, platforms.join(','), when, req.admin.id]
        );
        await logAudit(req.admin, 'product.schedule_post', { productId: req.params.id, platforms, scheduledAt: when });
        res.json({ ok: true, id: result.insertId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to schedule post' });
    }
});

app.get('/api/admin/scheduled-posts', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT sp.id, sp.product_id, sp.platforms, sp.scheduled_at, sp.status, sp.result, sp.created_at,
                    p.title AS product_title, p.default_image
             FROM scheduled_posts sp
             JOIN products p ON p.product_id = sp.product_id
             ORDER BY sp.scheduled_at DESC
             LIMIT 200`
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to load scheduled posts' });
    }
});

app.delete('/api/admin/scheduled-posts/:id', requireAdmin, async (req, res) => {
    try {
        const [result] = await pool.query(
            "UPDATE scheduled_posts SET status = 'cancelled' WHERE id = ? AND status = 'pending'",
            [req.params.id]
        );
        if (result.affectedRows === 0) return res.status(400).json({ error: 'Only pending scheduled posts can be cancelled' });
        await logAudit(req.admin, 'scheduled_post.cancel', { id: req.params.id });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to cancel scheduled post' });
    }
});

// ===============================================================
// 3. SCRAPE JOB QUEUE
// ===============================================================
app.post('/api/admin/scrape-jobs', requireAdmin, async (req, res) => {
    const { vendor_url } = req.body;
    if (!vendor_url) return res.status(400).json({ error: 'vendor_url required' });
    try {
        const [result] = await pool.query(
            'INSERT INTO scrape_jobs (vendor_url, requested_by) VALUES (?, ?)',
            [vendor_url, req.admin.id]
        );
        await logAudit(req.admin, 'scrape_job.create', { vendor_url });
        res.json({ ok: true, jobId: result.insertId });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create scrape job' });
    }
});

app.get('/api/admin/scrape-jobs', requireAdmin, async (req, res) => {
    const { status } = req.query;
    try {
        const [rows] = status
            ? await pool.query('SELECT * FROM scrape_jobs WHERE status = ? ORDER BY created_at DESC', [status])
            : await pool.query('SELECT * FROM scrape_jobs ORDER BY created_at DESC LIMIT 200');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch scrape jobs' });
    }
});

app.get('/api/admin/scrape-jobs/next', requireBotOrAdmin, async (req, res) => {
    try {
        const [pending] = await pool.query(
            "SELECT * FROM scrape_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1"
        );
        if (!pending[0]) return res.json({ job: null });

        const [result] = await pool.query(
            "UPDATE scrape_jobs SET status = 'processing' WHERE id = ? AND status = 'pending'",
            [pending[0].id]
        );
        if (result.affectedRows === 0) return res.json({ job: null });

        res.json({ job: { ...pending[0], status: 'processing' } });
    } catch (err) {
        res.status(500).json({ error: 'Failed to claim scrape job' });
    }
});

app.post('/api/admin/scrape-jobs/:id/complete', requireBotOrAdmin, async (req, res) => {
    const { success, productId, errorMessage } = req.body;
    try {
        await pool.query(
            "UPDATE scrape_jobs SET status = ?, result_product_id = ?, error_message = ? WHERE id = ?",
            [success ? 'done' : 'failed', productId || null, errorMessage || null, req.params.id]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update scrape job' });
    }
});

// ===============================================================
// 4. CART
// ===============================================================
async function getOrCreateCart(userId) {
    const [carts] = await pool.query('SELECT id FROM carts WHERE user_id = ?', [userId]);
    if (carts[0]) return carts[0].id;
    const [result] = await pool.query('INSERT INTO carts (user_id) VALUES (?)', [userId]);
    return result.insertId;
}

app.get('/api/cart', optionalAuth, async (req, res) => {
    try {
        const userId = req.user?.id || req.session?.userId;
        if (!userId) {
            return res.status(200).json({ items: [] });
        }

        const [carts] = await pool.query('SELECT id FROM carts WHERE user_id = ?', [userId]);
        if (carts.length === 0) {
            return res.status(200).json({ items: [] });
        }

        const cartId = carts[0].id;
        const [items] = await pool.query('SELECT * FROM cart_items WHERE cart_id = ?', [cartId]);
        
        return res.status(200).json({ items });
    } catch (err) {
        console.error('API Cart Error:', err.message);
        return res.status(200).json({ items: [], error: err.message });
    }
});

app.post('/api/cart/items', auth, async (req, res) => {
    const { productId, productName, price, imageUrl, quantity } = req.body;
    try {
        const cartId = await getOrCreateCart(req.user.id);
        const qty = quantity || 1;
        await pool.query(
            `INSERT INTO cart_items (cart_id, product_id, product_name, price, image_url, quantity)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
            [cartId, productId, productName, price, imageUrl, qty]
        );
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to add item to cart' });
    }
});

app.patch('/api/cart/items/:productId', auth, async (req, res) => {
    const { quantity } = req.body;
    try {
        const cartId = await getOrCreateCart(req.user.id);
        await pool.query('UPDATE cart_items SET quantity = ? WHERE cart_id = ? AND product_id = ?', [quantity, cartId, req.params.productId]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update quantity' });
    }
});

app.delete('/api/cart/items/:productId', auth, async (req, res) => {
    try {
        const cartId = await getOrCreateCart(req.user.id);
        await pool.query('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?', [cartId, req.params.productId]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to remove item' });
    }
});

app.post('/api/cart/merge', auth, async (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.json({ ok: true });
    try {
        const cartId = await getOrCreateCart(req.user.id);
        for (const item of items) {
            await pool.query(
                `INSERT INTO cart_items (cart_id, product_id, product_name, price, image_url, quantity)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
                [cartId, item.productId, item.productName, item.price, item.imageUrl, item.quantity]
            );
        }
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to merge cart' });
    }
});

app.post('/api/cart/apply-coupon', auth, async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Coupon code required' });
    try {
        const [coupons] = await pool.query(
            'SELECT * FROM coupons WHERE code = ? AND active = TRUE AND (expires_at IS NULL OR expires_at > NOW())',
            [code]
        );
        if (!coupons[0]) return res.status(404).json({ error: 'Invalid or expired coupon' });

        const cartId = await getOrCreateCart(req.user.id);
        await pool.query('UPDATE carts SET coupon_code = ? WHERE id = ?', [code, cartId]);
        res.json({ ok: true, coupon: coupons[0] });
    } catch (err) {
        res.status(500).json({ error: 'Failed to apply coupon' });
    }
});

// ===============================================================
// 5. CHECKOUT & ORDERS
// ===============================================================
app.post('/api/orders/checkout', auth, async (req, res) => {
    const paymentMethod = String(req.body.paymentMethod || 'card');
    if (!enabledPaymentMethods().includes(paymentMethod)) {
        return res.status(400).json({
            error: paymentMethod === 'paypal'
                ? 'PayPal is not connected yet. Add PAYPAL_CLIENT_ID to enable it.'
                : (paymentMethod === 'card' || paymentMethod === 'googlepay')
                    ? 'Card / Google Pay is not connected yet. Add your Stripe keys to enable it.'
                    : 'That payment method is not available.'
        });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [carts] = await connection.query('SELECT * FROM carts WHERE user_id = ?', [req.user.id]);
        if (!carts[0]) { await connection.rollback(); return res.status(400).json({ error: 'Cart is empty' }); }

        const [items] = await connection.query('SELECT * FROM cart_items WHERE cart_id = ?', [carts[0].id]);
        if (items.length === 0) { await connection.rollback(); return res.status(400).json({ error: 'Cart is empty' }); }

        const isStripe = paymentMethod === 'card' || paymentMethod === 'googlepay';

        // A user can only have one Stripe payment pending at a time. Otherwise two
        // checkouts from the same (unchanged-until-paid) cart — two tabs, or a retry
        // after abandoning the first — would each reserve stock for the same items.
        // Superseding the old one here (and giving its stock back) keeps that 1:1.
        if (isStripe) {
            const [pending] = await connection.query(
                `SELECT id FROM orders WHERE user_id = ? AND payment_status = 'awaiting_payment'
                 AND payment_method IN ('card', 'googlepay') FOR UPDATE`,
                [req.user.id]
            );
            for (const p of pending) {
                await releaseOrderStock(connection, p.id);
                await connection.query("UPDATE orders SET payment_status = 'failed', status = 'cancelled' WHERE id = ?", [p.id]);
            }
        }

        // Lock the product rows (in a stable order, so two concurrent checkouts that
        // overlap on products can't deadlock on each other) and verify there's enough
        // stock before an order — and a Stripe session — gets created for it.
        const sortedItems = [...items].sort((a, b) => String(a.product_id).localeCompare(String(b.product_id)));
        for (const item of sortedItems) {
            const [[product]] = await connection.query(
                'SELECT stock_quantity FROM products WHERE product_id = ? FOR UPDATE', [item.product_id]
            );
            if (!product || product.stock_quantity < item.quantity) {
                await connection.rollback();
                return res.status(409).json({
                    error: `Not enough stock for "${item.product_name || item.product_id}" (${product ? product.stock_quantity : 0} left).`
                });
            }
        }

        const subtotal = items.reduce((sum, item) => sum + (Number(item.price) * item.quantity), 0);

        let discount = 0;
        let couponCode = null;
        if (carts[0].coupon_code) {
            const [coupons] = await connection.query(
                'SELECT * FROM coupons WHERE code = ? AND active = TRUE AND (expires_at IS NULL OR expires_at > NOW())',
                [carts[0].coupon_code]
            );
            if (coupons[0]) {
                couponCode = coupons[0].code;
                if (coupons[0].discount_percent) discount = subtotal * (Number(coupons[0].discount_percent) / 100);
                else if (coupons[0].discount_amount) discount = Number(coupons[0].discount_amount);
                discount = Math.min(discount, subtotal);
            }
        }
        const total = subtotal - discount;

        const [orderResult] = await connection.query(
            `INSERT INTO orders (user_id, total_amount, discount_amount, coupon_code, payment_method, payment_status, status)
             VALUES (?, ?, ?, ?, ?, 'awaiting_payment', 'pending')`,
            [req.user.id, total, discount, couponCode, paymentMethod]
        );
        const orderId = orderResult.insertId;
        const reference = `CK-${orderId}`;
        await connection.query('UPDATE orders SET payment_reference = ? WHERE id = ?', [reference, orderId]);

        for (const item of items) {
            await connection.query(
                'INSERT INTO order_items (order_id, product_id, product_name, price, quantity) VALUES (?, ?, ?, ?, ?)',
                [orderId, item.product_id, item.product_name, item.price, item.quantity]
            );
            // Stock is reserved as soon as the order exists — for every payment method,
            // not just Stripe — so a second checkout can't sell the same units while
            // this one is still awaiting payment. Reservations are given back by
            // releaseOrderStock() if the order is cancelled, or Stripe payment fails/expires.
            await connection.query(
                'UPDATE products SET stock_quantity = stock_quantity - ? WHERE product_id = ?',
                [item.quantity, item.product_id]
            );
        }

        if (!isStripe) {
            await connection.query('DELETE FROM cart_items WHERE cart_id = ?', [carts[0].id]);
            await connection.query('UPDATE carts SET coupon_code = NULL WHERE id = ?', [carts[0].id]);
        }

        await connection.commit();

        if (isStripe) {
            // Nothing to charge (e.g. a 100%-off coupon) — there's no Stripe session to
            // create, so finalize the order immediately instead of calling Stripe.
            if (total <= 0) {
                await finalizePaidOrder(orderId);
                return res.json({ ok: true, orderId, reference, total: 0, paymentMethod, redirectUrl: `${APP_BASE_URL}/order-complete.html?free=1` });
            }
            try {
                const [[userRow]] = await pool.query('SELECT email FROM users WHERE id = ?', [req.user.id]);
                const session = await stripe.checkout.sessions.create({
                    mode: 'payment',
                    payment_method_types: ['card'], // Google Pay / Apple Pay ride on this automatically
                    customer_email: userRow?.email || undefined,
                    client_reference_id: String(orderId),
                    metadata: { orderId: String(orderId), reference },
                    line_items: [{
                        quantity: 1,
                        price_data: {
                            currency: STRIPE_CURRENCY,
                            unit_amount: Math.round(total * 100),
                            product_data: { name: `Ceekay order ${reference}` }
                        }
                    }],
                    success_url: `${APP_BASE_URL}/order-complete.html?session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url: `${APP_BASE_URL}/cart.html?checkout=cancelled&session_id={CHECKOUT_SESSION_ID}`
                }, { idempotencyKey: `checkout-session-${orderId}` });
                return res.json({ ok: true, orderId, reference, total, paymentMethod, redirectUrl: session.url });
            } catch (stripeErr) {
                // Stripe refused the session (e.g. the total is below its minimum
                // chargeable amount). Nothing was charged, so give the stock back and
                // drop the order instead of leaving a dangling "awaiting_payment" row.
                console.error('stripe session creation failed:', stripeErr.message);
                await failPendingOrder(orderId);
                return res.status(502).json({ error: 'Could not start Stripe checkout. Your cart has not been charged — please try again.' });
            }
        }

        const response = { ok: true, orderId, reference, total, discount, paymentMethod, paymentStatus: 'awaiting_payment' };
        if (paymentMethod === 'bank_transfer') {
            response.instructions = {
                accountName: BANK_TRANSFER.accountName,
                bsb: BANK_TRANSFER.bsb,
                accountNumber: BANK_TRANSFER.accountNumber,
                amount: Number(total.toFixed(2)),
                reference
            };
        }
        res.json(response);
    } catch (err) {
        try { await connection.rollback(); } catch (_) { /* already committed */ }
        console.error(err);
        res.status(500).json({ error: 'Checkout failed' });
    } finally {
        connection.release();
    }
});

// Gives back the stock reserved for an order's items — used when an order is
// superseded, cancelled, or its Stripe payment fails/expires without ever paying.
async function releaseOrderStock(conn, orderId) {
    const [items] = await conn.query('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [orderId]);
    for (const it of items) {
        await conn.query('UPDATE products SET stock_quantity = stock_quantity + ? WHERE product_id = ?', [it.quantity, it.product_id]);
    }
}

// Finalize an order once its payment has actually succeeded: clear the buyer's
// cart and flip the order to paid/processing. Stock was already reserved when
// the order was created (see /api/orders/checkout), so there's none to touch
// here. Idempotent.
async function finalizePaidOrder(orderId) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [[order]] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
        if (!order) { await conn.rollback(); return { ok: false, reason: 'not_found' }; }
        if (order.payment_status === 'paid') { await conn.rollback(); return { ok: true, already: true }; }

        const [carts] = await conn.query('SELECT id FROM carts WHERE user_id = ?', [order.user_id]);
        if (carts[0]) {
            await conn.query('DELETE FROM cart_items WHERE cart_id = ?', [carts[0].id]);
            await conn.query('UPDATE carts SET coupon_code = NULL WHERE id = ?', [carts[0].id]);
        }
        await conn.query("UPDATE orders SET payment_status = 'paid', status = 'processing' WHERE id = ?", [orderId]);
        await conn.commit();
        return { ok: true };
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
}

// Called when a Stripe Checkout Session expires or its (delayed) payment fails,
// or when Stripe itself rejected creating the session: gives back the stock that
// was reserved when the order was created and marks the order failed/cancelled.
// Idempotent — a no-op if the order already paid (via another event) or was
// already released.
async function failPendingOrder(orderId) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [[order]] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
        if (!order || order.payment_status !== 'awaiting_payment') { await conn.rollback(); return { ok: true, skipped: true }; }

        await releaseOrderStock(conn, orderId);
        await conn.query("UPDATE orders SET payment_status = 'failed', status = 'cancelled' WHERE id = ?", [orderId]);
        await conn.commit();
        return { ok: true };
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
}

// Called by order-complete.html when Stripe redirects the buyer back.
// No auth cookie required: the caller supplies the (unguessable) Stripe
// session id, and we only act if Stripe itself reports the session as paid.
// The webhook is the authoritative path; this is the belt-and-braces one.
app.post('/api/checkout/stripe/confirm', async (req, res) => {
    if (!stripe) return res.status(400).json({ error: 'Stripe is not configured' });
    const sessionId = String(req.body.sessionId || '');
    if (!sessionId.startsWith('cs_')) return res.status(400).json({ error: 'A valid sessionId is required' });
    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const orderId = Number(session.metadata?.orderId || session.client_reference_id);
        if (!orderId) return res.status(400).json({ error: 'Unrecognised checkout session' });

        const [[order]] = await pool.query('SELECT payment_reference, total_amount, payment_status FROM orders WHERE id = ?', [orderId]);
        if (!order) return res.status(404).json({ error: 'Order not found' });

        if (session.payment_status === 'paid') {
            await finalizePaidOrder(orderId);
            return res.json({ ok: true, paid: true, orderId, reference: order.payment_reference, total: Number(order.total_amount) });
        }
        return res.json({ ok: true, paid: false, orderId, paymentStatus: session.payment_status });
    } catch (err) {
        console.error('stripe confirm error:', err.message);
        res.status(500).json({ error: 'Could not confirm payment' });
    }
});

// Called by cart.html when Stripe redirects the buyer back after they cancel on
// the Checkout page. An abandoned-but-still-open Stripe session otherwise stays
// "open" (and its stock reserved) for up to 24h until Stripe's own expiry fires —
// this releases that reservation immediately instead of making other customers
// wait. Same no-auth-required reasoning as /confirm above: the caller supplies
// the unguessable Stripe session id, and we only ever release, never charge.
app.post('/api/checkout/stripe/cancel', async (req, res) => {
    if (!stripe) return res.status(400).json({ error: 'Stripe is not configured' });
    const sessionId = String(req.body.sessionId || '');
    if (!sessionId.startsWith('cs_')) return res.status(400).json({ error: 'A valid sessionId is required' });
    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const orderId = Number(session.metadata?.orderId || session.client_reference_id);
        if (!orderId) return res.status(400).json({ error: 'Unrecognised checkout session' });

        if (session.status === 'open') {
            try { await stripe.checkout.sessions.expire(sessionId); }
            catch (e) { /* already expiring/completed elsewhere — fine, still release below */ }
        }
        await failPendingOrder(orderId);
        res.json({ ok: true });
    } catch (err) {
        console.error('stripe cancel error:', err.message);
        res.status(500).json({ error: 'Could not release reserved stock' });
    }
});

// Stripe webhook — authoritative payment confirmation. Raw body (parser skipped above).
app.post('/api/webhooks/stripe', express.raw({ type: '*/*' }), async (req, res) => {
    if (!stripe) return res.status(400).send('stripe not configured');

    // Without a webhook secret, events can't be signature-verified — anyone who
    // finds this URL could POST a fake "paid" event and mark any order paid for
    // free. The unverified fallback below is for local dev only, so it's refused
    // outright once NODE_ENV=production instead of silently trusting the body.
    if (!STRIPE.webhookSecret) {
        if (process.env.NODE_ENV === 'production') {
            console.error('stripe webhook rejected: STRIPE_WEBHOOK_SECRET is not set in production');
            return res.status(500).send('Webhook not configured');
        }
        console.warn('⚠  STRIPE_WEBHOOK_SECRET not set — accepting this webhook UNVERIFIED (dev only).');
    }

    let event;
    try {
        event = STRIPE.webhookSecret
            ? stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE.webhookSecret)
            : JSON.parse(req.body.toString('utf8')); // dev only, unverified — blocked above when NODE_ENV=production
    } catch (err) {
        console.error('stripe webhook verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
        const session = event.data.object;
        const orderId = Number(session.metadata?.orderId || session.client_reference_id);
        if (orderId && session.payment_status === 'paid') {
            try { await finalizePaidOrder(orderId); }
            catch (e) { console.error('finalize from webhook failed:', e.message); }
        }
    } else if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
        const session = event.data.object;
        const orderId = Number(session.metadata?.orderId || session.client_reference_id);
        if (orderId) {
            try { await failPendingOrder(orderId); }
            catch (e) { console.error('release stock from webhook failed:', e.message); }
        }
    }
    res.json({ received: true });
});

// Admin: mark a bank-transfer order as paid once the money has landed.
app.post('/api/admin/orders/:id/mark-paid', requireAdmin, async (req, res) => {
    const orderId = Number(req.params.id);
    try {
        const [result] = await pool.query(
            "UPDATE orders SET payment_status = 'paid', status = IF(status = 'pending', 'processing', status) WHERE id = ?",
            [orderId]
        );
        if (!result.affectedRows) return res.status(404).json({ error: 'Order not found' });
        await logAudit(req.admin, 'order.mark_paid', { orderId });
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update payment status' });
    }
});

app.get('/api/orders/mine', auth, async (req, res) => {
    try {
        const [orders] = await pool.query('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
        res.json(orders);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
    const { status } = req.query;
    try {
        const [rows] = status
            ? await pool.query('SELECT o.*, u.email, u.name AS customer_name FROM orders o JOIN users u ON o.user_id = u.id WHERE o.status = ? ORDER BY o.created_at DESC', [status])
            : await pool.query('SELECT o.*, u.email, u.name AS customer_name FROM orders o JOIN users u ON o.user_id = u.id ORDER BY o.created_at DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

app.get('/api/admin/orders/:id', requireAdmin, async (req, res) => {
    try {
        const [[order]] = await pool.query('SELECT o.*, u.email, u.name AS customer_name FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = ?', [req.params.id]);
        if (!order) return res.status(404).json({ error: 'Order not found' });
        const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [req.params.id]);
        res.json({ ...order, items });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch order' });
    }
});

const VALID_ORDER_STATUSES = ['pending', 'processing', 'shipped', 'completed', 'cancelled'];
app.patch('/api/admin/orders/:id', requireAdmin, async (req, res) => {
    const { status } = req.body;
    if (!VALID_ORDER_STATUSES.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${VALID_ORDER_STATUSES.join(', ')}` });
    }
    try {
        await pool.query('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);
        await logAudit(req.admin, 'order.status_update', { orderId: req.params.id, status });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update order' });
    }
});

// ===============================================================
// 6. WISHLIST
// ===============================================================
app.get('/api/wishlist', auth, async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM wishlist_items WHERE user_id = ?', [req.user.id]);
    res.json({ items: rows });
});

app.post('/api/wishlist', auth, async (req, res) => {
    const { productId, productName, price, imageUrl } = req.body;
    try {
        await pool.query(
            'INSERT INTO wishlist_items (user_id, product_id, product_name, price, image_url) VALUES (?, ?, ?, ?, ?)',
            [req.user.id, productId, productName, price, imageUrl]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to add item to wishlist' });
    }
});

// ===============================================================
// 7. ADMIN AUTH
// ===============================================================
app.post('/api/admin/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const [admins] = await pool.query('SELECT * FROM admin_users WHERE email = ?', [email]);
        const admin = admins[0];
        if (!admin || !admin.active || !(await bcrypt.compare(password, admin.password_hash))) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        const token = jwt.sign({ id: admin.id, email: admin.email, name: admin.name, role: admin.role }, ADMIN_JWT_SECRET, { expiresIn: '12h' });
        res.cookie('admin_token', token, authCookieOptions());
        await logAudit(admin, 'admin.login', {});
        res.json({ ok: true, admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role } });
    } catch (err) {
        if (err.code === 'ER_NO_SUCH_TABLE') return res.status(500).json({ error: 'Run schema.sql first.' });
        console.error(err);
        res.status(500).json({ error: 'Login failed' });
    }
});

app.post('/api/admin/logout', (req, res) => {
    res.clearCookie('admin_token', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    res.json({ ok: true });
});

app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ admin: req.admin }));

// --- Forgot / reset password (admin) ---
app.post('/api/admin/forgot-password', async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email is required' });
    if (forgotRateLimited(`a:${email}:${req.ip}`)) {
        return res.status(429).json({ error: 'Too many requests. Please wait a few minutes and try again.' });
    }

    const generic = { ok: true, message: "If an admin account exists for that email, we've sent a reset link." };
    try {
        const [admins] = await pool.query('SELECT id, email, active FROM admin_users WHERE email = ?', [email]);
        const admin = admins[0];
        if (!admin || !admin.active) return res.json(generic);

        const rawToken = await issuePasswordReset('admin', admin.id);
        const resetUrl = `${APP_BASE_URL}/reset-password.html?type=admin&token=${rawToken}`;
        console.log(`[password-reset] admin <${email}>: ${resetUrl}`);
        const mail = await sendResetEmail(admin.email, resetUrl, 'admin');
        await logAudit(admin, 'admin.password_reset_requested', { emailSent: mail.sent });

        const body = { ...generic };
        if (process.env.NODE_ENV !== 'production') {
            body.emailSent = mail.sent;
            if (mail.error) body.emailError = mail.error;
            if (!mail.sent) body.resetUrl = resetUrl; // dev fallback when no mail delivery
        }
        res.json(body);
    } catch (err) {
        if (err.code === 'ER_NO_SUCH_TABLE') {
            return res.status(500).json({ error: 'Run schema.sql / migrations-add-password-resets.sql first.' });
        }
        console.error('admin forgot-password error:', err);
        res.status(500).json({ error: 'Could not process the request' });
    }
});

app.post('/api/admin/reset-password', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and new password are required' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    try {
        const adminId = await consumePasswordReset('admin', token);
        if (!adminId) return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });

        const hash = await bcrypt.hash(password, 10);
        await pool.query('UPDATE admin_users SET password_hash = ? WHERE id = ?', [hash, adminId]);
        const [[adminRow]] = await pool.query('SELECT id, email FROM admin_users WHERE id = ?', [adminId]);
        await logAudit(adminRow, 'admin.password_reset_completed', {});
        res.json({ ok: true, message: 'Admin password updated. You can now log in.' });
    } catch (err) {
        console.error('admin reset-password error:', err);
        res.status(500).json({ error: 'Could not reset the password' });
    }
});

// ===============================================================
// 8. TEAM MANAGEMENT
// ===============================================================
app.get('/api/admin/team', requireAdmin, async (req, res) => {
    const [rows] = await pool.query('SELECT id, email, name, role, active, created_at FROM admin_users ORDER BY created_at ASC');
    res.json(rows);
});

app.post('/api/admin/team', requireAdmin, requireOwner, async (req, res) => {
    const { email, password, name, role } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const finalRole = role === 'owner' ? 'owner' : 'associate';
    try {
        const hash = await bcrypt.hash(password, 10);
        const [result] = await pool.query(
            'INSERT INTO admin_users (email, password_hash, name, role, created_by) VALUES (?, ?, ?, ?, ?)',
            [email, hash, name || null, finalRole, req.admin.id]
        );
        await logAudit(req.admin, 'team.add', { email, role: finalRole });
        res.json({ ok: true, id: result.insertId });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'That email already has an admin account' });
        res.status(500).json({ error: 'Failed to add team member' });
    }
});

app.patch('/api/admin/team/:id', requireAdmin, requireOwner, async (req, res) => {
    const { role, active } = req.body;
    const targetId = Number(req.params.id);

    if (targetId === req.admin.id && (active === false || role === 'associate')) {
        return res.status(400).json({ error: "You can't demote or deactivate your own account" });
    }

    const fields = [];
    const values = [];
    if (role !== undefined) { fields.push('role = ?'); values.push(role === 'owner' ? 'owner' : 'associate'); }
    if (active !== undefined) { fields.push('active = ?'); values.push(!!active); }
    if (fields.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    values.push(targetId);
    try {
        await pool.query(`UPDATE admin_users SET ${fields.join(', ')} WHERE id = ?`, values);
        await logAudit(req.admin, 'team.update', { targetId, role, active });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update team member' });
    }
});

app.delete('/api/admin/team/:id', requireAdmin, requireOwner, async (req, res) => {
    const targetId = Number(req.params.id);
    if (targetId === req.admin.id) return res.status(400).json({ error: "You can't remove your own account" });

    try {
        const [[target]] = await pool.query('SELECT role FROM admin_users WHERE id = ?', [targetId]);
        if (target?.role === 'owner') {
            const [[{ ownerCount }]] = await pool.query("SELECT COUNT(*) AS ownerCount FROM admin_users WHERE role = 'owner' AND active = TRUE");
            if (ownerCount <= 1) return res.status(400).json({ error: 'Cannot remove the last remaining owner' });
        }
        await pool.query('DELETE FROM admin_users WHERE id = ?', [targetId]);
        await logAudit(req.admin, 'team.remove', { targetId });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to remove team member' });
    }
});

// ===============================================================
// 9. COUPONS
// ===============================================================
app.get('/api/admin/coupons', requireAdmin, async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM coupons ORDER BY created_at DESC');
    res.json(rows);
});

app.post('/api/admin/coupons', requireAdmin, async (req, res) => {
    const { code, discount_percent, discount_amount, expires_at } = req.body;
    if (!code || (!discount_percent && !discount_amount)) {
        return res.status(400).json({ error: 'code and either discount_percent or discount_amount are required' });
    }
    try {
        await pool.query(
            'INSERT INTO coupons (code, discount_percent, discount_amount, expires_at) VALUES (?, ?, ?, ?)',
            [code.toUpperCase(), discount_percent || null, discount_amount || null, expires_at || null]
        );
        await logAudit(req.admin, 'coupon.create', { code });
        res.json({ ok: true });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'That coupon code already exists' });
        res.status(500).json({ error: 'Failed to create coupon' });
    }
});

app.patch('/api/admin/coupons/:id', requireAdmin, async (req, res) => {
    const { active } = req.body;
    try {
        await pool.query('UPDATE coupons SET active = ? WHERE id = ?', [!!active, req.params.id]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update coupon' });
    }
});

app.delete('/api/admin/coupons/:id', requireAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM coupons WHERE id = ?', [req.params.id]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete coupon' });
    }
});

// ===============================================================
// 10. CUSTOMERS
// ===============================================================
app.get('/api/admin/customers', requireAdmin, async (req, res) => {
    const [rows] = await pool.query('SELECT id, email, name, city, state, created_at FROM users ORDER BY created_at DESC LIMIT 500');
    res.json(rows);
});

// ===============================================================
// 11. DASHBOARD STATS
// ===============================================================
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    try {
        const [[{ revenue }]] = await pool.query("SELECT COALESCE(SUM(total_amount), 0) AS revenue FROM orders WHERE status != 'cancelled'");
        const [statusCounts] = await pool.query('SELECT status, COUNT(*) AS count FROM orders GROUP BY status');
        const [[{ customerCount }]] = await pool.query('SELECT COUNT(*) AS customerCount FROM users');
        const [[{ productCount }]] = await pool.query('SELECT COUNT(*) AS productCount FROM products WHERE active = TRUE');
        const [lowStock] = await pool.query('SELECT product_id, title, stock_quantity FROM products WHERE active = TRUE AND stock_quantity < 5 ORDER BY stock_quantity ASC LIMIT 20');
        const [pendingScrapeJobs] = await pool.query("SELECT COUNT(*) AS count FROM scrape_jobs WHERE status = 'pending'");

        res.json({
            revenue: Number(revenue),
            ordersByStatus: statusCounts,
            customerCount,
            productCount,
            lowStock,
            pendingScrapeJobs: pendingScrapeJobs[0].count
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to load stats' });
    }
});

// ===============================================================
// 12. AUDIT LOG
// ===============================================================
app.get('/api/admin/audit-log', requireAdmin, requireOwner, async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT 200');
    res.json(rows);
});

// ===============================================================
// SERVE FRONTEND (Must always sit at the bottom of route definitions)
// ===============================================================
// Meta Pixel base snippet, generated from META_PIXEL_ID so the ID lives in
// .env (like FB_PAGE_ID/IG_BUSINESS_ACCOUNT_ID) instead of being pasted into
// every HTML file. Every customer-facing page loads this early in <head>.
const META_PIXEL_ID = process.env.META_PIXEL_ID || '';
app.get('/pixel.js', (req, res) => {
    res.set('Content-Type', 'application/javascript');
    res.set('Cache-Control', 'no-store');
    if (!META_PIXEL_ID) {
        return res.send('// Meta Pixel not configured — set META_PIXEL_ID in .env');
    }
    res.send(`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${META_PIXEL_ID}');
fbq('track', 'PageView');`);
});

// Inject per-product Open Graph tags before serving sproduct.html, so a link
// shared to Facebook/WhatsApp/etc. shows a real preview card (photo, title,
// price) instead of a blank one — Facebook's link scraper doesn't run our
// client-side JS, so the tags have to already be in the HTML it fetches.
app.get('/sproduct.html', async (req, res, next) => {
    const productId = req.query.id;
    if (!productId) return next();
    try {
        const [[product]] = await pool.query('SELECT * FROM products WHERE product_id = ? AND active = TRUE', [productId]);
        if (!product) return next();

        let html = fs.readFileSync(path.join(__dirname, 'sproduct.html'), 'utf8');
        const pageUrl = `${APP_BASE_URL}/sproduct.html?id=${encodeURIComponent(productId)}`;
        const imageUrl = product.default_image
            ? `${APP_BASE_URL}/${String(product.default_image).replace(/^\/+/, '')}` : '';
        const price = Number(product.base_retail_price || 0).toFixed(2);
        const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        const title = esc(product.title || 'Ceekay Store');
        const description = esc(product.description || `${product.title} — $${price} AUD at Ceekay.`).slice(0, 300);

        const ogTags = `
    <meta property="og:type" content="product">
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${description}">
    <meta property="og:image" content="${imageUrl}">
    <meta property="og:url" content="${pageUrl}">
    <meta property="product:price:amount" content="${price}">
    <meta property="product:price:currency" content="AUD">
    <meta name="twitter:card" content="summary_large_image">
`;
        res.set('Content-Type', 'text/html');
        res.send(html.replace('</head>', `${ogTags}</head>`));
    } catch (err) {
        console.error('OG tag injection failed:', err.message);
        next();
    }
});

app.use(express.static(path.join(__dirname)));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Default 3007: port 3000 on this machine is occupied by a separate process.
// Override with the PORT env var if you need a different one.
const PORT = process.env.PORT || 3007;
app.listen(PORT, () => console.log(`Ceekay API + storefront running on http://localhost:${PORT}`));