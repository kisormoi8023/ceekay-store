-- Adds the scheduled social-post queue to an existing database.
-- (schema.sql already includes this table for fresh installs.)
CREATE TABLE IF NOT EXISTS scheduled_posts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id VARCHAR(64) NOT NULL,
    platforms SET('facebook', 'instagram') NOT NULL,
    scheduled_at DATETIME NOT NULL,
    status ENUM('pending', 'posted', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
    result JSON NULL,
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL,
    INDEX idx_scheduled_posts_due (status, scheduled_at)
) ENGINE=InnoDB;
