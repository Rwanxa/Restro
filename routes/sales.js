const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { dbRun, dbGet, dbAll, withTransaction } = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

function parseCheckoutItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error('At least one cart item is required.');
  }
  const byProduct = new Map();
  for (const item of rawItems) {
    const productId = item?.product_id;
    const quantity = Number(item?.quantity);
    if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('Each cart item must include product_id and quantity > 0.');
    }
    byProduct.set(productId, (byProduct.get(productId) || 0) + quantity);
  }
  return Array.from(byProduct.entries()).map(([product_id, quantity]) => ({ product_id, quantity }));
}

async function executeCheckout(rawItems) {
  const items = parseCheckoutItems(rawItems);
  const productIds = items.map(i => i.product_id);
  const placeholders = productIds.map(() => '?').join(',');

  return withTransaction(async (tx) => {
    const products = await tx.all(`
      SELECT id, name, selling_price, manufacturing_cost,
             (selling_price - manufacturing_cost) as profit_per_item
      FROM Products
      WHERE id IN (${placeholders})
    `, productIds);
    const productById = new Map(products.map(p => [p.id, p]));
    for (const item of items) {
      if (!productById.has(item.product_id)) throw new Error('One or more products no longer exist.');
    }

    const ingredientRows = await tx.all(`
      SELECT pi.product_id, pi.raw_material_id, pi.quantity_used,
             rm.name as raw_material_name, rm.unit as raw_material_unit, rm.quantity_available
      FROM ProductIngredients pi
      JOIN RawMaterials rm ON rm.id = pi.raw_material_id
      WHERE pi.product_id IN (${placeholders})
    `, productIds);

    const requiredByMaterial = new Map();
    const materialMeta = new Map();
    for (const row of ingredientRows) {
      materialMeta.set(row.raw_material_id, {
        name: row.raw_material_name,
        unit: row.raw_material_unit,
        available: Number(row.quantity_available || 0),
      });
    }

    for (const item of items) {
      const ingredients = ingredientRows.filter(r => r.product_id === item.product_id);
      for (const ing of ingredients) {
        const needed = Number(ing.quantity_used) * Number(item.quantity);
        requiredByMaterial.set(ing.raw_material_id, (requiredByMaterial.get(ing.raw_material_id) || 0) + needed);
      }
    }

    const insufficiencies = [];
    for (const [materialId, required] of requiredByMaterial.entries()) {
      const meta = materialMeta.get(materialId);
      if (!meta) continue;
      if (required > meta.available) {
        insufficiencies.push({
          raw_material_id: materialId,
          raw_material_name: meta.name,
          required,
          available: meta.available,
          unit: meta.unit,
        });
      }
    }
    if (insufficiencies.length > 0) {
      const err = new Error('Insufficient raw materials for this sale.');
      err.status = 400;
      err.details = insufficiencies;
      throw err;
    }

    const salesCreated = [];
    let totalBill = 0;
    let totalProfit = 0;
    let totalItems = 0;

    for (const item of items) {
      const p = productById.get(item.product_id);
      const total_price = Number(p.selling_price) * Number(item.quantity);
      const line_profit = Number(p.profit_per_item) * Number(item.quantity);
      const saleId = uuidv4();

      await tx.run(
        'INSERT INTO Sales (id, product_id, quantity, total_price, total_profit) VALUES (?, ?, ?, ?, ?)',
        [saleId, item.product_id, item.quantity, total_price, line_profit]
      );
      await tx.run('UPDATE Products SET sell_count = sell_count + ? WHERE id = ?', [item.quantity, item.product_id]);

      totalBill += total_price;
      totalProfit += line_profit;
      totalItems += Number(item.quantity);
      salesCreated.push({
        id: saleId,
        product_id: item.product_id,
        product_name: p.name,
        quantity: item.quantity,
        total_price,
        total_profit: line_profit,
      });
    }

    for (const [materialId, required] of requiredByMaterial.entries()) {
      const result = await tx.run(
        'UPDATE RawMaterials SET quantity_available = quantity_available - ? WHERE id = ? AND quantity_available >= ?',
        [required, materialId, required]
      );
      if (result.changes !== 1) {
        throw new Error('Stock changed during checkout. Please try again.');
      }
    }

    return {
      sales: salesCreated,
      total_bill: totalBill,
      total_profit: totalProfit,
      total_items: totalItems,
      transaction_count: salesCreated.length,
    };
  });
}

// GET /api/sales
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { from, to, product_id } = req.query;
    let query = `
      SELECT s.id, s.product_id, s.quantity, s.total_price, s.total_profit, s.date_time,
             p.name as product_name
      FROM Sales s
      LEFT JOIN Products p ON s.product_id = p.id
      WHERE 1=1
    `;
    const params = [];
    if (from) { query += ' AND s.date_time >= ?'; params.push(from); }
    if (to) { query += ' AND s.date_time <= ?'; params.push(to); }
    if (product_id) { query += ' AND s.product_id = ?'; params.push(product_id); }
    query += ' ORDER BY s.date_time DESC';

    const sales = await dbAll(query, params);
    res.json(sales);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/sales/summary
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const summary = await dbGet(`
      SELECT
        COUNT(*) as total_transactions,
        COALESCE(SUM(quantity), 0) as total_items_sold,
        COALESCE(SUM(total_price), 0) as total_revenue,
        COALESCE(SUM(total_profit), 0) as total_profit
      FROM Sales
    `);
    res.json(summary);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/sales
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { product_id, quantity } = req.body;
    const result = await executeCheckout([{ product_id, quantity }]);
    res.status(201).json(result.sales[0]);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, details: err.details || undefined });
  }
});

// POST /api/sales/checkout
router.post('/checkout', authenticateToken, async (req, res) => {
  try {
    const result = await executeCheckout(req.body?.items);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, details: err.details || undefined });
  }
});

// DELETE /api/sales/:id
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Only super admin can delete sales records.' });
    await dbRun('DELETE FROM Sales WHERE id = ?', [req.params.id]);
    res.json({ message: 'Sale record deleted.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
