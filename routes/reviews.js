const express = require('express');
const pool = require('../db');

const router = express.Router();

router.get('/summary', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count, COALESCE(AVG(rating), 0)::float AS average FROM reviews`
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load review summary' });
  }
});

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT reviews.id, reviews.rating, reviews.comment, reviews.created_at, orders.customer_name
       FROM reviews
       JOIN orders ON reviews.order_id = orders.id
       ORDER BY reviews.created_at DESC
       LIMIT 20`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load reviews' });
  }
});

router.get('/vendor/:vendorId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT reviews.id, reviews.rating, reviews.comment, reviews.created_at, orders.customer_name
       FROM reviews
       JOIN orders ON reviews.order_id = orders.id
       WHERE orders.vendor_id = $1
       ORDER BY reviews.created_at DESC
       LIMIT 10`,
      [req.params.vendorId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load vendor reviews' });
  }
});

router.post('/', async (req, res) => {
  const { order_id, rating, comment } = req.body;
  const numericRating = Number(rating);
  if (!order_id || !numericRating || numericRating < 1 || numericRating > 5) {
    return res.status(400).json({ error: 'A valid order and a rating from 1 to 5 are required' });
  }
  try {
    const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [order_id]);
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    if (orderResult.rows[0].order_status !== 'delivered') {
      return res.status(400).json({ error: 'You can only review orders that have been delivered' });
    }
    const result = await pool.query(
      'INSERT INTO reviews (order_id, rating, comment) VALUES ($1, $2, $3) RETURNING *',
      [order_id, numericRating, comment || '']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'This order has already been reviewed' });
    }
    console.error(err);
    res.status(500).json({ error: 'Could not submit review' });
  }
});

module.exports = router;
