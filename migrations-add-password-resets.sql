-- Adds the password_resets table used by the "Forgot password?" flow
-- (customer and admin). Safe to run on an existing database.
--
--   mysql -u root -p ceekay_db < migrations-add-password-resets.sql

CREATE TABLE IF NOT EXISTS password_resets (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_type   ENUM('customer', 'admin') NOT NULL,
    user_id     INT NOT NULL,
    token_hash  CHAR(64) NOT NULL,            -- sha256 hex of the emailed token
    expires_at  DATETIME NOT NULL,
    used_at     DATETIME NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_password_resets_token (token_hash),
    INDEX idx_password_resets_user (user_type, user_id)
) ENGINE=InnoDB;
