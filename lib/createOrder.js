const pool = require('../db');
const { sendSMS } = require('./sms');

const DELIVERY_FEE = 500;

async function notifyUser(userId, type, message, orderId = null) {
  try {
    await pool.query(
      'INSERT INTO notifications (user_id, type, message, order_id) VALUES ($1, $2, $3, $4)',
      [userId, type, message, orderId]
    );
  } catch (err) {
    console.error('Could not create notification:', err);
  }
}

// Shared order-creation logic. Used by the normal checkout flow
// (routes/orders.js, after the frontend callback fires) AND by the
// Paystack webhook (routes/webhooks.js, when the frontend callback never
// fires because the customer closed their browser mid-payment). Both
// paths end up with identical fee splitting, SMS, and notifications —
// there's only one place this logic lives.
async function createOrder({ vendor_id, customer_name, phone, address, notes, items, payment_method, payment_status, payment_reference }) {
  const vendorResult = await pool.query(
    `SELECT vendors.*, users.phone AS owner_phone
     FROM vendors JOIN users ON vendors.owner_id = users.id
     WHERE vendors.id = $1`,
    [vendor_id]
  );
  const vendor = vendorResult.rows[0];
  if (!vendor) {
    throw new Error(`Vendor ${vendor_id} not found`);
  }

  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const total = subtotal + DELIVERY_FEE;

  const platform_fee = Math.round(subtotal * (Number(vendor.commission_rate) / 100) * 100) / 100;
  const vendor_payout = Math.round((subtotal - platform_fee) * 100) / 100;
  const rider_fee = DELIVERY_FEE;

  const result = await pool.query(
    `INSERT INTO orders
      (vendor_id, customer_name, phone, address, notes, items, subtotal, delivery_fee, total,
       payment_method, payment_status, payment_reference, platform_fee, vendor_payout, rider_fee)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [
      vendor_id,
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
      payment_reference || null,
      platform_fee,
      vendor_payout,
      rider_fee
    ]
  );
  const order = result.rows[0];

  // Fire-and-forget: none of this blocks the caller, failures are logged not thrown.
  sendSMS(phone, `Ilé Market: Thanks ${customer_name.split(' ')[0]}! Order #${order.id} from ${vendor.name} received — total ₦${total.toLocaleString()}.`);
  if (vendor.owner_phone) {
    sendSMS(vendor.owner_phone, `Ilé Market: New order #${order.id} from ${customer_name} — ₦${total.toLocaleString()}. Check your dashboard.`);
  }
  notifyUser(vendor.owner_id, 'new_order', `New order #${order.id} from ${customer_name} — ₦${total.toLocaleString()}`, order.id);

  return order;
}

module.exports = { createOrder, DELIVERY_FEE };
