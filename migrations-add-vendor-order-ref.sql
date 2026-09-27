-- Lets the admin record the vendor's own order number and a courier
-- tracking number once an order has actually been placed with the
-- supplier, so it's visible which orders still need to be placed.
ALTER TABLE orders
    ADD COLUMN vendor_order_ref VARCHAR(100) NULL,
    ADD COLUMN tracking_number VARCHAR(100) NULL;
