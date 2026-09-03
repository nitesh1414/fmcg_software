// Desktop Portal ⇄ FMCG Mobile App data sync.
//
// The RightServe FMCG mobile app (github.com/saurabhrsis/fmcg_mobile_app) talks
// to this portal through three endpoints — see its src/services/syncService.ts:
//
//   GET  /api/sync/ping   → reachability check (API key optional; wrong key → 401)
//   GET  /api/sync/pull   → download the desktop's data as a sync package
//   POST /api/sync/push   → upload the phone's sync package (merged in)
//
// Pull/push are gated by a shared API key sent as
// "Authorization: Bearer <key>" and managed from System → Mobile App Sync.
// Sync is OFF until an admin enables it (generates a key). Ping stays open so
// the phone can tell "wrong URL / not on LAN" from "sync disabled / bad key".
//
// In addition, the same versioned package format ("rightserve-sync/1") can be
// transferred as a FILE (no network needed): GET /export downloads it and
// POST /import merges an uploaded one — mirroring the mobile app's
// export/import flow.
//
// MERGE STRATEGY (non-destructive, "local wins"): auto-increment ids differ
// between devices, so rows are matched by their natural keys and ids remapped
// while importing. Existing local rows are kept as-is; only records missing
// locally are added. This mirrors the mobile app's mergeSyncPackage() exactly
// so both directions behave identically.

const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const lan = require('../lan');
const { authRequired, adminOnly } = require('../auth');

const router = express.Router();

// Sync packages can be much larger than the API's default 5mb JSON limit
// (full invoice history), so this router parses its own bodies with a larger
// cap. It is mounted BEFORE the global express.json() for the same reason.
router.use(express.json({ limit: '60mb' }));

const SYNC_FORMAT = 'rightserve-sync/1';
const SYNC_TABLES = [
  'users',
  'company',
  'businesses',
  'categories',
  'items',
  'item_units',
  'parties',
  'batches',
  'invoices',
  'invoice_items',
  'serials',
  'payments',
  'eway_bills',
];
// Tables that are exchanged in packages but never MERGED from an incoming
// package (local device settings always stay local).
const MERGE_SKIP_TABLES = new Set(['company']);

function appVersion() {
  try { return require('../package.json').version || '1.0.0'; } catch (_) { return '1.0.0'; }
}

// --- read-only (expired-licence) guard for the mutating endpoints -----------
// This router is mounted ahead of the app-wide read-only middleware, so it
// enforces the same rule itself: GETs stay allowed, writes are blocked.
function writeGuard(req, res, next) {
  if (process.env.RS_READONLY === '1') {
    return res.status(423).json({
      error: 'License expired — RightServe is in read-only mode. Please renew to make changes.',
      code: 'READ_ONLY',
    });
  }
  next();
}

// ---------------------------------------------------------------------------
// package building
// ---------------------------------------------------------------------------

function tableExists(t) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
}

const _colCache = {};
function columnsOf(table) {
  if (!_colCache[table]) {
    _colCache[table] = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  }
  return _colCache[table];
}

// Snapshot every sync table into a versioned package the mobile app can parse.
function buildPackage() {
  const data = {};
  const counts = {};
  for (const t of SYNC_TABLES) {
    let rows = [];
    try { rows = tableExists(t) ? db.prepare(`SELECT * FROM ${t}`).all() : []; } catch (_) { rows = []; }
    data[t] = rows;
    counts[t] = rows.length;
  }
  return {
    format: SYNC_FORMAT,
    source: 'desktop',
    app: 'RightServe Inventory & Billing',
    version: appVersion(),
    exportedAt: new Date().toISOString(),
    counts,
    data,
  };
}

// ---------------------------------------------------------------------------
// non-destructive merge (local wins) — mirrors the mobile app exactly
// ---------------------------------------------------------------------------

