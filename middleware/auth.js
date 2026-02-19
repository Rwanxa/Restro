const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'restaurant_saas_super_secret_key_2024';
const JWT_EXPIRES_IN = '24h';

function generateToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
    return jwt.verify(token, JWT_SECRET);
}

function authenticateToken(req, res, next) {
    const token = req.cookies?.token || req.headers['authorization']?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }
    try {
        const decoded = verifyToken(token);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(403).json({ error: 'Invalid or expired token.' });
    }
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions.' });
        }
        next();
    };
}

module.exports = { generateToken, verifyToken, authenticateToken, requireRole };
