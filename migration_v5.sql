-- MIGRATION v5: Rider system.
-- Run this in Neon's SQL Editor. Safe to re-run.

CREATE TABLE IF NOT EXISTS riders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  is_available BOOLEAN NOT NULL DEFAULT false,
  current_lat NUMERIC(10, 7),
  current_lng NUMERIC(10, 7),
  location_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS rider_id INTEGER REFERENCES riders(id);

-- delivery_status tracks the rider/delivery side specifically, separate
-- from order_status which the vendor controls for kitchen prep. When a
-- vendor marks an order "out_for_delivery," the backend automatically
-- flips delivery_status to "ready" so it appears in riders' available pool.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (delivery_status IN ('pending', 'confirmed', 'preparing', 'ready', 'picked_up', 'in_transit', 'delivered', 'cancelled'));
