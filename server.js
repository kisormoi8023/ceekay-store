require('dotenv').config();
const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cookieParser());

// -------------------------------------------------------------
// CORS Configuration
// -------------------------------------------------------------
const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5500,http://127.0.0.1:5500')
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

// Health Check
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ===============================================================
// 1. CUSTOMER AUTHENTICATION
// ===============================================================
app.post('/api/auth/register', async (req, res) => {
    console.log('--- REGISTER ATTEMPT ---', req.body);
    const { email, password, name, address, street, city, state, postcode } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const finalStreet = street || address?.street || null;
    const finalCity = city || address?.city || null;
    const finalState = state || address?.state || null;
    const finalPostcode = postcode || address?.postcode || null;

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const [result] = await pool.query(
            'INSERT INTO users (email, password_hash, name, street, city, state, postcode) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [email, hashedPassword, name || null, finalStreet, finalCity, finalState, finalPostcode]
        );

        const userId = result.insertId;
        const token = jwt.sign({ id: userId, email, name }, JWT_SECRET, { expiresIn: '7d' });

        res.cookie('token', token, authCookieOptions());
        res.json({ ok: true, user: { id: userId, email, name } });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Email already registered' });
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
        await pool.query(
            `INSERT INTO products (product_id, title, category, description, base_retail_price, default_image, variants, stock_quantity)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE title = VALUES(title), category = VALUES(category),
                description = VALUES(description), base_retail_price = VALUES(base_retail_price),
                default_image = VALUES(default_image), variants = VALUES(variants),
                stock_quantity = VALUES(stock_quantity)`,
            [productId, productName, category || null, description || null, price || 0, imageUrl || null, JSON.stringify(variants || []), stockQuantity ?? 0]
        );
        await logAudit(req.admin, 'product.upsert', { productId, productName, viaBot: !!req.isBot });
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to save product' });
    }
});

app.get('/api/admin/products', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM products ORDER BY updated_at DESC');
        res.json(rows.map(row => ({ ...row, variants: typeof row.variants === 'string' ? JSON.parse(row.variants) : row.variants })));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

app.patch('/api/admin/products/:id', requireAdmin, async (req, res) => {
    const { title, category, description, base_retail_price, default_image, stock_quantity, active, variants } = req.body;
    const fields = [];
    const values = [];
    const map = { title, category, description, base_retail_price, default_image, stock_quantity, active };
    for (const [key, val] of Object.entries(map)) {
        if (val !== undefined) { fields.push(`${key} = ?`); values.push(val); }
    }
    if (variants !== undefined) { fields.push('variants = ?'); values.push(JSON.stringify(variants)); }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(req.params.id);
    try {
        await pool.query(`UPDATE products SET ${fields.join(', ')} WHERE product_id = ?`, values);
        await logAudit(req.admin, 'product.update', { productId: req.params.id, fields: Object.keys(map).filter(k => map[k] !== undefined) });
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update product' });
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

app.get('/api/cart', async (req, res) => {
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
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [carts] = await connection.query('SELECT * FROM carts WHERE user_id = ?', [req.user.id]);
        if (!carts[0]) { await connection.rollback(); return res.status(400).json({ error: 'Cart is empty' }); }

        const [items] = await connection.query('SELECT * FROM cart_items WHERE cart_id = ?', [carts[0].id]);
        if (items.length === 0) { await connection.rollback(); return res.status(400).json({ error: 'Cart is empty' }); }

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
            'INSERT INTO orders (user_id, total_amount, discount_amount, coupon_code, status) VALUES (?, ?, ?, ?, ?)',
            [req.user.id, total, discount, couponCode, 'pending']
        );

        for (const item of items) {
            await connection.query(
                'INSERT INTO order_items (order_id, product_id, product_name, price, quantity) VALUES (?, ?, ?, ?, ?)',
                [orderResult.insertId, item.product_id, item.product_name, item.price, item.quantity]
            );
            await connection.query(
                'UPDATE products SET stock_quantity = GREATEST(stock_quantity - ?, 0) WHERE product_id = ?',
                [item.quantity, item.product_id]
            );
        }

        await connection.query('DELETE FROM cart_items WHERE cart_id = ?', [carts[0].id]);
        await connection.query('UPDATE carts SET coupon_code = NULL WHERE id = ?', [carts[0].id]);

        await connection.commit();
        res.json({ ok: true, orderId: orderResult.insertId, total, discount });
    } catch (err) {
        await connection.rollback();
        console.error(err);
        res.status(500).json({ error: 'Checkout failed' });
    } finally {
        connection.release();
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
app.use(express.static(path.join(__dirname)));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Ceekay API + storefront running on http://localhost:${PORT}`));