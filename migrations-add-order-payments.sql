-- Adds payment tracking to orders (method chosen at checkout, a reference the
-- customer quotes on a bank transfer, and whether the money has arrived).
--
--   mysql -u root -p ceekay_db < migrations-add-order-payments.sql

ALTER TABLE orders
    ADD COLUMN payment_method   VARCHAR(30)  NULL AFTER coupon_code,
    ADD COLUMN payment_reference VARCHAR(40) NULL AFTER payment_method,
    ADD COLUMN payment_status   ENUM('awaiting_payment','paid','failed','refunded')
                                NOT NULL DEFAULT 'awaiting_payment' AFTER payment_reference;