const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('../db');

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, is_admin: user.is_admin },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// Register as a vendor or rider. Admin accounts are never created through
// this endpoint — only granted manually in the database — since letting
// anyone self-serve admin access would be a serious security hole.
router.post('/register', async (req, res) => {
  const { name, email, phone, password, role } = req.body;
  if (!name || !email || !password || !['vendor', 'rider'].includes(role)) {
    return res.status(400).json({ error: 'Name, email, password, and a role of vendor or rider are required' });
  }
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'An account with this email already exists' });
    }
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, role)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role, is_admin`,
      [name, email, phone || '', hash, role]
    );
    const user = result.rows[0];
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create account' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    res.json({
      token: signToken(user),
      user: { id: user.id, name: user.name, email: user.email, role: user.role, is_admin: user.is_admin }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not log in' });
  }
});

module.exports = router;
