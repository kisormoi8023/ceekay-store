-- Incremental migration for stores that already ran the original schema.sql.
-- Safe to run once against an existing ceekay_db. Requires MySQL 8.0.29+ for
-- the "ADD COLUMN IF NOT EXISTS" syntax — on older MySQL, drop the
-- "IF NOT EXISTS" and ignore a duplicate-column error if it's already there.

USE ceekay_db;

CREATE TABLE IF NOT EXISTS admin_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    role ENUM('owner', 'associate') NOT NULL DEFAULT 'associate',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admin_audit_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    admin_id INT NULL,
    admin_email VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    details JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS scrape_jobs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    vendor_url VARCHAR(1024) NOT NULL,
    status ENUM('pending', 'processing', 'done', 'failed') NOT NULL DEFAULT 'pending',
    requested_by INT NULL,
    result_product_id VARCHAR(64) NULL,
    error_message TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (requested_by) REFERENCES admin_users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS coupons (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    discount_percent DECIMAL(5,2) NULL,
    discount_amount DECIMAL(10,2) NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_quantity INT NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE carts ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(50) NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(50) NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
-- Widen status if it was a plain VARCHAR before:
ALTER TABLE orders MODIFY COLUMN status ENUM('pending', 'processing', 'shipped', 'completed', 'cancelled') NOT NULL DEFAULT 'pending';
