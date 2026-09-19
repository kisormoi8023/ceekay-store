-- Adds newsletter opt-in tracking to an existing `users` table.
-- (schema.sql already includes this column for fresh installs — run this
-- only against a database that was created before this column existed.)
ALTER TABLE users
    ADD COLUMN newsletter_opt_in BOOLEAN NOT NULL DEFAULT FALSE;
