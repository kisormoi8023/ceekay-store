// Creates (or resets) the store OWNER account from your .env file.
// This is intentionally NOT a public signup endpoint — the only way to get
// an owner account is to control the .env file / database directly.
//
// Set in .env first:
//   OWNER_EMAIL=you@yourstore.com
//   OWNER_PASSWORD=a-strong-password
//   OWNER_NAME=Your Name
//
// Then run:
//   node seed-admin.js

const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
    const email = process.env.OWNER_EMAIL;
    const password = process.env.OWNER_PASSWORD;
    const name = process.env.OWNER_NAME || 'Store Owner';

    if (!email || !password) {
        console.error('Set OWNER_EMAIL and OWNER_PASSWORD in your .env file first.');
        process.exit(1);
    }
    if (password.length < 8) {
        console.error('OWNER_PASSWORD should be at least 8 characters.');
        process.exit(1);
    }

    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'ceekay_db'
    });

    try {
        const hash = await bcrypt.hash(password, 10);
        const [existing] = await pool.query('SELECT id FROM admin_users WHERE email = ?', [email]);

        if (existing[0]) {
            await pool.query(
                'UPDATE admin_users SET password_hash = ?, name = ?, role = ?, active = TRUE WHERE id = ?',
                [hash, name, 'owner', existing[0].id]
            );
            console.log(`Updated existing owner account: ${email}`);
        } else {
            await pool.query(
                'INSERT INTO admin_users (email, password_hash, name, role, active) VALUES (?, ?, ?, ?, TRUE)',
                [email, hash, name, 'owner']
            );
            console.log(`Created owner account: ${email}`);
        }
    } catch (err) {
        console.error('Failed to seed owner account:', err.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

run();
