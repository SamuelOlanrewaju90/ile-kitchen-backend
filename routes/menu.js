const express = require('express');
const pool = require('../db');
const { requireAuth, attachVendorId } = require('../middleware/auth');

const router = express.Router();

// Public: menu for one vendor's storefront
router.get('/', async (req, res) => {
  const { vendor_id } = req.query;
  if (!vendor_id) return res.status(400).json({ error: 'vendor_id is required' });
  try {
    const result = await pool.query(
      'SELECT * FROM menu_items WHERE vendor_id = $1 AND available = true ORDER BY category, id',
      [vendor_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load menu' });
  }
});

// Vendor: my full menu, including unavailable items
router.get('/mine', requireAuth, attachVendorId, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM menu_items WHERE vendor_id = $1 ORDER BY category, id',
      [req.vendorId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load menu' });
  }
});

// Vendor: add an item to my menu
router.post('/', requireAuth, attachVendorId, async (req, res) => {
  const { name, description, price, image_url, category } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Name and price are required' });
  try {
    const result = await pool.query(
      `INSERT INTO menu_items (vendor_id, name, description, price, image_url, category)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.vendorId, name, description || '', price, image_url || '', category || 'Mains']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not add menu item' });
  }
});

// Vendor: update one of my items (ownership enforced in the WHERE clause,
// not just by checking who's logged in — so vendor A can never edit vendor B's item)
router.put('/:id', requireAuth, attachVendorId, async (req, res) => {
  const { name, description, price, image_url, category, available, featured } = req.body;
  try {
    const result = await pool.query(
      `UPDATE menu_items SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        price = COALESCE($3, price),
        image_url = COALESCE($4, image_url),
        category = COALESCE($5, category),
        available = COALESCE($6, available),
        featured = COALESCE($7, featured)
       WHERE id = $8 AND vendor_id = $9 RETURNING *`,
      [name, description, price, image_url, category, available, featured, req.params.id, req.vendorId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update menu item' });
  }
});

router.delete('/:id', requireAuth, attachVendorId, async (req, res) => {
  try {
    await pool.query('DELETE FROM menu_items WHERE id = $1 AND vendor_id = $2', [req.params.id, req.vendorId]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete menu item' });
  }
});

module.exports = router;
