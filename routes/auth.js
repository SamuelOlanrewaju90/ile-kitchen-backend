const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const router = express.Router();

// Owner credentials come from environment variables, not the database,
// since there's only ever one owner. OWNER_PASSWORD_HASH is a bcrypt hash
// (see instructions.md for how to generate it).
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  if (username !== process.env.OWNER_USERNAME) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const match = await bcrypt.compare(password, process.env.OWNER_PASSWORD_HASH);
  if (!match) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = jwt.sign({ role: 'owner', username }, process.env.JWT_SECRET, {
    expiresIn: '7d'
  });

  res.json({ token });
});

module.exports = router;
