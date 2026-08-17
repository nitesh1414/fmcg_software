// SQLite database connection + schema bootstrap
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'fmcg.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',          -- admin | staff
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS company (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT 'My Distribution Co.',
  gstin TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  state TEXT DEFAULT '',
  state_code TEXT DEFAULT '',
  invoice_prefix TEXT DEFAULT 'INV',
  terms TEXT DEFAULT 'Goods once sold will not be taken back.',
  features TEXT DEFAULT '{}'
);

-- Multiple business profiles (firms). Item & party masters are SHARED across
-- all businesses; transactions (invoices, payments) and stock (batches) are
-- tagged per business. One business is flagged default.
CREATE TABLE IF NOT EXISTS businesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT 'My Business',
  gstin TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  state TEXT DEFAULT '',
  state_code TEXT DEFAULT '',
  invoice_prefix TEXT DEFAULT 'INV',
  terms TEXT DEFAULT 'Goods once sold will not be taken back.',
  fy_start_month INTEGER NOT NULL DEFAULT 4,
  is_default INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  UNIQUE(name, parent_id)
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sku TEXT DEFAULT '',
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  unit TEXT DEFAULT 'PCS',                      -- PCS, BOX, KG, LTR...
  hsn TEXT DEFAULT '',
  gst_rate REAL NOT NULL DEFAULT 0,             -- percent
  purchase_price REAL NOT NULL DEFAULT 0,
  sale_price REAL NOT NULL DEFAULT 0,
  low_stock_alert REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Batch-wise inventory: each batch tracks qty, mfg/expiry, cost, mrp
CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  batch_no TEXT NOT NULL,
  mfg_date TEXT DEFAULT '',
  expiry_date TEXT DEFAULT '',
  purchase_price REAL NOT NULL DEFAULT 0,
  mrp REAL NOT NULL DEFAULT 0,
  qty_in REAL NOT NULL DEFAULT 0,               -- total received into batch
  qty_available REAL NOT NULL DEFAULT 0,        -- current stock
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_batches_item ON batches(item_id);