function lower(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
function mapOrNull(map, id) {
  if (id === null || id === undefined || id === '') return null;
  const m = map.get(Number(id));
  return m === undefined ? null : m;
}

// Insert a row, keeping only columns this schema knows about (guards against
// schema drift between app versions). Returns the new id, or null.
function insertRow(table, row, overrides = {}) {
  const cols = columnsOf(table);
  const data = { ...row, ...overrides };
  delete data.id;
  const keys = Object.keys(data).filter((k) => cols.has(k) && data[k] !== undefined);
  if (!keys.length) return null;
  const params = {};
  for (const k of keys) params[k] = data[k];
  const info = db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((k) => '@' + k).join(',')})`).run(params);
  return info.lastInsertRowid;
}

// Merge an incoming package into the local database. Existing rows are never
// modified — only missing records are added. Returns {added, matched, skipped}.
function mergePackage(pkg) {
  const d = (pkg && pkg.data) || pkg || {};
  const stats = { added: {}, matched: {}, skipped: {} };
  const bump = (bucket, tbl) => { stats[bucket][tbl] = (stats[bucket][tbl] || 0) + 1; };
  const safeInsert = (tbl, row, overrides) => {
    try { return insertRow(tbl, row, overrides); } catch (_) { bump('skipped', tbl); return null; }
  };
  const tryFind = (sql, ...params) => {
    try { return db.prepare(sql).get(...params); } catch (_) { return null; }
  };

  const tx = db.transaction(() => {
    const bizMap = new Map();
    const userMap = new Map();
    const catMap = new Map();
    const itemMap = new Map();
    const partyMap = new Map();
    const batchMap = new Map();
    const invMap = new Map();

    // -- businesses (match by name) --
    for (const row of d.businesses || []) {
      const found = tryFind('SELECT id FROM businesses WHERE LOWER(name) = ?', lower(row.name));
      if (found) { bizMap.set(Number(row.id), Number(found.id)); bump('matched', 'businesses'); }
      else {
        const newId = safeInsert('businesses', row, { is_default: 0 });
        if (newId != null) { bizMap.set(Number(row.id), newId); bump('added', 'businesses'); }
      }
    }

    // -- users (match by username) --
    for (const row of d.users || []) {
      const found = tryFind('SELECT id FROM users WHERE username = ?', String(row.username == null ? '' : row.username));
      if (found) { userMap.set(Number(row.id), Number(found.id)); bump('matched', 'users'); }
      else {
        const newId = safeInsert('users', row, { created_by: null });
        if (newId != null) { userMap.set(Number(row.id), newId); bump('added', 'users'); }
      }
    }

    // -- categories (parents before children; match by name + parent) --
    let remaining = [...(d.categories || [])];
    let guard = 0;
    while (remaining.length > 0 && guard < 20) {
      guard++;
      const deferred = [];
      for (const row of remaining) {
        const srcParent = row.parent_id === null || row.parent_id === undefined ? null : Number(row.parent_id);
        if (srcParent !== null && !catMap.has(srcParent)) {
          const parentInPkg = (d.categories || []).some((c) => Number(c.id) === srcParent);
          if (parentInPkg && guard < 19) { deferred.push(row); continue; }
        }
        const parentLocal = srcParent === null ? null : (catMap.get(srcParent) ?? null);
        const found = tryFind('SELECT id FROM categories WHERE LOWER(name) = ? AND parent_id IS ?', lower(row.name), parentLocal);
        if (found) { catMap.set(Number(row.id), Number(found.id)); bump('matched', 'categories'); }
        else {
          const newId = safeInsert('categories', row, { parent_id: parentLocal });
          if (newId != null) { catMap.set(Number(row.id), newId); bump('added', 'categories'); }
        }
      }
      remaining = deferred;
    }

    // -- items (match by name + sku) --
    for (const row of d.items || []) {
      const found = tryFind("SELECT id FROM items WHERE LOWER(name) = ? AND IFNULL(sku, '') = ?", lower(row.name), String(row.sku == null ? '' : row.sku));
      if (found) { itemMap.set(Number(row.id), Number(found.id)); bump('matched', 'items'); }
      else {
        const newId = safeInsert('items', row, { category_id: mapOrNull(catMap, row.category_id) });
        if (newId != null) { itemMap.set(Number(row.id), newId); bump('added', 'items'); }
      }
    }

    // -- item_units (match by item + unit name; adds missing packaging levels) --
    for (const row of d.item_units || []) {
      const localItem = mapOrNull(itemMap, row.item_id);
      if (localItem === null) { bump('skipped', 'item_units'); continue; }
      const found = tryFind('SELECT id FROM item_units WHERE item_id = ? AND LOWER(unit_name) = ?', localItem, lower(row.unit_name));
      if (found) bump('matched', 'item_units');
      else if (safeInsert('item_units', row, { item_id: localItem }) != null) bump('added', 'item_units');
    }

    // -- parties (match by name + type) --
    for (const row of d.parties || []) {
      const found = tryFind('SELECT id FROM parties WHERE LOWER(name) = ? AND type = ?', lower(row.name), String(row.type == null ? 'customer' : row.type));
      if (found) { partyMap.set(Number(row.id), Number(found.id)); bump('matched', 'parties'); }
      else {
        const newId = safeInsert('parties', row);
        if (newId != null) { partyMap.set(Number(row.id), newId); bump('added', 'parties'); }
      }
    }

    // -- batches (match by business + item + batch no) --
    for (const row of d.batches || []) {
      const localItem = mapOrNull(itemMap, row.item_id);
      if (localItem === null) { bump('skipped', 'batches'); continue; }
      const localBiz = mapOrNull(bizMap, row.business_id);
      const found = tryFind('SELECT id FROM batches WHERE business_id IS ? AND item_id = ? AND batch_no = ?', localBiz, localItem, String(row.batch_no == null ? '' : row.batch_no));
      if (found) { batchMap.set(Number(row.id), Number(found.id)); bump('matched', 'batches'); }
      else {
        const newId = safeInsert('batches', row, { business_id: localBiz, item_id: localItem });
        if (newId != null) { batchMap.set(Number(row.id), newId); bump('added', 'batches'); }
      }
    }

    // -- invoices (match by business + invoice no + type) + their lines --
    const invItemsBySrcInvoice = new Map();
    for (const line of d.invoice_items || []) {
      const key = Number(line.invoice_id);
      if (!invItemsBySrcInvoice.has(key)) invItemsBySrcInvoice.set(key, []);
      invItemsBySrcInvoice.get(key).push(line);
    }
    for (const row of d.invoices || []) {
      const localBiz = mapOrNull(bizMap, row.business_id);
      const found = tryFind('SELECT id FROM invoices WHERE business_id IS ? AND invoice_no = ? AND type = ?',
        localBiz, String(row.invoice_no == null ? '' : row.invoice_no), String(row.type == null ? 'sale' : row.type));
      if (found) { invMap.set(Number(row.id), Number(found.id)); bump('matched', 'invoices'); continue; }
      const newId = safeInsert('invoices', row, {
        business_id: localBiz,
        party_id: mapOrNull(partyMap, row.party_id),
        created_by: mapOrNull(userMap, row.created_by),
        converted_invoice_id: null,
      });
      if (newId == null) continue;
      invMap.set(Number(row.id), newId);
      bump('added', 'invoices');
      for (const line of invItemsBySrcInvoice.get(Number(row.id)) || []) {
        if (safeInsert('invoice_items', line, {
          invoice_id: newId,
          item_id: mapOrNull(itemMap, line.item_id),
          batch_id: mapOrNull(batchMap, line.batch_id),
        }) != null) bump('added', 'invoice_items');
      }
    }

    // -- serials (unique on business + item + serial no) --
    for (const row of d.serials || []) {
      const localItem = mapOrNull(itemMap, row.item_id);
      if (localItem === null) { bump('skipped', 'serials'); continue; }
      const localBiz = mapOrNull(bizMap, row.business_id);
      const found = tryFind('SELECT id FROM serials WHERE business_id IS ? AND item_id = ? AND serial_no = ?',
        localBiz, localItem, String(row.serial_no == null ? '' : row.serial_no));
      if (found) bump('matched', 'serials');
      else if (safeInsert('serials', row, {
        business_id: localBiz,
        item_id: localItem,
        purchase_invoice_id: mapOrNull(invMap, row.purchase_invoice_id),
        sale_invoice_id: mapOrNull(invMap, row.sale_invoice_id),
      }) != null) bump('added', 'serials');
    }

    // -- payments (fingerprint match to avoid duplicates) --
    for (const row of d.payments || []) {
      const localBiz = mapOrNull(bizMap, row.business_id);
      const localParty = mapOrNull(partyMap, row.party_id);
      const localInv = mapOrNull(invMap, row.invoice_id);
      const found = tryFind(
        `SELECT id FROM payments
         WHERE business_id IS ? AND party_id IS ? AND invoice_id IS ?
           AND type = ? AND amount = ? AND date = ? AND IFNULL(mode,'') = ? AND IFNULL(notes,'') = ?`,
        localBiz, localParty, localInv,
        String(row.type == null ? '' : row.type), Number(row.amount) || 0,
        String(row.date == null ? '' : row.date), String(row.mode == null ? '' : row.mode),
        String(row.notes == null ? '' : row.notes));
      if (found) bump('matched', 'payments');
      else if (safeInsert('payments', row, { business_id: localBiz, party_id: localParty, invoice_id: localInv }) != null) bump('added', 'payments');
    }

    // -- eway bills (fingerprint match) --
    for (const row of d.eway_bills || []) {
      const localBiz = mapOrNull(bizMap, row.business_id);
      const found = tryFind(
        `SELECT id FROM eway_bills
         WHERE business_id IS ? AND IFNULL(doc_no,'') = ? AND ewb_date = ? AND total_value = ?`,
        localBiz, String(row.doc_no == null ? '' : row.doc_no),
        String(row.ewb_date == null ? '' : row.ewb_date), Number(row.total_value) || 0);
      if (found) bump('matched', 'eway_bills');
      else if (safeInsert('eway_bills', row, {
        business_id: localBiz,
        invoice_id: mapOrNull(invMap, row.invoice_id),
        created_by: mapOrNull(userMap, row.created_by),
      }) != null) bump('added', 'eway_bills');
    }
  });
  tx();
  return stats;
}

// Validate + normalise an incoming package (from a phone push or a file import).
// Accepts both sync packages and plain backup exports ({version, data:{...}}).
function parsePackage(body) {
  const data = (body && body.data) || body;
  if (!data || typeof data !== 'object' || (!data.items && !data.parties && !data.invoices && !data.businesses)) {
    const e = new Error('Unrecognised data — expected a RightServe sync package or backup export.');
    e.status = 400;
    throw e;
  }
  return {
    format: (body && body.format) || 'backup',
    source: (body && body.source) || 'mobile',
    app: (body && body.app) || '',
    version: (body && body.version) || '',
    exportedAt: (body && body.exportedAt) || '',
    counts: (body && body.counts) || {},
    data,
  };
}

// ---------------------------------------------------------------------------
// API-key gate for the device endpoints (ping/pull/push)
// ---------------------------------------------------------------------------

function getSyncRow() {
  return db.prepare('SELECT sync_api_key, sync_last_push, sync_last_pull FROM company WHERE id=1').get() || {};
}

function deviceAuth(req, res, next) {
  const row = getSyncRow();
  const key = String(row.sync_api_key || '').trim();
  if (!key) return res.status(404).json({ error: 'Mobile Sync is not enabled on this desktop portal. Enable it in System → Mobile App Sync.' });
  const auth = String(req.headers.authorization || '');
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m || m[1].trim() !== key) return res.status(401).json({ error: 'Invalid sync API key.' });
  next();
}

function newApiKey() {
  return 'rsync_' + crypto.randomBytes(18).toString('base64url');
}

function setSyncKey(key) {
  db.prepare('UPDATE company SET sync_api_key=? WHERE id=1').run(key);
}

function statusPayload(req) {
  const row = getSyncRow();
  const count = (t) => { try { return tableExists(t) ? db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c : 0; } catch (_) { return 0; } };
  const listen = lan.getListenInfo();
  const port = lan.resolvePort(req.socket && req.socket.localPort);
  const host = listen.host || lan.defaultHost();
  return {
    enabled: !!String(row.sync_api_key || '').trim(),
    apiKey: String(row.sync_api_key || '').trim(),
    lastPushAt: row.sync_last_push || '',
    lastPullAt: row.sync_last_pull || '',
    // Never include 127.0.0.1 — the phone cannot reach this PC's loopback.
    urls: lan.portalUrls(port),
    lanBound: lan.isLanBound(host),
    listenHost: host,
    listenPort: port,
    counts: { invoices: count('invoices'), items: count('items'), parties: count('parties'), payments: count('payments') },
    format: SYNC_FORMAT,
  };
}

// ---------------------------------------------------------------------------
// Device endpoints (called by the mobile app with the shared API key)
// ---------------------------------------------------------------------------

// Reachability check used by the phone's "Test Connection". Auth is optional
// here so a wrong/missing key still proves the URL is reachable (pull/push
// remain gated). A *wrong* Bearer token is rejected so a typo is obvious.
router.get('/ping', (req, res) => {
  const row = getSyncRow();
  const key = String(row.sync_api_key || '').trim();
  const auth = String(req.headers.authorization || '');
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1].trim() : '';
  if (token && key && token !== key) {
    return res.status(401).json({ error: 'Invalid sync API key.' });
  }
  res.json({
    ok: true,
    app: 'RightServe Desktop Portal',
    version: appVersion(),
    format: SYNC_FORMAT,
    enabled: !!key,
    authenticated: !!(token && key && token === key),
    time: new Date().toISOString(),
  });
});

router.get('/pull', deviceAuth, (req, res) => {
  try {
    const pkg = buildPackage();
    db.prepare('UPDATE company SET sync_last_pull=? WHERE id=1').run(new Date().toISOString());
    res.json(pkg);
  } catch (e) {
    res.status(500).json({ error: 'Could not build sync package: ' + e.message });
  }
});

router.post('/push', writeGuard, deviceAuth, (req, res) => {
  try {
    const pkg = parsePackage(req.body);
    const stats = mergePackage(pkg);
    db.prepare('UPDATE company SET sync_last_push=? WHERE id=1').run(new Date().toISOString());
    res.json({ ok: true, stats, receivedFrom: pkg.source || 'mobile' });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Sync push failed' });
  }
});

// ---------------------------------------------------------------------------
// Admin endpoints (desktop UI, JWT auth) — manage sync + file transfer
// ---------------------------------------------------------------------------

router.get('/status', authRequired, adminOnly, (req, res) => res.json(statusPayload(req)));

router.post('/enable', writeGuard, authRequired, adminOnly, (req, res) => {
  const row = getSyncRow();
  if (!String(row.sync_api_key || '').trim()) setSyncKey(newApiKey());
  res.json(statusPayload(req));
});

router.post('/disable', writeGuard, authRequired, adminOnly, (req, res) => {
  setSyncKey('');
  res.json(statusPayload(req));
});

router.post('/regenerate', writeGuard, authRequired, adminOnly, (req, res) => {
  setSyncKey(newApiKey());
  res.json(statusPayload(req));
});

// Download the sync package as a file (offline transfer to the phone).
router.get('/export', authRequired, adminOnly, (req, res) => {
  const pkg = buildPackage();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="RightServe_Sync_${stamp}.json"`);
  res.send(JSON.stringify(pkg));
});

// Merge a sync package uploaded from the desktop UI (file transfer from phone).
router.post('/import', writeGuard, authRequired, adminOnly, (req, res) => {
  try {
    const pkg = parsePackage(req.body);
    const stats = mergePackage(pkg);
    res.json({ ok: true, stats, importedFrom: pkg.source || 'file' });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Import failed' });
  }
});

module.exports = router;
