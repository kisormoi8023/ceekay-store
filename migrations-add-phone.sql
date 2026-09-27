-- Phone number: needed to actually place an order on a vendor's site (most
-- require one for shipping), and previously wasn't collected anywhere.
ALTER TABLE users
    ADD COLUMN phone VARCHAR(30) NULL;

ALTER TABLE orders
    ADD COLUMN shipping_phone VARCHAR(30) NULL;
