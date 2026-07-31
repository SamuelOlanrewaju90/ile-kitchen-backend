-- Run this once against your Neon database to set up tables.

CREATE TABLE IF NOT EXISTS menu_items (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(10,2) NOT NULL,
  image_url TEXT,
  category TEXT NOT NULL DEFAULT 'Mains',
  available BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  notes TEXT,
  items JSONB NOT NULL,
  subtotal NUMERIC(10,2) NOT NULL,
  delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  total NUMERIC(10,2) NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cod', -- 'cod' or 'paystack'
  payment_status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'paid' | 'failed'
  payment_reference TEXT,
  order_status TEXT NOT NULL DEFAULT 'received', -- 'received' | 'preparing' | 'out_for_delivery' | 'delivered' | 'cancelled'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A few starter menu items so the site isn't empty on first deploy.
-- Replace image_url values with your own real photos once uploaded.
INSERT INTO menu_items (name, description, price, image_url, category) VALUES
('Jollof Rice & Chicken', 'Smoky party-style jollof with grilled chicken thigh', 3500, '', 'Mains'),
('Fried Rice & Turkey', 'Vegetable fried rice with a peppered turkey leg', 3800, '', 'Mains'),
('Egusi Soup & Pounded Yam', 'Melon seed soup with assorted meat, served with pounded yam', 4200, '', 'Mains'),
('Suya Platter', 'Grilled beef skewers rolled in yaji spice, onions & tomato', 3000, '', 'Grills'),
('Peppered Snail', 'Bush meat snail sauteed in fresh pepper sauce', 4500, '', 'Grills'),
('Chin Chin', 'Crunchy sweet fried dough snack, small pack', 1000, '', 'Snacks'),
('Zobo Drink', 'Chilled hibiscus drink with ginger and pineapple', 800, '', 'Drinks'),
('Chapman', 'Classic Nigerian fruit cocktail, non-alcoholic', 1200, '', 'Drinks')
ON CONFLICT DO NOTHING;
