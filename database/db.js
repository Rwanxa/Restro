const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.warn('⚠️  DATABASE_URL is not set. Set it to your Postgres connection string.');
}

const shouldUseSsl =
  (process.env.PGSSL && process.env.PGSSL.toLowerCase() === 'true') ||
  (process.env.NODE_ENV === 'production' && process.env.PGSSL?.toLowerCase() !== 'false');

let pool;
function getPool() {
  if (!DATABASE_URL) {
    const err = new Error('DATABASE_URL is not set.');
    err.code = 'MISSING_DATABASE_URL';
    throw err;
  }
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

function toPgPlaceholders(sql) {
  if (!sql || typeof sql !== 'string' || sql.indexOf('?') === -1) return sql;
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

async function query(poolOrClient, sql, params = []) {
  const normalizedSql = toPgPlaceholders(sql);
  return poolOrClient.query(normalizedSql, params);
}

async function dbRun(sql, params = []) {
  const result = await query(getPool(), sql, params);
  return { changes: result.rowCount };
}

async function dbGet(sql, params = []) {
  const result = await query(getPool(), sql, params);
  return result.rows[0];
}

async function dbAll(sql, params = []) {
  const result = await query(getPool(), sql, params);
  return result.rows;
}

async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const tx = {
      run: async (sql, params = []) => {
        const result = await query(client, sql, params);
        return { changes: result.rowCount };
      },
      get: async (sql, params = []) => {
        const result = await query(client, sql, params);
        return result.rows[0];
      },
      all: async (sql, params = []) => {
        const result = await query(client, sql, params);
        return result.rows;
      },
    };
    const value = await fn(tx);
    await client.query('COMMIT');
    return value;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

async function initializeSchema() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS Users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('super_admin', 'staff')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS Products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      photo_url TEXT,
      manufacturing_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
      selling_price DOUBLE PRECISION NOT NULL DEFAULT 0,
      sell_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS RawMaterials (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      quantity_available DOUBLE PRECISION NOT NULL DEFAULT 0,
      unit TEXT NOT NULL,
      cost_per_unit DOUBLE PRECISION NOT NULL DEFAULT 0,
      low_stock_threshold DOUBLE PRECISION NOT NULL DEFAULT 10,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS ProductIngredients (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES Products(id) ON DELETE CASCADE,
      raw_material_id TEXT NOT NULL REFERENCES RawMaterials(id) ON DELETE RESTRICT,
      quantity_used DOUBLE PRECISION NOT NULL CHECK(quantity_used > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(product_id, raw_material_id)
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS Sales (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES Products(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL,
      total_price DOUBLE PRECISION NOT NULL,
      total_profit DOUBLE PRECISION NOT NULL,
      date_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await dbRun(`
    ALTER TABLE RawMaterials
    ADD COLUMN IF NOT EXISTS low_stock_threshold DOUBLE PRECISION NOT NULL DEFAULT 10
  `);

  const admin = await dbGet("SELECT id FROM Users WHERE role = 'super_admin' LIMIT 1");
  if (!admin) {
    const hashedPassword = bcrypt.hashSync('admin123', 12);
    await dbRun(
      'INSERT INTO Users (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), 'Super Admin', 'admin@restaurant.com', hashedPassword, 'super_admin']
    );
    console.log('✅ Default super admin created: admin@restaurant.com / admin123');
  }
}

module.exports = { dbRun, dbGet, dbAll, withTransaction, initializeSchema };
