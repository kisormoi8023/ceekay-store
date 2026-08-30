// One-time script to load products.json into the `products` table.
// This is what actually makes /api/products return your real catalog
// instead of erroring/being empty — the DB previously had no products
// in it at all (no schema, no seed step existed anywhere in the project).
//
// Usage:
//   node seed.js

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function seed() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'ceekay_db'
    });

    const jsonPath = path.join(__dirname, 'products.json');
    const products = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

    console.log(`Seeding ${products.length} products into the database...`);

    for (const product of products) {
        const id = product.product_id || product.id;
        const title = product.product_name || product.title;

        await pool.query(
            `INSERT INTO products (product_id, title, category, vendor_url, base_retail_price, default_image, variants)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                title = VALUES(title), category = VALUES(category), vendor_url = VALUES(vendor_url),
                base_retail_price = VALUES(base_retail_price), default_image = VALUES(default_image),
                variants = VALUES(variants)`,
            [
                id,
                title,
                product.category || null,
                product.vendor_url || null,
                product.base_retail_price || product.price || 0,
                product.default_image || product.image || null,
                JSON.stringify(product.variants || [])
            ]
        );
        console.log(`  ✓ ${id} — ${title}`);
    }

    console.log('Done.');
    await pool.end();
}

seed().catch(err => {
    console.error('Seeding failed:', err);
    process.exit(1);
});
