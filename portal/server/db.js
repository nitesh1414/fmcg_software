// SQLite database for the RightServe centralized portal.
// Stores portal users (admin + salespeople), clients, and issued licenses.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.PORTAL_DB_PATH || path.join(DATA_DIR, 'portal.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'sales',          -- admin | sales
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_name TEXT NOT NULL,
  contact_person TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  city TEXT DEFAULT '',
  gstin TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, -- salesperson
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id TEXT NOT NULL UNIQUE,             -- RS-XXXXXXXX (inside the key)
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  plan TEXT DEFAULT 'Standard',
  issued TEXT NOT NULL,                         -- YYYY-MM-DD
  expires TEXT,                                 -- YYYY-MM-DD or NULL = perpetual
  perpetual INTEGER NOT NULL DEFAULT 0,
  machine TEXT DEFAULT '',                      -- machine lock (optional)
  reminder_days INTEGER NOT NULL DEFAULT 15,
  notes TEXT DEFAULT '',
  license_key TEXT NOT NULL,                    -- full RSL1.<payload>.<sig> block
  status TEXT NOT NULL DEFAULT 'active',        -- active | renewed | revoked
  superseded_by INTEGER REFERENCES licenses(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_clients_creator ON clients(created_by);
CREATE INDEX IF NOT EXISTS idx_licenses_client ON licenses(client_id);
`);

// --- forward-compatible migrations (add columns to existing DBs) ---
function ensureColumn(table, col, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
// One-time activation binding: which machine claimed the key, and when.
ensureColumn('licenses', 'activated_machine', "activated_machine TEXT NOT NULL DEFAULT ''");
ensureColumn('licenses', 'activated_at', "activated_at TEXT NOT NULL DEFAULT ''");
ensureColumn('licenses', 'activation_count', 'activation_count INTEGER NOT NULL DEFAULT 0');
ensureColumn('licenses', 'carried_days', 'carried_days INTEGER NOT NULL DEFAULT 0');

module.exports = db;
module.exports.DB_PATH = DB_PATH;
