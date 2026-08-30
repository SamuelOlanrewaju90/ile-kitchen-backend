require('dotenv').config();
const express = require('express');
const cors = require('cors');

const menuRoutes = require('./routes/menu');
const orderRoutes = require('./routes/orders');
const authRoutes = require('./routes/auth');
const settingsRoutes = require('./routes/settings');
const reviewsRoutes = require('./routes/reviews');
const vendorRoutes = require('./routes/vendors');
const riderRoutes = require('./routes/riders');
const notificationRoutes = require('./routes/notifications');
const webhookRoutes = require('./routes/webhooks');

const app = express();

app.use(cors());

// IMPORTANT: the Paystack webhook needs the RAW request body (a Buffer)
// to verify its signature, so it's mounted here with its own raw parser
// BEFORE the global express.json() below. Every other route gets the
// normal JSON parser as usual. Do not move this below express.json().
app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);

app.use(express.json());

app.get('/', (req, res) => res.json({ status: 'Ile Kitchen marketplace API is running' }));

app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/reviews', reviewsRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/riders', riderRoutes);
app.use('/api/notifications', notificationRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
