require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  ssl: process.env.DB_SSL === 'true' ? {} : undefined
});

app.use(cors({ origin: process.env.FRONTEND_ORIGIN, credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

const cookieOptions = {
  httpOnly: true,
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 1000 * 60 * 60 * 24 * 7
};

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function auth(required = true) {
  return (req, res, next) => {
    try {
      const token = req.cookies.ceekay_session;
      if (!token) {
        if (required) return res.status(401).json({ error: 'Login required' });
        return next();
      }
      req.user = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch {
      if (required) return res.status(401).json({ error: 'Invalid or expired session' });
      next();
    }
  };
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

function validEmail(email) { return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function validProductId(id) { return typeof id === 'string' && id.length > 0 && id.length <= 191; }
function validQuantity(q) { return Number.isInteger(q) && q >= 1 && q <= 999; }

async function getOrCreateCart(userId, connection = pool) {
  const [rows] = await connection.query('SELECT id FROM carts WHERE user_id = ?', [userId]);
  if (rows[0]) return rows[0].id;
  const [result] = await connection.query('INSERT INTO carts (user_id) VALUES (?)', [userId]);
  return result.insertId;
}

async function getCart(userId) {
  const cartId = await getOrCreateCart(userId);
  const [items] = await pool.query('SELECT product_id, product_name, price, image_url, quantity FROM cart_items WHERE cart_id = ? ORDER BY created_at DESC', [cartId]);
  return items;
}

async function getWishlist(userId) {
  const [items] = await pool.query('SELECT product_id, product_name, price, image_url FROM wishlist_items WHERE user_id = ? ORDER BY created_at DESC', [userId]);
  return items;
}

app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});

app.post('/api/auth/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!validEmail(email) || typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Use a valid email and a password of at least 8 characters' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const [result] = await pool.query('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)', [email.toLowerCase().trim(), hash, name || null]);
    const user = { id: result.insertId, email: email.toLowerCase().trim(), role: 'customer' };
    await getOrCreateCart(user.id);
    res.cookie('ceekay_session', signToken(user), cookieOptions).status(201).json({ user: { id: user.id, email: user.email, name: name || null, role: user.role } });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An account with that email already exists' });
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!validEmail(email) || typeof password !== 'string') return res.status(400).json({ error: 'Email and password are required' });
  const [rows] = await pool.query('SELECT id, email, name, password_hash, role FROM users WHERE email = ?', [email.toLowerCase().trim()]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Invalid email or password' });
  res.cookie('ceekay_session', signToken(user), cookieOptions).json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

app.post('/api/auth/logout', (req, res) => { res.clearCookie('ceekay_session', cookieOptions).json({ ok: true }); });

app.get('/api/me', auth(), async (req, res) => {
  const [rows] = await pool.query('SELECT id, email, name, role, created_at FROM users WHERE id = ?', [req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json({ user: rows[0] });
});

app.get('/api/cart', auth(), async (req, res) => res.json({ items: await getCart(req.user.id) }));

app.post('/api/cart/items', auth(), async (req, res) => {
  const { productId, productName, price, imageUrl, quantity = 1 } = req.body;
  if (!validProductId(productId) || !validQuantity(quantity) || typeof productName !== 'string' || !Number.isFinite(Number(price))) return res.status(400).json({ error: 'Invalid cart item' });
  const cartId = await getOrCreateCart(req.user.id);
  await pool.query(`INSERT INTO cart_items (cart_id, product_id, product_name, price, image_url, quantity) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE quantity = LEAST(quantity + VALUES(quantity), 999), product_name = VALUES(product_name), price = VALUES(price), image_url = VALUES(image_url)`, [cartId, productId, productName, Number(price), imageUrl || null, quantity]);
  res.status(201).json({ items: await getCart(req.user.id) });
});

app.patch('/api/cart/items/:productId', auth(), async (req, res) => {
  const { quantity } = req.body;
  if (!validQuantity(quantity)) return res.status(400).json({ error: 'Quantity must be between 1 and 999' });
  const cartId = await getOrCreateCart(req.user.id);
  await pool.query('UPDATE cart_items SET quantity = ? WHERE cart_id = ? AND product_id = ?', [quantity, cartId, req.params.productId]);
  res.json({ items: await getCart(req.user.id) });
});

app.delete('/api/cart/items/:productId', auth(), async (req, res) => {
  const cartId = await getOrCreateCart(req.user.id);
  await pool.query('DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?', [cartId, req.params.productId]);
  res.json({ items: await getCart(req.user.id) });
});

app.post('/api/cart/merge', auth(), async (req, res) => {
  const guestItems = Array.isArray(req.body.items) ? req.body.items : [];
  const cartId = await getOrCreateCart(req.user.id);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const item of guestItems) {
      if (!validProductId(item.productId) || !validQuantity(item.quantity) || typeof item.productName !== 'string' || !Number.isFinite(Number(item.price))) continue;
      await connection.query(`INSERT INTO cart_items (cart_id, product_id, product_name, price, image_url, quantity) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE quantity = LEAST(quantity + VALUES(quantity), 999)`, [cartId, item.productId, item.productName, Number(item.price), item.imageUrl || null, item.quantity]);
    }
    await connection.commit();
    res.json({ items: await getCart(req.user.id) });
  } catch { await connection.rollback(); res.status(500).json({ error: 'Cart merge failed' }); }
  finally { connection.release(); }
});

app.get('/api/wishlist', auth(), async (req, res) => res.json({ items: await getWishlist(req.user.id) }));

app.post('/api/wishlist/items', auth(), async (req, res) => {
  const { productId, productName, price, imageUrl } = req.body;
  if (!validProductId(productId) || typeof productName !== 'string' || !Number.isFinite(Number(price))) return res.status(400).json({ error: 'Invalid wishlist item' });
  await pool.query('INSERT INTO wishlist_items (user_id, product_id, product_name, price, image_url) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE product_name = VALUES(product_name), price = VALUES(price), image_url = VALUES(image_url)', [req.user.id, productId, productName, Number(price), imageUrl || null]);
  res.status(201).json({ items: await getWishlist(req.user.id) });
});

app.delete('/api/wishlist/items/:productId', auth(), async (req, res) => {
  await pool.query('DELETE FROM wishlist_items WHERE user_id = ? AND product_id = ?', [req.user.id, req.params.productId]);
  res.json({ items: await getWishlist(req.user.id) });
});

app.get('/api/admin/users', auth(), adminOnly, async (req, res) => {
  const [users] = await pool.query(`SELECT u.id, u.email, u.name, u.role, u.created_at, COUNT(DISTINCT wi.id) wishlist_items, COALESCE(SUM(ci.quantity), 0) cart_items FROM users u LEFT JOIN wishlist_items wi ON wi.user_id = u.id LEFT JOIN carts c ON c.user_id = u.id LEFT JOIN cart_items ci ON ci.cart_id = c.id GROUP BY u.id ORDER BY u.created_at DESC`);
  res.json({ users });
});

app.get('/api/admin/users/:id/data', auth(), adminOnly, async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) return res.status(400).json({ error: 'Invalid user id' });
  const [user] = await pool.query('SELECT id, email, name, role, created_at FROM users WHERE id = ?', [userId]);
  if (!user[0]) return res.status(404).json({ error: 'User not found' });
  res.json({ user: user[0], cart: await getCart(userId), wishlist: await getWishlist(userId) });
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.listen(port, () => console.log(`Ceekay API running on port ${port}`));