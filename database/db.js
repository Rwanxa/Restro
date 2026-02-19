const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// Ensure the data directory exists for persistent storage
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const DB_PATH = path.join(dataDir, 'restaurant.db');
console.log(`📁 Database path: ${DB_PATH}`);

let db;

function getDb() {
  if (!db) {
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) console.error('DB connection error:', err);
      else console.log('✅ Connected to SQLite database');
    });
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA foreign_keys = ON');
  }
  return db;
}

// Promisified helpers
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function initializeSchema() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS Users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('super_admin', 'staff')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS Products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      photo_url TEXT,
      manufacturing_cost REAL NOT NULL DEFAULT 0,
      selling_price REAL NOT NULL DEFAULT 0,
      sell_count INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS ProductIngredients (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      raw_material_id TEXT NOT NULL,
      quantity_used REAL NOT NULL CHECK(quantity_used > 0),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES Products(id) ON DELETE CASCADE,
      FOREIGN KEY (raw_material_id) REFERENCES RawMaterials(id) ON DELETE RESTRICT,
      UNIQUE(product_id, raw_material_id)
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS RawMaterials (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      quantity_available REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL,
      cost_per_unit REAL NOT NULL DEFAULT 0,
      low_stock_threshold REAL NOT NULL DEFAULT 10,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration: add low_stock_threshold to existing databases that don't have it
  const rmCols = await dbAll("PRAGMA table_info(RawMaterials)");
  const hasThreshold = rmCols.some(c => c.name === 'low_stock_threshold');
  if (!hasThreshold) {
    await dbRun('ALTER TABLE RawMaterials ADD COLUMN low_stock_threshold REAL NOT NULL DEFAULT 10');
    console.log('✅ Migration: added low_stock_threshold column to RawMaterials');
  }

  await dbRun(`
    CREATE TABLE IF NOT EXISTS Sales (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      total_price REAL NOT NULL,
      total_profit REAL NOT NULL,
      date_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES Products(id) ON DELETE CASCADE
    )
  `);

  // Seed super admin if not exists
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

module.exports = { getDb, dbRun, dbGet, dbAll, initializeSchema };
