const express = require('express');
const pool = require('../db');
const { requireOwner } = require('../middleware/auth');

const router = express.Router();

// Public: list available menu items
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM menu_items WHERE available = true ORDER BY category, id'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load menu' });
  }
});

// Owner: list ALL menu items, including unavailable ones
router.get('/all', requireOwner, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM menu_items ORDER BY category, id');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load menu' });
  }
});

// Owner: add a menu item
router.post('/', requireOwner, async (req, res) => {
  const { name, description, price, image_url, category } = req.body;
  if (!name || !price) {
    return res.status(400).json({ error: 'Name and price are required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO menu_items (name, description, price, image_url, category)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, description || '', price, image_url || '', category || 'Mains']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not add menu item' });
  }
});

// Owner: update a menu item (e.g. toggle availability, change price)
router.put('/:id', requireOwner, async (req, res) => {
  const { id } = req.params;
  const { name, description, price, image_url, category, available } = req.body;
  try {
    const result = await pool.query(
      `UPDATE menu_items SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        price = COALESCE($3, price),
        image_url = COALESCE($4, image_url),
        category = COALESCE($5, category),
        available = COALESCE($6, available)
       WHERE id = $7 RETURNING *`,
      [name, description, price, image_url, category, available, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update menu item' });
  }
});

// Owner: delete a menu item
router.delete('/:id', requireOwner, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM menu_items WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete menu item' });
  }
});

module.exports = router;