CREATE TABLE IF NOT EXISTS parties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'customer',        -- customer | supplier
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  gstin TEXT DEFAULT '',
  address TEXT DEFAULT '',
  state TEXT DEFAULT '',
  opening_balance REAL NOT NULL DEFAULT 0,      -- + means they owe us
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Invoices cover both sales and purchases
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT NOT NULL,
  type TEXT NOT NULL,                           -- sale | purchase
  party_id INTEGER REFERENCES parties(id) ON DELETE SET NULL,
  date TEXT NOT NULL DEFAULT (date('now')),
  subtotal REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  tax_total REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  paid REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unpaid',        -- paid | partial | unpaid
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoices_type ON invoices(type);
CREATE INDEX IF NOT EXISTS idx_invoices_party ON invoices(party_id);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
  batch_id INTEGER REFERENCES batches(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  batch_no TEXT DEFAULT '',
  hsn TEXT DEFAULT '',
  qty REAL NOT NULL DEFAULT 0,
  price REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,             -- percent
  gst_rate REAL NOT NULL DEFAULT 0,
  taxable REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_inv ON invoice_items(invoice_id);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  party_id INTEGER REFERENCES parties(id) ON DELETE SET NULL,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  type TEXT NOT NULL,                           -- in | out
  amount REAL NOT NULL DEFAULT 0,
  mode TEXT DEFAULT 'cash',                     -- cash | upi | bank | cheque
  date TEXT NOT NULL DEFAULT (date('now')),
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_party ON payments(party_id);
`);

// --- Lightweight migrations for existing databases ---
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn('company', 'features', "features TEXT DEFAULT '{}'");
// Multi-level stock categories
ensureColumn('categories', 'parent_id', 'parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL');
// Average costing on items (moving average cost maintained on each purchase)
ensureColumn('items', 'avg_cost', 'avg_cost REAL NOT NULL DEFAULT 0');
// Financial year start month (1-12, India default = April = 4)
ensureColumn('company', 'fy_start_month', 'fy_start_month INTEGER NOT NULL DEFAULT 4');
// Last financial-year label the app saw — used to detect automatic FY rollover.
ensureColumn('company', 'last_fy', "last_fy TEXT NOT NULL DEFAULT ''");

// Credit/Debit note support on invoices.
//   note_kind: '' (normal) | 'credit' | 'debit'
//   ref_invoice_no / ref_invoice_date: original invoice the note adjusts (for CDNR/CDNUR)
ensureColumn('invoices', 'note_kind', "note_kind TEXT NOT NULL DEFAULT ''");
ensureColumn('invoices', 'ref_invoice_no', "ref_invoice_no TEXT NOT NULL DEFAULT ''");
ensureColumn('invoices', 'ref_invoice_date', "ref_invoice_date TEXT NOT NULL DEFAULT ''");
// Bill-level discounts: Trade discount, Cash Discount (CD), Special Discount (SD).
// Each has a value + a mode ('pct' | 'amt'); we store the value, the mode and
// the resolved rupee amount for reporting/print. The legacy `discount` column
// keeps the TOTAL discount (sum of the three) for backward compatibility.
ensureColumn('invoices', 'trade_disc_val', 'trade_disc_val REAL NOT NULL DEFAULT 0');
ensureColumn('invoices', 'trade_disc_mode', "trade_disc_mode TEXT NOT NULL DEFAULT 'amt'");
ensureColumn('invoices', 'trade_disc_amt', 'trade_disc_amt REAL NOT NULL DEFAULT 0');
ensureColumn('invoices', 'cd_val', 'cd_val REAL NOT NULL DEFAULT 0');
ensureColumn('invoices', 'cd_mode', "cd_mode TEXT NOT NULL DEFAULT 'amt'");
ensureColumn('invoices', 'cd_amt', 'cd_amt REAL NOT NULL DEFAULT 0');
ensureColumn('invoices', 'sd_val', 'sd_val REAL NOT NULL DEFAULT 0');
ensureColumn('invoices', 'sd_mode', "sd_mode TEXT NOT NULL DEFAULT 'amt'");
ensureColumn('invoices', 'sd_amt', 'sd_amt REAL NOT NULL DEFAULT 0');
// Per-user UI theme preferences (palette / density / text size) stored as JSON
ensureColumn('users', 'theme_prefs', "theme_prefs TEXT NOT NULL DEFAULT '{}'");
// User management: per-module access (JSON), active flag, security Q/A for admin
// password recovery, and audit of who created the user.
ensureColumn('users', 'permissions', "permissions TEXT NOT NULL DEFAULT '{}'");
ensureColumn('users', 'active', 'active INTEGER NOT NULL DEFAULT 1');
ensureColumn('users', 'sec_question', "sec_question TEXT NOT NULL DEFAULT ''");
ensureColumn('users', 'sec_answer_hash', "sec_answer_hash TEXT NOT NULL DEFAULT ''");
ensureColumn('users', 'created_by', 'created_by INTEGER');

// Ensure single company row exists (legacy global settings + features live here)
const companyExists = db.prepare('SELECT 1 FROM company WHERE id = 1').get();
if (!companyExists) {
  db.prepare('INSERT INTO company (id) VALUES (1)').run();
}

// Business branding images (stored as base64 data URIs) shown on bills.
ensureColumn('businesses', 'logo', "logo TEXT NOT NULL DEFAULT ''");
ensureColumn('businesses', 'signature', "signature TEXT NOT NULL DEFAULT ''");
ensureColumn('businesses', 'stamp', "stamp TEXT NOT NULL DEFAULT ''");

// Bank / payment details + QR shown on bills.
ensureColumn('businesses', 'bank_name', "bank_name TEXT NOT NULL DEFAULT ''");
ensureColumn('businesses', 'bank_account', "bank_account TEXT NOT NULL DEFAULT ''");
ensureColumn('businesses', 'bank_ifsc', "bank_ifsc TEXT NOT NULL DEFAULT ''");
ensureColumn('businesses', 'bank_branch', "bank_branch TEXT NOT NULL DEFAULT ''");
ensureColumn('businesses', 'account_holder', "account_holder TEXT NOT NULL DEFAULT ''");
ensureColumn('businesses', 'upi_id', "upi_id TEXT NOT NULL DEFAULT ''");
// A custom uploaded QR image (base64). Overrides auto UPI QR when present.
ensureColumn('businesses', 'qr_image', "qr_image TEXT NOT NULL DEFAULT ''");
// Extra bill-only terms/notes (in addition to the invoice `terms`).
ensureColumn('businesses', 'bill_terms', "bill_terms TEXT NOT NULL DEFAULT ''");
// Chosen bill layout: classic (default) | modern | compact | tally | vyapar | marg.
ensureColumn('businesses', 'bill_format', "bill_format TEXT NOT NULL DEFAULT 'classic'");
// Optional accent colour (hex) for the modern layout.
ensureColumn('businesses', 'bill_color', "bill_color TEXT NOT NULL DEFAULT '#1e40af'");

// --- Redesigned tax-invoice theming & custom texts -----------------------
// Full colour palette (each optional; falls back to derived shades of bill_color).
ensureColumn('businesses', 'bill_header_bg', "bill_header_bg TEXT NOT NULL DEFAULT ''");   // header band background
ensureColumn('businesses', 'bill_header_fg', "bill_header_fg TEXT NOT NULL DEFAULT ''");   // header band text
ensureColumn('businesses', 'bill_table_bg', "bill_table_bg TEXT NOT NULL DEFAULT ''");     // table header background
ensureColumn('businesses', 'bill_table_fg', "bill_table_fg TEXT NOT NULL DEFAULT ''");     // table header text
ensureColumn('businesses', 'bill_total_bg', "bill_total_bg TEXT NOT NULL DEFAULT ''");     // grand-total highlight background
ensureColumn('businesses', 'bill_total_fg', "bill_total_fg TEXT NOT NULL DEFAULT ''");     // grand-total highlight text
// Editable text labels on the invoice.
ensureColumn('businesses', 'bill_title', "bill_title TEXT NOT NULL DEFAULT ''");            // e.g. TAX INVOICE / BILL OF SUPPLY
ensureColumn('businesses', 'bill_signatory', "bill_signatory TEXT NOT NULL DEFAULT ''");    // e.g. Authorised Signatory / Proprietor
ensureColumn('businesses', 'bill_billto_label', "bill_billto_label TEXT NOT NULL DEFAULT ''"); // e.g. Bill To / Buyer
ensureColumn('businesses', 'bill_terms_heading', "bill_terms_heading TEXT NOT NULL DEFAULT ''"); // e.g. Terms & Conditions
ensureColumn('businesses', 'bill_declaration', "bill_declaration TEXT NOT NULL DEFAULT ''"); // declaration line
ensureColumn('businesses', 'bill_footer_note', "bill_footer_note TEXT NOT NULL DEFAULT ''"); // thank-you / footer line
// Terms stored as a JSON array of strings (list format). bill_terms kept for legacy.
ensureColumn('businesses', 'bill_terms_list', "bill_terms_list TEXT NOT NULL DEFAULT ''");

// Optional free-text description per invoice line (shown small under the item).
ensureColumn('invoice_items', 'description', "description TEXT NOT NULL DEFAULT ''");
// Per-line discounts: Trade, Cash (CD) and Special (SD). Percentage is the
// canonical value; the resolved rupee amount is stored alongside for print.
// Applied sequentially on the running line amount (gross → trade → cd → sd).
ensureColumn('invoice_items', 'disc_trade_pct', 'disc_trade_pct REAL NOT NULL DEFAULT 0');
ensureColumn('invoice_items', 'disc_trade_amt', 'disc_trade_amt REAL NOT NULL DEFAULT 0');
ensureColumn('invoice_items', 'disc_cd_pct', 'disc_cd_pct REAL NOT NULL DEFAULT 0');
ensureColumn('invoice_items', 'disc_cd_amt', 'disc_cd_amt REAL NOT NULL DEFAULT 0');
ensureColumn('invoice_items', 'disc_sd_pct', 'disc_sd_pct REAL NOT NULL DEFAULT 0');
ensureColumn('invoice_items', 'disc_sd_amt', 'disc_sd_amt REAL NOT NULL DEFAULT 0');
// How each per-line discount was entered: 'pct' (% of gross) or 'amt' (flat ₹).
ensureColumn('invoice_items', 'disc_trade_mode', "disc_trade_mode TEXT NOT NULL DEFAULT 'pct'");
ensureColumn('invoice_items', 'disc_cd_mode', "disc_cd_mode TEXT NOT NULL DEFAULT 'pct'");
ensureColumn('invoice_items', 'disc_sd_mode', "disc_sd_mode TEXT NOT NULL DEFAULT 'pct'");
// Comma/newline separated serial numbers captured on an invoice line (for
// serial-tracked goods like electronics). Shown in the bill description.
ensureColumn('invoice_items', 'serials', "serials TEXT NOT NULL DEFAULT ''");

// Item master: default description (reused on vouchers/quick-add) and a flag
// that the item is serial-tracked (each unit has its own serial number).
ensureColumn('items', 'description', "description TEXT NOT NULL DEFAULT ''");
ensureColumn('items', 'track_serials', 'track_serials INTEGER NOT NULL DEFAULT 0');

// --- Unit Conversion Engine -------------------------------------------------
// Every item has a BASE unit (the smallest indivisible unit stock is counted in
// — e.g. Piece, Gram, ml, Bottle). All batch quantities are stored in base
// units. On top of the base unit an item can define any number of packaging
// levels (Pack, Box, Carton, Pallet, Crate…), each with an absolute conversion
// factor to the base unit. This one engine covers FMCG, pharma, hardware, etc.
ensureColumn('items', 'base_unit', "base_unit TEXT NOT NULL DEFAULT ''");

// Packaging levels for an item. `factor` = how many BASE units one of this unit
// equals (base unit itself has factor = 1). Prices/barcode are per unit level.
db.exec(`
CREATE TABLE IF NOT EXISTS item_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  unit_name TEXT NOT NULL,                       -- Piece, Pack, Box, Carton...
  factor REAL NOT NULL DEFAULT 1,                -- base units per 1 of this unit
  is_base INTEGER NOT NULL DEFAULT 0,            -- 1 for the base unit (factor=1)
  purchase_price REAL NOT NULL DEFAULT 0,        -- unit-specific purchase price
  sale_price REAL NOT NULL DEFAULT 0,            -- unit-specific selling price
  barcode TEXT NOT NULL DEFAULT '',              -- unit-specific barcode
  sort_order INTEGER NOT NULL DEFAULT 0,         -- display order (base first)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
db.exec('CREATE INDEX IF NOT EXISTS idx_item_units_item ON item_units(item_id);');
db.exec('CREATE INDEX IF NOT EXISTS idx_item_units_barcode ON item_units(barcode);');

// Invoice lines record which packaging unit was billed, its factor, and the
// resolved quantity in BASE units so stock math is always exact.
ensureColumn('invoice_items', 'unit', "unit TEXT NOT NULL DEFAULT ''");
ensureColumn('invoice_items', 'unit_factor', 'unit_factor REAL NOT NULL DEFAULT 1');
ensureColumn('invoice_items', 'base_qty', 'base_qty REAL NOT NULL DEFAULT 0');

// Backfill: give every existing item a base unit + a single base packaging row,
// derived from its legacy `unit`/prices, so nothing breaks pre-migration.
(() => {
  try {
    const items = db.prepare('SELECT id, unit, base_unit, purchase_price, sale_price, sku FROM items').all();
    const cntStmt = db.prepare('SELECT COUNT(*) c FROM item_units WHERE item_id=?');
    const insBase = db.prepare(
      `INSERT INTO item_units (item_id, unit_name, factor, is_base, purchase_price, sale_price, barcode, sort_order)
       VALUES (?,?,?,?,?,?,?,?)`
    );
    const setBase = db.prepare('UPDATE items SET base_unit=? WHERE id=?');
    const tx = db.transaction(() => {
      for (const it of items) {
        const base = (it.base_unit && it.base_unit.trim()) || (it.unit && it.unit.trim()) || 'PCS';
        if (!it.base_unit || !it.base_unit.trim()) setBase.run(base, it.id);
        if (cntStmt.get(it.id).c === 0) {
          insBase.run(it.id, base, 1, 1, it.purchase_price || 0, it.sale_price || 0, '', 0);
        }
      }
    });
    tx();
  } catch (e) { /* non-fatal: engine still works, backfill is best-effort */ }
})();

// Serial registry — one row per physical unit of a serial-tracked item.
// Purchases mark serials in_stock; sales mark them sold. Lets us look up any
// serial, filter available stock by serial, and block re-selling a serial.
db.exec(`
CREATE TABLE IF NOT EXISTS serials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
  serial_no TEXT NOT NULL,
  batch_no TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'in_stock',       -- in_stock | sold
  purchase_invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  sale_invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_serials_item ON serials(item_id);
CREATE INDEX IF NOT EXISTS idx_serials_biz ON serials(business_id);
CREATE INDEX IF NOT EXISTS idx_serials_no ON serials(serial_no);
-- A serial number is unique per business + item while it exists.
CREATE UNIQUE INDEX IF NOT EXISTS idx_serials_uniq ON serials(business_id, item_id, serial_no);
`);

// One-time backfill: populate the serial registry from existing invoice lines
// that stored serials as free text (so historical serials are searchable and
// their in-stock/sold status is correct).
try {
  const already = db.prepare("SELECT COUNT(*) c FROM serials").get().c;
  const hasLegacy = db.prepare("SELECT COUNT(*) c FROM invoice_items WHERE serials <> ''").get().c;
  if (already === 0 && hasLegacy > 0) {
    const lines = db.prepare(
      `SELECT ii.serials, ii.item_id, ii.batch_no, inv.id AS inv_id, inv.type, inv.business_id
       FROM invoice_items ii JOIN invoices inv ON inv.id = ii.invoice_id
       WHERE ii.serials <> '' AND ii.item_id IS NOT NULL
       ORDER BY inv.date, inv.id`
    ).all();
    const ins = db.prepare(
      `INSERT INTO serials (business_id, item_id, serial_no, batch_no, status, purchase_invoice_id, sale_invoice_id)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(business_id, item_id, serial_no)
       DO UPDATE SET status=excluded.status,
         sale_invoice_id=COALESCE(excluded.sale_invoice_id, serials.sale_invoice_id),
         purchase_invoice_id=COALESCE(serials.purchase_invoice_id, excluded.purchase_invoice_id)`
    );
    const tx = db.transaction(() => {
      for (const l of lines) {
        const list = String(l.serials).split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
        for (const s of list) {
          if (l.type === 'purchase') ins.run(l.business_id, l.item_id, s, l.batch_no || '', 'in_stock', l.inv_id, null);
          else ins.run(l.business_id, l.item_id, s, l.batch_no || '', 'sold', null, l.inv_id);
        }
      }
    });
    tx();
  }
} catch (_) { /* backfill best-effort */ }

// E-Way Bills — transport documents linked to an invoice.
db.exec(`
CREATE TABLE IF NOT EXISTS eway_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  ewb_no TEXT DEFAULT '',                       -- portal-issued number (entered after generation)
  ewb_date TEXT NOT NULL DEFAULT (date('now')),
  supply_type TEXT NOT NULL DEFAULT 'O',        -- O=outward, I=inward
  sub_type TEXT NOT NULL DEFAULT 'supply',      -- supply | export | job work ...
  doc_type TEXT NOT NULL DEFAULT 'INV',         -- INV | BIL | CHL
  doc_no TEXT DEFAULT '',
  doc_date TEXT DEFAULT '',
  from_gstin TEXT DEFAULT '', from_name TEXT DEFAULT '', from_addr TEXT DEFAULT '',
  from_place TEXT DEFAULT '', from_pin TEXT DEFAULT '', from_state TEXT DEFAULT '',
  to_gstin TEXT DEFAULT '', to_name TEXT DEFAULT '', to_addr TEXT DEFAULT '',
  to_place TEXT DEFAULT '', to_pin TEXT DEFAULT '', to_state TEXT DEFAULT '',
  transporter_id TEXT DEFAULT '', transporter_name TEXT DEFAULT '',
  trans_mode TEXT NOT NULL DEFAULT 'road',      -- road | rail | air | ship
  trans_distance REAL NOT NULL DEFAULT 0,
  trans_doc_no TEXT DEFAULT '', trans_doc_date TEXT DEFAULT '',
  vehicle_no TEXT DEFAULT '', vehicle_type TEXT NOT NULL DEFAULT 'R',
  total_value REAL NOT NULL DEFAULT 0,
  taxable_value REAL NOT NULL DEFAULT 0,
  cgst REAL NOT NULL DEFAULT 0, sgst REAL NOT NULL DEFAULT 0, igst REAL NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',          -- draft | generated | cancelled
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_eway_biz ON eway_bills(business_id);
CREATE INDEX IF NOT EXISTS idx_eway_inv ON eway_bills(invoice_id);
`);

// --- Multi-business support ---------------------------------------------------
// Tag transactions & stock with the owning business.
ensureColumn('batches', 'business_id', 'business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE');
ensureColumn('invoices', 'business_id', 'business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE');
ensureColumn('payments', 'business_id', 'business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE');
db.exec('CREATE INDEX IF NOT EXISTS idx_batches_biz ON batches(business_id);');
db.exec('CREATE INDEX IF NOT EXISTS idx_invoices_biz ON invoices(business_id);');
db.exec('CREATE INDEX IF NOT EXISTS idx_payments_biz ON payments(business_id);');

// Seed the first business from the existing company profile so upgrades keep
// their firm details, and back-fill business_id on all existing rows.
const bizCount = db.prepare('SELECT COUNT(*) c FROM businesses').get().c;
if (bizCount === 0) {
  const co = db.prepare('SELECT * FROM company WHERE id=1').get() || {};
  const info = db.prepare(
    `INSERT INTO businesses (name, gstin, phone, email, address, state, state_code, invoice_prefix, terms, fy_start_month, is_default, active)
     VALUES (?,?,?,?,?,?,?,?,?,?,1,1)`
  ).run(
    co.name || 'My Business', co.gstin || '', co.phone || '', co.email || '', co.address || '',
    co.state || '', co.state_code || '', co.invoice_prefix || 'INV',
    co.terms || 'Goods once sold will not be taken back.', co.fy_start_month || 4
  );
  const defId = info.lastInsertRowid;
  db.prepare('UPDATE batches   SET business_id=? WHERE business_id IS NULL').run(defId);
  db.prepare('UPDATE invoices  SET business_id=? WHERE business_id IS NULL').run(defId);
  db.prepare('UPDATE payments  SET business_id=? WHERE business_id IS NULL').run(defId);
}

// Always guarantee exactly one default business.
const hasDefault = db.prepare('SELECT 1 FROM businesses WHERE is_default=1 AND active=1').get();
if (!hasDefault) {
  const first = db.prepare('SELECT id FROM businesses WHERE active=1 ORDER BY id LIMIT 1').get();
  if (first) db.prepare('UPDATE businesses SET is_default=1 WHERE id=?').run(first.id);
}

module.exports = db;
