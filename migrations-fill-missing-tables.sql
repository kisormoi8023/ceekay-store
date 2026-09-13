-- Creates tables that server.js needs but that are missing from this database
-- (orders/checkout, coupons, admin audit log, wishlist). user_id columns use
-- INT UNSIGNED to match the existing users.id / admin_users.id in this DB.
--
--   mysql -u root -p ceekay_db < migrations-fill-missing-tables.sql

CREATE TABLE IF NOT EXISTS admin_audit_log (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    admin_id    INT UNSIGNED NULL,
    admin_email VARCHAR(255),
    action      VARCHAR(255),
    details     TEXT,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS coupons (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    code             VARCHAR(50) NOT NULL UNIQUE,
    discount_percent DECIMAL(5,2) NULL,
    discount_amount  DECIMAL(10,2) NULL,
    active           BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at       DATETIME NULL,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orders (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT UNSIGNED NOT NULL,
    total_amount    DECIMAL(10,2) NOT NULL DEFAULT 0,
    discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    coupon_code     VARCHAR(50) NULL,
    status          ENUM('pending','processing','shipped','completed','cancelled') NOT NULL DEFAULT 'pending',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_orders_user (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS order_items (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    order_id     INT NOT NULL,
    product_id   VARCHAR(191),
    product_name VARCHAR(255),
    price        DECIMAL(10,2) NOT NULL DEFAULT 0,
    quantity     INT NOT NULL DEFAULT 1,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS wishlist_items (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    user_id      INT UNSIGNED NOT NULL,
    product_id   VARCHAR(191),
    product_name VARCHAR(255),
    price        DECIMAL(10,2),
    image_url    VARCHAR(512),
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_wishlist_user_product (user_id, product_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;