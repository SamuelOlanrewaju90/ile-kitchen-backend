const express = require('express');
const pool = require('../db');
const { requireOwner } = require('../middleware/auth');

const router = express.Router();

// Public: get all settings as a simple object, e.g. { restaurant_open: "true", ... }
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM settings');
    const settings = {};
    result.rows.forEach((row) => (settings[row.key] = row.value));
    res.json(settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load settings' });
  }
});

// Owner: update one or more settings at once, e.g. { restaurant_open: "false" }
router.put('/', requireOwner, async (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'No settings provided' });
  }
  try {
    for (const [key, value] of Object.entries(updates)) {
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2`,
        [key, String(value)]
      );
    }
    const result = await pool.query('SELECT key, value FROM settings');
    const settings = {};
    result.rows.forEach((row) => (settings[row.key] = row.value));
    res.json(settings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update settings' });
  }
});

module.exports = router;
