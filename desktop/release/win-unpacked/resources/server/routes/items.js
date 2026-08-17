const express = require('express');
const db = require('../db');
const { recalcAvgCost, findDuplicateBatch } = require('../stock');
const { businessContext } = require('../business');
const units = require('../units');
const router = express.Router();

router.use(businessContext);

// Attach the packaging ladder + a human-readable stock label to an item row.
function attachUnits(item) {
  if (!item) return item;
  item.units = units.getItemUnits(item.id);
  item.base_unit = units.baseUnitName(item);
  // `stock` (from itemSelect) is the total in BASE units. Add a readable label.
  if (item.stock != null) item.stock_label = units.humanizeQty(item.id, item.stock, item);
  return item;
}

// ---- Categories (multi-level hierarchy) ----
// Build full path label like "Electronics > Mobile Phones > Accessories"
function categoryPath(id, cache) {
  cache = cache || {};
  const all = db.prepare('SELECT id, name, parent_id FROM categories').all();
  const map = {};
  all.forEach((c) => (map[c.id] = c));
  const parts = [];
  let cur = map[id];
  let guard = 0;
  while (cur && guard++ < 20) {
    parts.unshift(cur.name);
    cur = cur.parent_id ? map[cur.parent_id] : null;
  }
  return parts.join(' > ');
}

router.get('/categories', (req, res) => {
  const rows = db.prepare('SELECT * FROM categories').all();
  rows.forEach((r) => (r.path = categoryPath(r.id)));
  rows.sort((a, b) => a.path.localeCompare(b.path));
  res.json(rows);
});

router.post('/categories', (req, res) => {
  const { name, parent_id } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const info = db
      .prepare('INSERT INTO categories (name, parent_id) VALUES (?, ?)')
      .run(name.trim(), parent_id || null);
    const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid);
    row.path = categoryPath(row.id);
    res.json(row);
  } catch (e) {
    res.status(409).json({ error: 'Category already exists under this parent' });
  }
});

router.put('/categories/:id', (req, res) => {
  const { name, parent_id } = req.body || {};
  if (Number(parent_id) === Number(req.params.id))
    return res.status(400).json({ error: 'A category cannot be its own parent' });
  db.prepare('UPDATE categories SET name = ?, parent_id = ? WHERE id = ?')
    .run((name || '').trim(), parent_id || null, req.params.id);
  const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (row) row.path = categoryPath(row.id);
  res.json(row);
});

