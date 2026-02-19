const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure public/uploads directory exists
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/raw-materials', require('./routes/rawMaterials'));
app.use('/api/sales', require('./routes/sales'));

// Serve frontend for all other routes (SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize database schema then start server
const { initializeSchema } = require('./database/db');

initializeSchema()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`\n🚀 RestaurantOS running at http://localhost:${PORT}`);
            console.log(`📁 Database: ${path.join(__dirname, 'data', 'restaurant.db')}`);
            console.log(`🔑 Default login: admin@restaurant.com / admin123\n`);
        });
    })
    .catch((err) => {
        console.error('❌ Failed to initialize database:', err);
        process.exit(1);
    });
