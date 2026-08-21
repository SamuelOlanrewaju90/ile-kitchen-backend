-- MIGRATION v4: Multi-vendor marketplace foundation.
-- Run this in Neon's SQL Editor. Safe to re-run (IF NOT EXISTS / ON CONFLICT throughout).

-- Real accounts, replacing the old single env-var owner login.
-- role = the account's primary capability. is_admin is separate from role
-- so the same person can run a vendor AND have platform admin access
-- (which is exactly your situation).
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('vendor', 'rider')),
  is_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vendors (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  logo_url TEXT,
  cuisine_type TEXT,
  address TEXT,
  is_approved BOOLEAN NOT NULL DEFAULT false,
  is_open BOOLEAN NOT NULL DEFAULT true,
  commission_rate NUMERIC(5,2) NOT NULL DEFAULT 15.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS vendor_id INTEGER REFERENCES vendors(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS vendor_id INTEGER REFERENCES vendors(id);

-- Migrate you (Samuel) into the new users table as a vendor account with
-- admin privileges, reusing your EXISTING password hash — so your login
-- (email below, password Suya2026!) keeps working exactly as before,
-- just through the new system.
--
-- IMPORTANT: edit the email below to whatever you want to log in with
-- before running this — it must be unique and is now your login username.
WITH new_user AS (
  INSERT INTO users (name, email, phone, password_hash, role, is_admin)
  VALUES (
    'Samuel Olanrewaju',
    'samuelolanrewaju938@gmail.com',
    '08067933043',
    '$2a$10$aVoiVuzbr3rgN4O6gtbLV./l4GeAZsXKObVrLPQIL0F7BYpmGKxDG',
    'vendor',
    true
  )
  ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
  RETURNING id
)
INSERT INTO vendors (owner_id, name, description, cuisine_type, address, is_approved, is_open)
SELECT id, 'Ilé Kitchen', 'Home-cooked Nigerian food, delivered by us.', 'Nigerian', 'Lagos, Nigeria', true, true
FROM new_user
WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE name = 'Ilé Kitchen');

-- Attach your existing menu items and order history to your vendor row,
-- so nothing you've built so far is lost.
UPDATE menu_items SET vendor_id = (SELECT id FROM vendors WHERE name = 'Ilé Kitchen' LIMIT 1)
WHERE vendor_id IS NULL;

UPDATE orders SET vendor_id = (SELECT id FROM vendors WHERE name = 'Ilé Kitchen' LIMIT 1)
WHERE vendor_id IS NULL;
