const jwt = require('jsonwebtoken');
const pool = require('../db');

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    req.user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Admin access only' });
    next();
  });
}

// Looks up the vendor row owned by the logged-in user and attaches its id
// to req.vendorId, so vendor-only routes can scope every query to just
// that vendor's own data.
async function attachVendorId(req, res, next) {
  try {
    const result = await pool.query('SELECT id FROM vendors WHERE owner_id = $1', [req.user.id]);
    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'No vendor profile found for this account. Create one first.' });
    }
    req.vendorId = result.rows[0].id;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not verify vendor account' });
  }
}

// Looks up the rider row for the logged-in user and attaches its id
// to req.riderId, so rider-only routes can scope every query to just
// that rider's own deliveries.
async function attachRiderId(req, res, next) {
  try {
    const result = await pool.query('SELECT id FROM riders WHERE user_id = $1', [req.user.id]);
    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'No rider profile found for this account.' });
    }
    req.riderId = result.rows[0].id;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not verify rider account' });
  }
}

module.exports = { requireAuth, requireAdmin, attachVendorId, attachRiderId };
