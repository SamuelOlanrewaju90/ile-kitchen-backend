const express = require('express');
const https = require('https');
const pool = require('../db');
const { requireOwner } = require('../middleware/auth');

const router = express.Router();

const DELIVERY_FEE = 500; // flat delivery fee in naira, adjust as needed

function verifyPaystackTransaction(reference) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.paystack.co',
      path: `/transaction/verify/${encodeURIComponent(reference)}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
    };
    const request = https.request(options, (response) => {
      let data = '';
      response.on('data', (chunk) => (data += chunk));
      response.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    });
    request.on('error', reject);
    request.end();
  });
}

async function getSetting(key, fallback) {
  const result = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return result.rows[0]?.value ?? fallback;
}

// Public: place an order
router.post('/', async (req, res) => {
  const { customer_name, phone, address, notes, items, payment_method, payment_reference } = req.body;

  if (!customer_name || !phone || !address || !items || !items.length) {
    return res.status(400).json({ error: 'Missing required order details' });
  }
  if (!['cod', 'paystack'].includes(payment_method)) {
    return res.status(400).json({ error: 'Invalid payment method' });
  }

  // Refuse new orders while the restaurant is marked closed
  const isOpen = (await getSetting('restaurant_open', 'true')) !== 'false';
  if (!isOpen) {
    return res.status(400).json({ error: "We're closed right now — please check back soon." });
  }

  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  // Enforce a minimum order amount, if one is configured
  const minOrder = Number(await getSetting('min_order_amount', '0'));
  if (minOrder > 0 && subtotal < minOrder) {
    return res.status(400).json({
      error: `Minimum order amount is ₦${minOrder.toLocaleString()}. Add a bit more to your cart.`
    });
  }

  const total = subtotal + DELIVERY_FEE;

  let payment_status = 'pending';

  if (payment_method === 'paystack') {
    if (!payment_reference) {
      return res.status(400).json({ error: 'Missing payment reference' });
    }
    try {
      const verification = await verifyPaystackTransaction(payment_reference);
      const paidAmountKobo = verification?.data?.amount;
      const expectedKobo = Math.round(total * 100);
      if (
        verification.status === true &&
        verification.data.status === 'success' &&
        paidAmountKobo === expectedKobo
      ) {
        payment_status = 'paid';
      } else {
        return res.status(400).json({ error: 'Payment could not be verified' });
      }
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Payment verification failed' });
    }
  }

  try {
    const result = await pool.query(
      `INSERT INTO orders
        (customer_name, phone, address, notes, items, subtotal, delivery_fee, total, payment_method, payment_status, payment_reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        customer_name,
        phone,
        address,
        notes || '',
        JSON.stringify(items),
        subtotal,
        DELIVERY_FEE,
        total,
        payment_method,
        payment_status,
        payment_reference || null
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not place order' });
  }
});

// Public: look up a customer's past orders by phone number, including
// whether each order has already been reviewed (for the "leave a review" button)
router.get('/history', async (req, res) => {
  const { phone } = req.query;
  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required' });
  }
  try {
    const result = await pool.query(
      `SELECT orders.*,
              reviews.id IS NOT NULL AS has_review,
              reviews.rating AS review_rating
       FROM orders
       LEFT JOIN reviews ON reviews.order_id = orders.id
       WHERE orders.phone = $1
       ORDER BY orders.created_at DESC`,
      [phone.trim()]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load order history' });
  }
});

// Public: check status of a single order
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load order' });
  }
});

// Owner: list all orders, newest first
router.get('/', requireOwner, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load orders' });
  }
});

// Owner: update order status as it moves through the delivery process
router.put('/:id/status', requireOwner, async (req, res) => {
  const { order_status } = req.body;
  const valid = ['received', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
  if (!valid.includes(order_status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  try {
    const result = await pool.query(
      'UPDATE orders SET order_status = $1 WHERE id = $2 RETURNING *',
      [order_status, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update order' });
  }
});

module.exports = router;
