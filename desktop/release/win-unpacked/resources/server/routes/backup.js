// Backup / restore / wipe of the SQLite database.
// Uses VACUUM INTO for a consistent snapshot (WAL-safe).
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db');
const { authRequired, adminOnly } = require('../auth');

const router = express.Router();

function dbPath() {
  return process.env.DB_PATH || path.join(__dirname, '..', 'data', 'fmcg.db');
}

// Allow the Electron main process (same machine) to pull a backup without a
// JWT — it sets the x-desktop header and always connects via 127.0.0.1.
function isDesktopLocal(req) {
  const ip = req.ip || req.connection.remoteAddress || '';
  const isLocal = ip.includes('127.0.0.1') || ip === '::1' || ip.includes('::ffff:127.0.0.1');
  return req.headers['x-desktop'] === '1' && isLocal;
}

function allowDesktopOrAuth(req, res, next) {
  if (isDesktopLocal(req)) return next();
  return authRequired(req, res, next);
}

// Destructive actions (wipe): desktop main process, or an authenticated admin.
function allowDesktopOrAdmin(req, res, next) {
  if (isDesktopLocal(req)) return next();
  return authRequired(req, res, () => adminOnly(req, res, next));
}

// Download a consistent .db snapshot of the whole database.
router.get('/download', allowDesktopOrAuth, (req, res) => {
  const tmp = path.join(os.tmpdir(), `rightserve-backup-${Date.now()}.db`);
  try {
    // VACUUM INTO writes a clean, fully-checkpointed copy (includes WAL data).
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="RightServe-Backup-${stamp}.db"`);
    const stream = fs.createReadStream(tmp);
    stream.pipe(res);
    stream.on('close', () => fs.unlink(tmp, () => {}));
    stream.on('error', () => { try { fs.unlinkSync(tmp); } catch (_) {} });
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    res.status(500).json({ error: 'Backup failed: ' + e.message });
  }
});

// Delete ALL business data from the database, keeping the schema intact so the
// app restarts cleanly from first-run (user creation). The desktop license is
// stored separately (Electron userData), so it is never touched by this.
//
// Data tables are emptied in FK-safe order and AUTOINCREMENT counters reset, so
// the very next thing the user sees is the "create admin" setup screen.
router.post('/wipe', allowDesktopOrAdmin, (req, res) => {
  try {
    // Order matters: children before parents (defensive even with FK cascade).
    const tables = [
      'invoice_items', 'invoices', 'payments', 'serials', 'eway_bills',
      'batches', 'item_units', 'items', 'categories', 'parties',
      'businesses', 'company', 'users',
    ];
    const tx = db.transaction(() => {
      db.pragma('foreign_keys = OFF');
      for (const t of tables) {
        try { db.prepare(`DELETE FROM ${t}`).run(); } catch (_) { /* table may not exist */ }
      }
      // Reset AUTOINCREMENT so ids start from 1 again on the fresh setup.
      try { db.prepare("DELETE FROM sqlite_sequence").run(); } catch (_) {}
      db.pragma('foreign_keys = ON');
    });
    tx();
    // Re-create the singleton rows the app needs to run (company settings + a
    // default business) so the web flow works immediately without a restart.
    // The very next screen is still "create first user" because users is empty.
    try {
      db.prepare('INSERT INTO company (id) VALUES (1)').run();
    } catch (_) { /* already present */ }
    try {
      const bizCount = db.prepare('SELECT COUNT(*) c FROM businesses').get().c;
      if (bizCount === 0) {
        db.prepare(
          `INSERT INTO businesses (name, invoice_prefix, terms, fy_start_month, is_default, active)
           VALUES ('My Business', 'INV', 'Goods once sold will not be taken back.', 4, 1, 1)`
        ).run();
      }
    } catch (_) { /* ignore */ }
    // Reclaim space and checkpoint the WAL so the on-disk file is truly empty.
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
    try { db.exec('VACUUM'); } catch (_) {}
    res.json({ ok: true, message: 'All data deleted. Restart to create the first user.' });
  } catch (e) {
    res.status(500).json({ error: 'Delete all data failed: ' + e.message });
  }
});

// Quick info: where the data lives + size + counts (for the UI).
router.get('/info', authRequired, (req, res) => {
  const p = dbPath();
  let size = 0;
  try { size = fs.statSync(p).size; } catch (_) {}
  const count = (t) => { try { return db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; } catch (_) { return 0; } };
  res.json({
    path: p,
    sizeBytes: size,
    counts: {
      invoices: count('invoices'),
      items: count('items'),
      parties: count('parties'),
      payments: count('payments'),
      users: count('users'),
    },
  });
});

module.exports = router;
