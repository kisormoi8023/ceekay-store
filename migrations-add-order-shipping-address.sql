-- Captures the shipping address actually confirmed at checkout on the order
-- itself, instead of only relying on the (possibly later-edited) users table.
-- (schema.sql already includes these columns for fresh installs.)
ALTER TABLE orders
    ADD COLUMN shipping_street VARCHAR(255) NULL,
    ADD COLUMN shipping_city VARCHAR(255) NULL,
    ADD COLUMN shipping_state VARCHAR(255) NULL,
    ADD COLUMN shipping_postcode VARCHAR(50) NULL;
