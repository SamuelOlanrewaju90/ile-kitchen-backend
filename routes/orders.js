const express = require('express');
const https = require('https');
const pool = require('../db');
const { requireAuth, requireAdmin, attachVendorId } = require('../middleware/auth');
const { sendSMS } = require('../lib/sms');
const { createOrder } = require('../lib/createOrder');

const router = express.Router();

const STATUS_MESSAGES = {
  received: (order) => `Ilé Market: Order #${order.id} received by the restaurant and will be prepared shortly.`,
  preparing: (order) => `Ilé Market: Order #${order.id} is being prepared now.`,
  out_for_delivery: (order) => `Ilé Market: Order #${order.id} is out for delivery!`,
  delivered: (order) => `Ilé Market: Order #${order.id} has been delivered. Enjoy your meal!`,
  cancelled: (order) => `Ilé Market: Order #${order.id} was cancelled. Contact us if this is unexpected.`
};

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

// Public: place an order with a specific vendor
router.post('/', async (req, res) => {
  const { vendor_id, customer_name, phone, address, notes, items, payment_method, payment_reference } = req.body;

  if (!vendor_id || !customer_name || !phone || !address || !items || !items.length) {
    return res.status(400).json({ error: 'Missing required order details' });
  }
  if (!['cod', 'paystack'].includes(payment_method)) {
    return res.status(400).json({ error: 'Invalid payment method' });
  }

  const vendorResult = await pool.query('SELECT * FROM vendors WHERE id = $1', [vendor_id]);
  const vendor = vendorResult.rows[0];
  if (!vendor || !vendor.is_approved) {
    return res.status(400).json({ error: 'This restaurant is not available right now.' });
  }
  if (!vendor.is_open) {
    return res.status(400).json({ error: "This restaurant is closed right now — please check back soon." });
  }

  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const minOrder = Number(await getSetting('min_order_amount', '0'));
  if (minOrder > 0 && subtotal < minOrder) {
    return res.status(400).json({
      error: `Minimum order amount is ₦${minOrder.toLocaleString()}. Add a bit more to your cart.`
    });
  }

  const DELIVERY_FEE = 500;
  const total = subtotal + DELIVERY_FEE;
  let payment_status = 'pending';

  if (payment_method === 'paystack') {
    if (!payment_reference) {
      return res.status(400).json({ error: 'Missing payment reference' });
    }

    // The Paystack webhook can beat this request here on a slow connection
    // (it fires from Paystack's servers, independent of the customer's
    // browser). If it already created this order, just return it instead
    // of creating a duplicate.
    const already = await pool.query('SELECT * FROM orders WHERE payment_reference = $1', [payment_reference]);
    if (already.rows.length > 0) {
      return res.status(201).json(already.rows[0]);
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
    const order = await createOrder({
      vendor_id,
      customer_name,
      phone,
      address,
      notes,
      items,
      payment_method,
      payment_status,
      payment_reference
    });
    res.status(201).json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not place order' });
  }
});

// Public: a customer's order history across ALL vendors, by phone number
router.get('/history', async (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: 'Phone number is required' });
  try {
    const result = await pool.query(
      `SELECT orders.*, vendors.name AS vendor_name,
              reviews.id IS NOT NULL AS has_review, reviews.rating AS review_rating
       FROM orders
       LEFT JOIN vendors ON orders.vendor_id = vendors.id
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

// Public: single order status, with vendor name and rider location
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT orders.*, vendors.name AS vendor_name,
              riders.current_lat AS rider_lat, riders.current_lng AS rider_lng,
              riders.location_updated_at AS rider_location_updated_at,
              rider_users.name AS rider_name
       FROM orders
       LEFT JOIN vendors ON orders.vendor_id = vendors.id
       LEFT JOIN riders ON orders.rider_id = riders.id
       LEFT JOIN users rider_users ON riders.user_id = rider_users.id
       WHERE orders.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load order' });
  }
});

// Vendor: MY orders only, newest first
router.get('/', requireAuth, attachVendorId, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM orders WHERE vendor_id = $1 ORDER BY created_at DESC',
      [req.vendorId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load orders' });
  }
});

// Vendor: update status on one of MY orders. Texts the customer with a
// friendly status update every time, and flips delivery_status to
// "ready" the moment it's marked out for delivery.
router.put('/:id/status', requireAuth, attachVendorId, async (req, res) => {
  const { order_status } = req.body;
  const valid = ['received', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
  if (!valid.includes(order_status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  try {
    const deliveryStatusUpdate = order_status === 'out_for_delivery' ? `, delivery_status = 'ready'` : '';
    const result = await pool.query(
      `UPDATE orders SET order_status = $1 ${deliveryStatusUpdate}
       WHERE id = $2 AND vendor_id = $3 RETURNING *`,
      [order_status, req.params.id, req.vendorId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Order not found' });

    const order = result.rows[0];
    const messageBuilder = STATUS_MESSAGES[order_status];
    if (messageBuilder) sendSMS(order.phone, messageBuilder(order));

    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update order' });
  }
});

// Admin: unsettled payouts (cash commission owed, rider fees owed)
router.get('/admin/unsettled', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT orders.id, orders.payment_method, orders.total, orders.platform_fee,
              orders.vendor_payout, orders.rider_fee, orders.created_at,
              vendors.name AS vendor_name, rider_users.name AS rider_name
       FROM orders
       LEFT JOIN vendors ON orders.vendor_id = vendors.id
       LEFT JOIN riders ON orders.rider_id = riders.id
       LEFT JOIN users rider_users ON riders.user_id = rider_users.id
       WHERE orders.order_status = 'delivered' AND orders.payout_settled = false
       ORDER BY orders.created_at ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load unsettled orders' });
  }
});

// Admin: mark one order's payout as reconciled
router.put('/:id/settle', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE orders SET payout_settled = true WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not settle order' });
  }
});

module.exports = router;
