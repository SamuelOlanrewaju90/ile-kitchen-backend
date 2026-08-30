const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const { createOrder } = require('../lib/createOrder');

const router = express.Router();

function verifySignature(rawBody, signature) {
  if (!signature) return false;
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest('hex');
  return hash === signature;
}

// Paystack calls this directly from their own servers — not from the
// customer's browser — so it still fires even if the customer closes
// the tab the instant payment succeeds. This is what makes payment
// confirmation reliable instead of depending only on the frontend
// callback (which is what this app used before Section 6).
//
// IMPORTANT: this route needs the RAW request body (a Buffer) to verify
// the signature, so it's mounted in server.js with express.raw() BEFORE
// the global express.json() middleware. Do not add express.json() above
// this route.
router.post('/paystack', async (req, res) => {
  const signature = req.headers['x-paystack-signature'];

  if (!verifySignature(req.body, signature)) {
    console.error('Webhook: invalid Paystack signature, rejecting request.');
    return res.sendStatus(401);
  }

  let event;
  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch (err) {
    return res.sendStatus(400);
  }

  // Acknowledge immediately. Paystack retries on anything other than a
  // fast 2xx, and we don't want a slow DB round-trip to cause duplicate
  // retries or a timeout on their end.
  res.sendStatus(200);

  if (event.event !== 'charge.success') return;

  const data = event.data;
  const reference = data.reference;

  try {
    const existing = await pool.query(
      'SELECT id, payment_status FROM orders WHERE payment_reference = $1',
      [reference]
    );

    if (existing.rows.length > 0) {
      // The frontend callback already created this order (the normal,
      // common case). Just make sure it's marked paid and move on.
      if (existing.rows[0].payment_status !== 'paid') {
        await pool.query('UPDATE orders SET payment_status = $1 WHERE id = $2', ['paid', existing.rows[0].id]);
        console.log(`Webhook: marked order #${existing.rows[0].id} as paid.`);
      }
      return;
    }

    // No order exists yet for this reference — the customer's browser
    // most likely closed before the frontend callback fired. Rebuild
    // the order from the metadata we attached when the Paystack popup
    // was opened (see Checkout.jsx).
    const metadata = data.metadata || {};
    const { vendor_id, customer_name, phone, address, notes, items } = metadata;

    if (!vendor_id || !customer_name || !phone || !address || !items) {
      console.error(`Webhook: charge.success for ${reference} but no usable order metadata was attached — cannot recover this order automatically. Check Paystack dashboard for the transaction and follow up with the customer manually.`);
      return;
    }

    const parsedItems = typeof items === 'string' ? JSON.parse(items) : items;

    const order = await createOrder({
      vendor_id,
      customer_name,
      phone,
      address,
      notes,
      items: parsedItems,
      payment_method: 'paystack',
      payment_status: 'paid',
      payment_reference: reference
    });

    console.log(`Webhook: created order #${order.id} for reference ${reference} — the frontend never confirmed it, but payment succeeded.`);
  } catch (err) {
    console.error('Webhook processing error:', err);
  }
});

module.exports = router;