router.delete('/categories/:id', (req, res) => {
  // Re-parent children to this category's parent so the tree stays intact
  const cat = db.prepare('SELECT parent_id FROM categories WHERE id = ?').get(req.params.id);
  if (cat) {
    db.prepare('UPDATE categories SET parent_id = ? WHERE parent_id = ?').run(cat.parent_id || null, req.params.id);
  }
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Items (with aggregated stock from batches, scoped to active business) ----
// Item master is SHARED across businesses; stock is per-business.
function itemSelect(businessId) {
  const biz = Number(businessId) || 0;
  return `
  SELECT i.*, c.name AS category_name,
    COALESCE((SELECT SUM(qty_available) FROM batches b WHERE b.item_id = i.id AND b.business_id = ${biz}), 0) AS stock,
    COALESCE((SELECT SUM(qty_available*purchase_price) FROM batches b WHERE b.item_id = i.id AND b.business_id = ${biz}), 0) AS stock_value
  FROM items i
  LEFT JOIN categories c ON c.id = i.category_id
`;
}

router.get('/', (req, res) => {
  const rows = db.prepare(itemSelect(req.businessId) + ' ORDER BY i.name').all();
  rows.forEach((r) => { if (r.category_id) r.category_path = categoryPath(r.category_id); attachUnits(r); });
  res.json(rows);
});

// Look up an item + packaging unit by (any-level) barcode — for barcode scanning.
router.get('/barcode/:code', (req, res) => {
  const hit = units.findByBarcode(req.params.code);
  if (!hit) return res.status(404).json({ error: 'No product for this barcode' });
  const item = db.prepare(itemSelect(req.businessId) + ' WHERE i.id = ?').get(hit.item_id);
  if (!item) return res.status(404).json({ error: 'No product for this barcode' });
  attachUnits(item);
  res.json({ item, unit: hit.unit_name, factor: hit.factor });
});

router.get('/:id', (req, res) => {
  const item = db.prepare(itemSelect(req.businessId) + ' WHERE i.id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (item.category_id) item.category_path = categoryPath(item.category_id);
  item.batches = db
    .prepare("SELECT * FROM batches WHERE item_id = ? AND business_id = ? ORDER BY (expiry_date = ''), expiry_date")
    .all(req.params.id, req.businessId);
  attachUnits(item);
  res.json(item);
});

// Resolve the packaging ladder + base unit + item-level prices from the request.
// Accepts an explicit `units` array; otherwise derives a single base unit from
// the legacy fields so simple items keep working with no extra input.
function resolveUnits(b) {
  let list = b.units;
  if (!Array.isArray(list) || list.length === 0) {
    const base = (b.base_unit || b.unit || 'PCS').trim() || 'PCS';
    list = [{ unit_name: base, factor: 1, purchase_price: Number(b.purchase_price) || 0, sale_price: Number(b.sale_price) || 0, barcode: b.barcode || '' }];
  }
  const norm = units.normalizeUnits(list);
  return norm;
}

router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name required' });
  const norm = resolveUnits(b);
  if (!norm.ok) return res.status(400).json({ error: norm.error });
  const baseRow = norm.units.find((u) => u.is_base);
  const info = db
    .prepare(
      `INSERT INTO items (name, sku, category_id, unit, base_unit, hsn, gst_rate, purchase_price, sale_price, low_stock_alert, description, track_serials)
       VALUES (@name, @sku, @category_id, @unit, @base_unit, @hsn, @gst_rate, @purchase_price, @sale_price, @low_stock_alert, @description, @track_serials)`
    )
    .run({
      name: b.name,
      sku: b.sku || '',
      category_id: b.category_id || null,
      unit: baseRow.unit_name,
      base_unit: baseRow.unit_name,
      hsn: b.hsn || '',
      gst_rate: Number(b.gst_rate) || 0,
      purchase_price: baseRow.purchase_price,
      sale_price: baseRow.sale_price,
      low_stock_alert: Number(b.low_stock_alert) || 0,
      description: b.description || '',
      track_serials: b.track_serials ? 1 : 0,
    });
  units.saveItemUnits(info.lastInsertRowid, norm.units);
  const out = db.prepare(itemSelect(req.businessId) + ' WHERE i.id = ?').get(info.lastInsertRowid);
  res.json(attachUnits(out));
});

router.put('/:id', (req, res) => {
  const b = req.body || {};
  const norm = resolveUnits(b);
  if (!norm.ok) return res.status(400).json({ error: norm.error });
  const baseRow = norm.units.find((u) => u.is_base);
  db.prepare(
    `UPDATE items SET name=@name, sku=@sku, category_id=@category_id, unit=@unit, base_unit=@base_unit, hsn=@hsn,
      gst_rate=@gst_rate, purchase_price=@purchase_price, sale_price=@sale_price,
      low_stock_alert=@low_stock_alert, description=@description, track_serials=@track_serials,
      is_active=@is_active WHERE id=@id`
  ).run({
    id: req.params.id,
    name: b.name,
    sku: b.sku || '',
    category_id: b.category_id || null,
    unit: baseRow.unit_name,
    base_unit: baseRow.unit_name,
    hsn: b.hsn || '',
    gst_rate: Number(b.gst_rate) || 0,
    purchase_price: baseRow.purchase_price,
    sale_price: baseRow.sale_price,
    low_stock_alert: Number(b.low_stock_alert) || 0,
    description: b.description || '',
    track_serials: b.track_serials ? 1 : 0,
    is_active: b.is_active === undefined ? 1 : (b.is_active ? 1 : 0),
  });
  units.saveItemUnits(req.params.id, norm.units);
  const out = db.prepare(itemSelect(req.businessId) + ' WHERE i.id = ?').get(req.params.id);
  res.json(attachUnits(out));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Batches ----
router.get('/:id/batches', (req, res) => {
  res.json(db.prepare('SELECT * FROM batches WHERE item_id = ? AND business_id = ? ORDER BY id DESC').all(req.params.id, req.businessId));
});

// Check a batch/serial number for duplicates before saving (used by UI for live alert)
router.get('/batches/check/:batchNo', (req, res) => {
  const dups = findDuplicateBatch(req.params.batchNo);
  res.json({ duplicate: dups.length > 0, matches: dups });
});

// Add a batch (stock-in)
router.post('/:id/batches', (req, res) => {
  const b = req.body || {};
  const qty = Number(b.qty_in) || 0;

  // Duplicate serial/batch guard (can be forced with ?force=1)
  const dups = findDuplicateBatch(b.batch_no);
  if (dups.length > 0 && req.query.force !== '1') {
    return res.status(409).json({
      error: 'DUPLICATE_BATCH',
      message: `Batch/Serial "${b.batch_no}" already exists (${dups.map((d) => d.item_name).join(', ')}). Pass force=1 to add anyway.`,
      matches: dups,
    });
  }

  const info = db
    .prepare(
      `INSERT INTO batches (item_id, business_id, batch_no, mfg_date, expiry_date, purchase_price, mrp, qty_in, qty_available)
       VALUES (@item_id, @business_id, @batch_no, @mfg_date, @expiry_date, @purchase_price, @mrp, @qty_in, @qty_available)`
    )
    .run({
      item_id: req.params.id,
      business_id: req.businessId,
      batch_no: b.batch_no || 'NA',
      mfg_date: b.mfg_date || '',
      expiry_date: b.expiry_date || '',
      purchase_price: Number(b.purchase_price) || 0,
      mrp: Number(b.mrp) || 0,
      qty_in: qty,
      qty_available: qty,
    });
  recalcAvgCost(req.params.id);
  res.json(db.prepare('SELECT * FROM batches WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/batches/:batchId', (req, res) => {
  const b = req.body || {};
  const dups = findDuplicateBatch(b.batch_no, req.params.batchId);
  if (dups.length > 0 && req.query.force !== '1') {
    return res.status(409).json({
      error: 'DUPLICATE_BATCH',
      message: `Batch/Serial "${b.batch_no}" already exists (${dups.map((d) => d.item_name).join(', ')}).`,
      matches: dups,
    });
  }
  const existingPut = db.prepare('SELECT item_id FROM batches WHERE id = ?').get(req.params.batchId);
  db.prepare(
    `UPDATE batches SET batch_no=@batch_no, mfg_date=@mfg_date, expiry_date=@expiry_date,
      purchase_price=@purchase_price, mrp=@mrp, qty_available=@qty_available WHERE id=@id`
  ).run({
    id: req.params.batchId,
    batch_no: b.batch_no || 'NA',
    mfg_date: b.mfg_date || '',
    expiry_date: b.expiry_date || '',
    purchase_price: Number(b.purchase_price) || 0,
    mrp: Number(b.mrp) || 0,
    qty_available: Number(b.qty_available) || 0,
  });
  if (existingPut) recalcAvgCost(existingPut.item_id);
  res.json(db.prepare('SELECT * FROM batches WHERE id = ?').get(req.params.batchId));
});

router.delete('/batches/:batchId', (req, res) => {
  const existingDel = db.prepare('SELECT item_id FROM batches WHERE id = ?').get(req.params.batchId);
  db.prepare('DELETE FROM batches WHERE id = ?').run(req.params.batchId);
  if (existingDel) recalcAvgCost(existingDel.item_id);
  res.json({ ok: true });
});

module.exports = router;
