const express = require('express');
const pool = require('../db');
const { requireAuth, attachRiderId } = require('../middleware/auth');
const { sendSMS } = require('../lib/sms');

const router = express.Router();

// Rider: my own profile
router.get('/me', requireAuth, attachRiderId, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM riders WHERE id = $1', [req.riderId]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load rider profile' });
  }
});

// Rider: toggle availability
router.put('/me/availability', requireAuth, attachRiderId, async (req, res) => {
  const { is_available } = req.body;
  try {
    const result = await pool.query(
      'UPDATE riders SET is_available = $1 WHERE id = $2 RETURNING *',
      [is_available, req.riderId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update availability' });
  }
});

// Rider: report current GPS position
router.put('/me/location', requireAuth, attachRiderId, async (req, res) => {
  const { lat, lng } = req.body;
  if (lat === undefined || lng === undefined) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }
  try {
    const result = await pool.query(
      'UPDATE riders SET current_lat = $1, current_lng = $2, location_updated_at = now() WHERE id = $3 RETURNING *',
      [lat, lng, req.riderId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update location' });
  }
});

// Rider: orders ready for pickup that no one has claimed yet
router.get('/available-orders', requireAuth, attachRiderId, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT orders.*, vendors.name AS vendor_name, vendors.address AS vendor_address
       FROM orders JOIN vendors ON orders.vendor_id = vendors.id
       WHERE orders.delivery_status = 'ready' AND orders.rider_id IS NULL
       ORDER BY orders.created_at ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load available orders' });
  }
});

// Rider: claim an order (atomic — two riders can't both succeed)
router.put('/accept/:orderId', requireAuth, attachRiderId, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE orders SET rider_id = $1, delivery_status = 'picked_up'
       WHERE id = $2 AND delivery_status = 'ready' AND rider_id IS NULL RETURNING *`,
      [req.riderId, req.params.orderId]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'This order has already been claimed by another rider' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not accept order' });
  }
});

// Rider: my deliveries (active + past)
router.get('/me/deliveries', requireAuth, attachRiderId, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT orders.*, vendors.name AS vendor_name, vendors.address AS vendor_address
       FROM orders JOIN vendors ON orders.vendor_id = vendors.id
       WHERE orders.rider_id = $1
       ORDER BY orders.created_at DESC`,
      [req.riderId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load your deliveries' });
  }
});

// Rider: update delivery status on one of MY deliveries. Marking
// "delivered" also syncs the vendor-facing order_status and texts the
// customer, so every party's view stays in sync from one action.
router.put('/deliveries/:orderId/status', requireAuth, attachRiderId, async (req, res) => {
  const { delivery_status } = req.body;
  const valid = ['picked_up', 'in_transit', 'delivered'];
  if (!valid.includes(delivery_status)) {
    return res.status(400).json({ error: 'Invalid delivery status' });
  }
  try {
    const orderStatusUpdate = delivery_status === 'delivered' ? `, order_status = 'delivered'` : '';
    const result = await pool.query(
      `UPDATE orders SET delivery_status = $1 ${orderStatusUpdate}
       WHERE id = $2 AND rider_id = $3 RETURNING *`,
      [delivery_status, req.params.orderId, req.riderId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Delivery not found' });

    if (delivery_status === 'delivered') {
      const order = result.rows[0];
      sendSMS(order.phone, `Your order #${order.id} from Ilé Market has been delivered. Enjoy your meal!`);
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update delivery status' });
  }
});

module.exports = router;
