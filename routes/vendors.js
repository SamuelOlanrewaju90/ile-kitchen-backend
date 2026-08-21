const express = require('express');
const pool = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Public: browse approved vendors (Section 4 will add filtering/search on top of this)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, description, logo_url, cuisine_type, address, is_open
       FROM vendors WHERE is_approved = true ORDER BY name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load vendors' });
  }
});

// Public: one vendor's storefront profile
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, description, logo_url, cuisine_type, address, is_open
       FROM vendors WHERE id = $1 AND is_approved = true`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Vendor not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load vendor' });
  }
});

// Vendor: create your vendor profile — step 2 of onboarding, after
// registering a "vendor" account via /api/auth/register. Starts
// unapproved until an admin reviews it.
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

// Vendor: get my own profile (works even before approval, so the
// dashboard can show a "pending approval" state)
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

// Vendor: update my own profile, including the open/closed toggle
router.put('/me/profile', requireAuth, async (req, res) => {
  const { name, description, logo_url, cuisine_type, address, is_open } = req.body;
  try {
    const result = await pool.query(
      `UPDATE vendors SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        logo_url = COALESCE($3, logo_url),
        cuisine_type = COALESCE($4, cuisine_type),
        address = COALESCE($5, address),
        is_open = COALESCE($6, is_open)
       WHERE owner_id = $7 RETURNING *`,
      [name, description, logo_url, cuisine_type, address, is_open, req.user.id]
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

// Admin: platform-wide numbers
router.get('/admin/stats', requireAdmin, async (req, res) => {
  try {
    const vendorCount = await pool.query('SELECT COUNT(*)::int AS count FROM vendors');
    const approvedCount = await pool.query('SELECT COUNT(*)::int AS count FROM vendors WHERE is_approved = true');
    const orderCount = await pool.query('SELECT COUNT(*)::int AS count FROM orders');
    const revenue = await pool.query(
      "SELECT COALESCE(SUM(total), 0)::float AS total FROM orders WHERE payment_status = 'paid' OR payment_method = 'cod'"
    );
    res.json({
      vendors: vendorCount.rows[0].count,
      approvedVendors: approvedCount.rows[0].count,
      orders: orderCount.rows[0].count,
      revenue: revenue.rows[0].total
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load platform stats' });
  }
});

module.exports = router;
