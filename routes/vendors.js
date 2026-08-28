const express = require('express');
const pool = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Public: browse approved vendors, with optional search/filter/sort.
// Query params (all optional): search, cuisine, open_only, min_rating, sort
router.get('/', async (req, res) => {
  const { search, cuisine, open_only, min_rating, sort } = req.query;

  const conditions = ['vendors.is_approved = true'];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(vendors.name ILIKE $${params.length} OR vendors.cuisine_type ILIKE $${params.length})`);
  }
  if (cuisine) {
    params.push(cuisine);
    conditions.push(`vendors.cuisine_type = $${params.length}`);
  }
  if (open_only === 'true') {
    conditions.push('vendors.is_open = true');
  }

  let havingClause = '';
  if (min_rating) {
    params.push(Number(min_rating));
    havingClause = `HAVING COALESCE(AVG(reviews.rating), 0) >= $${params.length}`;
  }

  let orderClause = 'vendors.name ASC';
  if (sort === 'rating') orderClause = 'average_rating DESC NULLS LAST, vendors.name ASC';
  if (sort === 'newest') orderClause = 'vendors.created_at DESC';

  try {
    const result = await pool.query(
      `SELECT vendors.id, vendors.name, vendors.description, vendors.logo_url,
              vendors.cuisine_type, vendors.address, vendors.is_open,
              COALESCE(AVG(reviews.rating), 0)::float AS average_rating,
              COUNT(reviews.id)::int AS review_count
       FROM vendors
       LEFT JOIN orders ON orders.vendor_id = vendors.id
       LEFT JOIN reviews ON reviews.order_id = orders.id
       WHERE ${conditions.join(' AND ')}
       GROUP BY vendors.id
       ${havingClause}
       ORDER BY ${orderClause}`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load vendors' });
  }
});

// Public: distinct cuisine types among approved vendors, for a filter dropdown.
// Placed at a distinct path (not "/:id") so it's never mistaken for a vendor id.
router.get('/meta/cuisines', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT cuisine_type FROM vendors
       WHERE is_approved = true AND cuisine_type IS NOT NULL AND cuisine_type != ''
       ORDER BY cuisine_type`
    );
    res.json(result.rows.map((r) => r.cuisine_type));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load cuisine types' });
  }
});

// Public: one vendor's storefront profile, including its aggregate rating
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT vendors.id, vendors.name, vendors.description, vendors.logo_url,
              vendors.cuisine_type, vendors.address, vendors.is_open,
              vendors.commission_rate, vendors.paystack_subaccount_code,
              COALESCE(AVG(reviews.rating), 0)::float AS average_rating,
              COUNT(reviews.id)::int AS review_count
       FROM vendors
       LEFT JOIN orders ON orders.vendor_id = vendors.id
       LEFT JOIN reviews ON reviews.order_id = orders.id
       WHERE vendors.id = $1 AND vendors.is_approved = true
       GROUP BY vendors.id`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Vendor not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load vendor' });
  }
});

// Vendor: create your vendor profile
router.post('/', requireAuth, async (req, res) => {
  if (req.user.role !== 'vendor') {
    return res.status(403).json({ error: 'Only vendor accounts can create a vendor profile' });
  }
  const { name, description, logo_url, cuisine_type, address } = req.body;
  if (!name) return res.status(400).json({ error: 'Restaurant name is required' });
  try {
    const existing = await pool.query('SELECT id FROM vendors WHERE owner_id = $1', [req.user.id]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'You already have a vendor profile' });
    }
    const result = await pool.query(
      `INSERT INTO vendors (owner_id, name, description, logo_url, cuisine_type, address, is_approved, is_open)
       VALUES ($1, $2, $3, $4, $5, $6, false, true) RETURNING *`,
      [req.user.id, name, description || '', logo_url || '', cuisine_type || '', address || '']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create vendor profile' });
  }
});

// Vendor: get my own profile
router.get('/me/profile', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM vendors WHERE owner_id = $1', [req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'No vendor profile yet' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load your vendor profile' });
  }
});

// Vendor: update my own profile
router.put('/me/profile', requireAuth, async (req, res) => {
  const { name, description, logo_url, cuisine_type, address, is_open, paystack_subaccount_code } = req.body;
  try {
    const result = await pool.query(
      `UPDATE vendors SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        logo_url = COALESCE($3, logo_url),
        cuisine_type = COALESCE($4, cuisine_type),
        address = COALESCE($5, address),
        is_open = COALESCE($6, is_open),
        paystack_subaccount_code = COALESCE($7, paystack_subaccount_code)
       WHERE owner_id = $8 RETURNING *`,
      [name, description, logo_url, cuisine_type, address, is_open, paystack_subaccount_code, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'No vendor profile yet' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update vendor profile' });
  }
});

// Admin: list every vendor, including ones pending approval
router.get('/admin/all', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT vendors.*, users.name AS owner_name, users.email AS owner_email
       FROM vendors JOIN users ON vendors.owner_id = users.id
       ORDER BY vendors.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load vendors' });
  }
});

// Admin: approve or reject a vendor application
router.put('/admin/:id/approval', requireAdmin, async (req, res) => {
  const { is_approved } = req.body;
  try {
    const result = await pool.query(
      'UPDATE vendors SET is_approved = $1 WHERE id = $2 RETURNING *',
      [is_approved, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Vendor not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update vendor approval' });
  }
});

// Admin: change a vendor's commission rate
router.put('/admin/:id/commission', requireAdmin, async (req, res) => {
  const { commission_rate } = req.body;
  const rate = Number(commission_rate);
  if (isNaN(rate) || rate < 0 || rate > 100) {
    return res.status(400).json({ error: 'Commission rate must be a number between 0 and 100' });
  }
  try {
    const result = await pool.query(
      'UPDATE vendors SET commission_rate = $1 WHERE id = $2 RETURNING *',
      [rate, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Vendor not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update commission rate' });
  }
});

// Admin: platform-wide numbers
router.get('/admin/stats', requireAdmin, async (req, res) => {
  try {
    const vendorCount = await pool.query('SELECT COUNT(*)::int AS count FROM vendors');
    const approvedCount = await pool.query('SELECT COUNT(*)::int AS count FROM vendors WHERE is_approved = true');
    const orderCount = await pool.query('SELECT COUNT(*)::int AS count FROM orders');
    const revenue = await pool.query(
      "SELECT COALESCE(SUM(total), 0)::float AS total FROM orders WHERE payment_status = 'paid' OR payment_method = 'cod'"
    );
    const platformEarnings = await pool.query(
      "SELECT COALESCE(SUM(platform_fee), 0)::float AS total FROM orders WHERE order_status = 'delivered'"
    );
    res.json({
      vendors: vendorCount.rows[0].count,
      approvedVendors: approvedCount.rows[0].count,
      orders: orderCount.rows[0].count,
      revenue: revenue.rows[0].total,
      platformEarnings: platformEarnings.rows[0].total
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load platform stats' });
  }
});

module.exports = router;
