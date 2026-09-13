// Reset a password directly in the database.
// This app has no "forgot password" flow, so this is the supported way to
// change a customer or staff password.
//
// Usage:
//   node reset-password.js <email> <new-password>          # customer (users table)
//   node reset-password.js --admin <email> <new-password>  # staff (admin_users table)
//
// Example:
//   node reset-password.js braelrotich@gmail.com "my-new-pass-123"

const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
    const args = process.argv.slice(2);
    const isAdmin = args[0] === '--admin';
    const [email, password] = isAdmin ? args.slice(1) : args;

    if (!email || !password) {
        console.error('Usage: node reset-password.js [--admin] <email> <new-password>');
        process.exit(1);
    }
    if (password.length < 8) {
        console.error('Password must be at least 8 characters.');
        process.exit(1);
    }

    const table = isAdmin ? 'admin_users' : 'users';

    const pool = mysql.createPool({
        host: process.env.DB_HOST || '127.0.0.1',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'ceekay',
        database: process.env.DB_NAME || 'ceekay_db',
        port: process.env.DB_PORT || 3306
    });

    try {
        const hash = await bcrypt.hash(password, 10);
        const [result] = await pool.query(
            `UPDATE ${table} SET password_hash = ? WHERE email = ?`,
            [hash, email]
        );

        if (result.affectedRows === 0) {
            console.error(`No ${isAdmin ? 'staff' : 'customer'} account found for ${email}`);
            process.exit(1);
        }
        console.log(`Password updated for ${email} (${table}).`);
    } catch (err) {
        console.error('Failed:', err.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

run();
