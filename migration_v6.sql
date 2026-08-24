-- MIGRATION v6: Payment splitting.
-- Run this in Neon's SQL Editor. Safe to re-run.

-- A vendor pastes their own Paystack subaccount code here (generated from
-- THEIR OWN Paystack dashboard — we never touch or store anyone's bank
-- details directly). If present, online payments split automatically.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS paystack_subaccount_code TEXT;

-- Computed and stored at the moment an order is placed, based on the
-- vendor's commission_rate at that time (so later rate changes don't
-- retroactively alter past orders).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS platform_fee NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS vendor_payout NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rider_fee NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Manual reconciliation flag for cash orders (and rider payouts, which
-- are always manual in this build since riders don't have Paystack
-- subaccounts). Admin marks an order settled once money has actually
-- changed hands outside the app.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payout_settled BOOLEAN NOT NULL DEFAULT false;

-- Backfill figures for your existing orders, using Ilé Kitchen's 15%
-- commission rate, so historical data isn't left at zero.
UPDATE orders SET
  platform_fee = ROUND(subtotal * 0.15, 2),
  vendor_payout = subtotal - ROUND(subtotal * 0.15, 2),
  rider_fee = delivery_fee
WHERE platform_fee = 0 AND vendor_payout = 0;
