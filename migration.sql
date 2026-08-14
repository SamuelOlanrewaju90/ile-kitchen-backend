-- MIGRATION: run this in Neon's SQL Editor to add the new features.
-- Safe to run even if some of it was already applied — everything
-- here uses IF NOT EXISTS / ON CONFLICT so it won't duplicate or error.

-- Settings: a simple key/value store for restaurant-wide toggles
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('restaurant_open', 'true'),
  ('estimated_delivery_minutes', '30-45'),
  ('min_order_amount', '2000'),
  ('whatsapp_number', '2348067933043')
ON CONFLICT (key) DO NOTHING;

-- "Chef's pick" tag on menu items
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false;

-- Reviews: one review per delivered order
CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS reviews_order_id_unique ON reviews(order_id);

-- Optional: mark 2-3 of your existing dishes as "Chef's pick" to show them off.
-- Example (uncomment and edit the ids):
-- UPDATE menu_items SET featured = true WHERE id IN (1, 4);
