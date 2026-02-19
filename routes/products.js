const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { dbRun, dbGet, dbAll, withTransaction } = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

// Setup multer for photo uploads
const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `product_${Date.now()}${ext}`);
    }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

function parseIngredientsPayload(rawValue) {
    if (!rawValue) return [];
    let parsed = rawValue;
    if (typeof rawValue === 'string') {
        try {
            parsed = JSON.parse(rawValue);
        } catch (_) {
            throw new Error('Invalid ingredients payload.');
        }
    }
    if (!Array.isArray(parsed)) throw new Error('Ingredients must be an array.');
    return parsed;
}

function getClientErrorStatus(message = '') {
    const clientErrors = [
        'Invalid ingredients payload.',
        'Ingredients must be an array.',
        'Each ingredient must include raw_material_id.',
        'Each ingredient quantity_used must be greater than 0.',
        'Duplicate raw material in ingredients.',
        'One or more ingredients reference invalid raw materials.'
    ];
    return clientErrors.includes(message) ? 400 : 500;
}

async function getIngredientsByProduct(productId) {
    return dbAll(`
      SELECT pi.id, pi.product_id, pi.raw_material_id, pi.quantity_used,
             rm.name as raw_material_name, rm.unit as raw_material_unit
      FROM ProductIngredients pi
      JOIN RawMaterials rm ON rm.id = pi.raw_material_id
      WHERE pi.product_id = ?
      ORDER BY rm.name ASC
    `, [productId]);
}

async function setProductIngredients(q, productId, ingredients) {
    await q.run('DELETE FROM ProductIngredients WHERE product_id = ?', [productId]);
    if (!ingredients || ingredients.length === 0) return 0;

    const seen = new Set();
    let manufacturingCost = 0;
    for (const item of ingredients) {
        const rawMaterialId = item.raw_material_id;
        const quantityUsed = Number(item.quantity_used);

        if (!rawMaterialId) throw new Error('Each ingredient must include raw_material_id.');
        if (!Number.isFinite(quantityUsed) || quantityUsed <= 0) {
            throw new Error('Each ingredient quantity_used must be greater than 0.');
        }
        if (seen.has(rawMaterialId)) throw new Error('Duplicate raw material in ingredients.');
        seen.add(rawMaterialId);

        const rawMaterial = await q.get('SELECT id, cost_per_unit FROM RawMaterials WHERE id = ?', [rawMaterialId]);
        if (!rawMaterial) throw new Error('One or more ingredients reference invalid raw materials.');
        manufacturingCost += quantityUsed * Number(rawMaterial.cost_per_unit || 0);

        await q.run(
            'INSERT INTO ProductIngredients (id, product_id, raw_material_id, quantity_used) VALUES (?, ?, ?, ?)',
            [uuidv4(), productId, rawMaterialId, quantityUsed]
        );
    }
    return manufacturingCost;
}

async function getProductById(productId) {
    const product = await dbGet(`
      SELECT id, name, photo_url, manufacturing_cost, selling_price,
             (selling_price - manufacturing_cost) as profit_per_item,
             sell_count, created_at
      FROM Products WHERE id = ?
    `, [productId]);
    if (!product) return null;
    product.ingredients = await getIngredientsByProduct(productId);
    return product;
}

// GET /api/products
router.get('/', authenticateToken, async (req, res) => {
    try {
        const products = await dbAll(`
      SELECT id, name, photo_url, manufacturing_cost, selling_price,
             (selling_price - manufacturing_cost) as profit_per_item,
             sell_count, created_at
      FROM Products ORDER BY created_at DESC
    `);
        const ingredientRows = await dbAll(`
      SELECT pi.product_id, pi.raw_material_id, pi.quantity_used,
             rm.name as raw_material_name, rm.unit as raw_material_unit
      FROM ProductIngredients pi
      JOIN RawMaterials rm ON rm.id = pi.raw_material_id
      ORDER BY rm.name ASC
    `);
        const byProduct = ingredientRows.reduce((acc, row) => {
            if (!acc[row.product_id]) acc[row.product_id] = [];
            acc[row.product_id].push(row);
            return acc;
        }, {});

        const withIngredients = products.map(p => ({
            ...p,
            ingredients: byProduct[p.id] || []
        }));
        res.json(withIngredients);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/products/:id
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const product = await getProductById(req.params.id);
        if (!product) return res.status(404).json({ error: 'Product not found.' });
        res.json(product);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/products
router.post('/', authenticateToken, upload.single('photo'), async (req, res) => {
    try {
        const { name, selling_price } = req.body;
        const ingredients = parseIngredientsPayload(req.body.ingredients);
        if (!name || selling_price === undefined) {
            return res.status(400).json({ error: 'Name and selling price are required.' });
        }
        const id = uuidv4();
        const photo_url = req.file ? `/uploads/${req.file.filename}` : null;
        await withTransaction(async (tx) => {
            await tx.run(
                'INSERT INTO Products (id, name, photo_url, manufacturing_cost, selling_price) VALUES (?, ?, ?, ?, ?)',
                [id, name, photo_url, 0, parseFloat(selling_price)]
            );
            const manufacturingCost = await setProductIngredients(tx, id, ingredients);
            await tx.run('UPDATE Products SET manufacturing_cost = ? WHERE id = ?', [manufacturingCost, id]);
        });
        const product = await getProductById(id);
        res.status(201).json(product);
    } catch (err) {
        res.status(getClientErrorStatus(err.message)).json({ error: err.message });
    }
});

// PUT /api/products/:id
router.put('/:id', authenticateToken, upload.single('photo'), async (req, res) => {
    try {
        const existing = await dbGet('SELECT * FROM Products WHERE id = ?', [req.params.id]);
        if (!existing) return res.status(404).json({ error: 'Product not found.' });

        const { name, manufacturing_cost, selling_price } = req.body;
        const ingredients = req.body.ingredients !== undefined
            ? parseIngredientsPayload(req.body.ingredients)
            : null;
        const photo_url = req.file ? `/uploads/${req.file.filename}` : existing.photo_url;

        await withTransaction(async (tx) => {
            const nextManufacturingCost = ingredients !== null
                ? await setProductIngredients(tx, req.params.id, ingredients)
                : (manufacturing_cost !== undefined ? parseFloat(manufacturing_cost) : existing.manufacturing_cost);
            await tx.run(
                'UPDATE Products SET name = ?, photo_url = ?, manufacturing_cost = ?, selling_price = ? WHERE id = ?',
                [
                    name || existing.name,
                    photo_url,
                    nextManufacturingCost,
                    selling_price !== undefined ? parseFloat(selling_price) : existing.selling_price,
                    req.params.id
                ]
            );
        });
        const updated = await getProductById(req.params.id);
        res.json(updated);
    } catch (err) {
        res.status(getClientErrorStatus(err.message)).json({ error: err.message });
    }
});

// DELETE /api/products/:id
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Only super admin can delete products.' });
        await dbRun('DELETE FROM Products WHERE id = ?', [req.params.id]);
        res.json({ message: 'Product deleted.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
