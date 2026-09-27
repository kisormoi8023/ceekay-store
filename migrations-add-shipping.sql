-- Per-supplier shipping. Each product names the supplier it ships from
-- (shipping_group) and that supplier's per-order fee (shipping_fee, AUD).
-- At checkout each group's fee is charged once, however many of its items
-- are in the order; products with a fee of 0 ship free.
ALTER TABLE products
    ADD COLUMN shipping_group VARCHAR(50) NULL,
    ADD COLUMN shipping_fee DECIMAL(10,2) NOT NULL DEFAULT 0;

ALTER TABLE orders
    ADD COLUMN shipping_amount DECIMAL(10,2) NOT NULL DEFAULT 0;
