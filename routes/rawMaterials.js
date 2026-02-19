const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { dbRun, dbGet, dbAll } = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

// GET /api/raw-materials
router.get('/', authenticateToken, async (req, res) => {
    try {
        const materials = await dbAll('SELECT * FROM RawMaterials ORDER BY created_at DESC');
        res.json(materials);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/raw-materials/low-stock  ← must be before /:id
router.get('/low-stock', authenticateToken, async (req, res) => {
    try {
        const items = await dbAll(
            'SELECT * FROM RawMaterials WHERE quantity_available < low_stock_threshold ORDER BY quantity_available ASC'
        );
        res.json({ count: items.length, items });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/raw-materials/:id
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const material = await dbGet('SELECT * FROM RawMaterials WHERE id = ?', [req.params.id]);
        if (!material) return res.status(404).json({ error: 'Raw material not found.' });
        res.json(material);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/raw-materials
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { name, quantity_available, unit, cost_per_unit, low_stock_threshold } = req.body;
        if (!name || quantity_available === undefined || !unit || cost_per_unit === undefined) {
            return res.status(400).json({ error: 'Name, quantity, unit, and cost per unit are required.' });
        }
        const id = uuidv4();
        const threshold = low_stock_threshold !== undefined ? parseFloat(low_stock_threshold) : 10;
        await dbRun(
            'INSERT INTO RawMaterials (id, name, quantity_available, unit, cost_per_unit, low_stock_threshold) VALUES (?, ?, ?, ?, ?, ?)',
            [id, name, parseFloat(quantity_available), unit, parseFloat(cost_per_unit), threshold]
        );
        const material = await dbGet('SELECT * FROM RawMaterials WHERE id = ?', [id]);
        res.status(201).json(material);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/raw-materials/:id
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const existing = await dbGet('SELECT * FROM RawMaterials WHERE id = ?', [req.params.id]);
        if (!existing) return res.status(404).json({ error: 'Raw material not found.' });

        const { name, quantity_available, unit, cost_per_unit, low_stock_threshold } = req.body;
        await dbRun(
            'UPDATE RawMaterials SET name = ?, quantity_available = ?, unit = ?, cost_per_unit = ?, low_stock_threshold = ? WHERE id = ?',
            [
                name || existing.name,
                quantity_available !== undefined ? parseFloat(quantity_available) : existing.quantity_available,
                unit || existing.unit,
                cost_per_unit !== undefined ? parseFloat(cost_per_unit) : existing.cost_per_unit,
                low_stock_threshold !== undefined ? parseFloat(low_stock_threshold) : existing.low_stock_threshold,
                req.params.id
            ]
        );
        const updated = await dbGet('SELECT * FROM RawMaterials WHERE id = ?', [req.params.id]);
        res.json(updated);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/raw-materials/:id
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Only super admin can delete raw materials.' });
        const existing = await dbGet('SELECT id FROM RawMaterials WHERE id = ?', [req.params.id]);
        if (!existing) return res.status(404).json({ error: 'Raw material not found.' });
        await dbRun('DELETE FROM RawMaterials WHERE id = ?', [req.params.id]);
        res.json({ message: 'Raw material deleted.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
