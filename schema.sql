-- Ceekay Store — Database Schema (v2: adds the admin/owner backend)
-- Run this fresh with:
--   mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS ceekay_db"
--   mysql -u root -p ceekay_db < schema.sql
--
-- Already have the v1 tables (users/products/carts/etc) from before?
-- Use migrations-add-admin.sql instead — it only adds what's new.

CREATE DATABASE IF NOT EXISTS ceekay_db;
USE ceekay_db;

-- ---------------------------------------------------------------
-- Customers (storefront accounts — separate from admin_users below)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    street VARCHAR(255),
    city VARCHAR(255),
    state VARCHAR(255),
    postcode VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- Admin / staff accounts — a completely separate table from `users`
-- on purpose, so a customer account can never be mistaken for staff
-- access no matter what a JWT payload claims.
-- ---------------------------------------------------------------
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

-- ---------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    product_id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    vendor_url VARCHAR(512),
    description TEXT,
    base_retail_price DECIMAL(10,2) NOT NULL DEFAULT 0,
    default_image VARCHAR(512),
    variants JSON,
    stock_quantity INT NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS product_images (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id VARCHAR(64) NOT NULL,
    image_url VARCHAR(512) NOT NULL,
    display_order INT DEFAULT 0,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- Scrape jobs — the queue your admin dashboard drops URLs into, and
-- product_scraper.py (run with --bot) polls and fulfills.
-- ---------------------------------------------------------------
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

-- ---------------------------------------------------------------
-- Carts / Cart Items
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    coupon_code VARCHAR(50) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cart_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    cart_id INT NOT NULL,
    product_id VARCHAR(64) NOT NULL,
    product_name VARCHAR(255),
    price DECIMAL(10,2) NOT NULL DEFAULT 0,
    image_url VARCHAR(512),
    quantity INT NOT NULL DEFAULT 1,
    UNIQUE KEY uniq_cart_product (cart_id, product_id),
    FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- Orders / Order Items
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    coupon_code VARCHAR(50) NULL,
    status ENUM('pending', 'processing', 'shipped', 'completed', 'cancelled') NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    product_id VARCHAR(64) NOT NULL,
    product_name VARCHAR(255),
    price DECIMAL(10,2) NOT NULL DEFAULT 0,
    quantity INT NOT NULL DEFAULT 1,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- Wishlist
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wishlist_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    product_id VARCHAR(64) NOT NULL,
    product_name VARCHAR(255),
    price DECIMAL(10,2) NOT NULL DEFAULT 0,
    image_url VARCHAR(512),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_user_product (user_id, product_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- Coupons
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coupons (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    discount_percent DECIMAL(5,2) NULL,
    discount_amount DECIMAL(10,2) NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
