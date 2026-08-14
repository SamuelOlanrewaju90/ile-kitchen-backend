require('dotenv').config();
const express = require('express');
const cors = require('cors');

const menuRoutes = require('./routes/menu');
const orderRoutes = require('./routes/orders');
const authRoutes = require('./routes/auth');
const settingsRoutes = require('./routes/settings');
const reviewsRoutes = require('./routes/reviews');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.json({ status: 'Ile Kitchen API is running' }));

app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/reviews', reviewsRoutes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
