-- Captures which colour/size variant a customer actually chose, all the way
-- through cart_items -> order_items. Previously only price/quantity were
-- stored, so a chosen variant was silently discarded and admins had no way
-- to know what to ship. Also fixes cart_items' uniqueness being keyed on
-- product_id alone, which merged two different variants of the same
-- product into a single row.
ALTER TABLE cart_items
    ADD COLUMN variant_sku VARCHAR(100) NOT NULL DEFAULT '',
    ADD COLUMN variant_color VARCHAR(100) NULL,
    ADD COLUMN variant_size VARCHAR(50) NULL,
    DROP INDEX uniq_cart_product,
    ADD UNIQUE KEY uniq_cart_product_variant (cart_id, product_id, variant_sku);

ALTER TABLE order_items
    ADD COLUMN variant_sku VARCHAR(100) NULL,
    ADD COLUMN variant_color VARCHAR(100) NULL,
    ADD COLUMN variant_size VARCHAR(50) NULL;
