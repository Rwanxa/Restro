const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { dbRun, dbGet, dbAll } = require('../database/db');
const { generateToken, authenticateToken } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

        const user = await dbGet('SELECT * FROM Users WHERE email = ?', [email.toLowerCase().trim()]);
        if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

        const isValid = bcrypt.compareSync(password, user.password);
        if (!isValid) return res.status(401).json({ error: 'Invalid email or password.' });

        const token = generateToken({ id: user.id, name: user.name, email: user.email, role: user.role });
        res.cookie('token', token, { httpOnly: true, secure: false, maxAge: 24 * 60 * 60 * 1000, sameSite: 'strict' });
        res.json({ message: 'Login successful', user: { id: user.id, name: user.name, email: user.email, role: user.role }, token });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ message: 'Logged out successfully.' });
});

// GET /api/auth/me
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const user = await dbGet('SELECT id, name, email, role, created_at FROM Users WHERE id = ?', [req.user.id]);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/auth/register (super_admin only)
router.post('/register', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Only super admin can create users.' });
        const { name, email, password, role } = req.body;
        if (!name || !email || !password || !role) return res.status(400).json({ error: 'All fields are required.' });
        if (!['super_admin', 'staff'].includes(role)) return res.status(400).json({ error: 'Invalid role.' });

        const existing = await dbGet('SELECT id FROM Users WHERE email = ?', [email.toLowerCase().trim()]);
        if (existing) return res.status(409).json({ error: 'Email already in use.' });

        const id = uuidv4();
        const hashedPassword = bcrypt.hashSync(password, 12);
        await dbRun('INSERT INTO Users (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)',
            [id, name, email.toLowerCase().trim(), hashedPassword, role]);
        res.status(201).json({ message: 'User created successfully.', id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/auth/users (super_admin only)
router.get('/users', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Access denied.' });
        const users = await dbAll('SELECT id, name, email, role, created_at FROM Users ORDER BY created_at DESC');
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/auth/users/:id (super_admin only)
router.delete('/users/:id', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Access denied.' });
        if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account.' });
        await dbRun('DELETE FROM Users WHERE id = ?', [req.params.id]);
        res.json({ message: 'User deleted.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
