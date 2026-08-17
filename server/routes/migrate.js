// Data migration / import from other tools (Marg ERP, Vyapar, Tally, generic CSV).
// Accepts CSV text + an entity type; auto-maps common column-header variants.
const express = require('express');
const db = require('../db');
const { parseCSVObjects } = require('../csvparse');
const { recalcAvgCost } = require('../stock');
const router = express.Router();

// --- Column synonym maps (lower-cased header -> canonical field) ---
// Covers Marg, Vyapar, Tally and generic exports.
const FIELD_SYNONYMS = {
  items: {
    name: ['name', 'item name', 'product name', 'product', 'itemname', 'description', 'particulars', 'stock item', 'item'],
    sku: ['sku', 'code', 'item code', 'product code', 'barcode', 'alias', 'hsn code alias', 'itemcode'],
    category: ['category', 'group', 'item group', 'stock group', 'category name', 'parent group'],
    unit: ['unit', 'uom', 'units', 'base unit', 'unit of measure'],
    hsn: ['hsn', 'hsn code', 'hsn/sac', 'hsncode', 'hsn sac'],
    gst_rate: ['gst', 'gst rate', 'gst%', 'tax rate', 'gst rate %', 'taxrate', 'igst', 'gst percentage'],
    purchase_price: ['purchase price', 'purchase rate', 'cost price', 'cost', 'buy price', 'purchaseprice', 'p.rate', 'purc rate'],
    sale_price: ['sale price', 'sales price', 'selling price', 'mrp', 'rate', 'price', 'saleprice', 's.rate', 'sales rate'],
    opening_stock: ['opening stock', 'stock', 'qty', 'quantity', 'current stock', 'closing stock', 'opening qty', 'stock qty', 'available'],
    low_stock_alert: ['low stock', 'reorder', 'reorder level', 'min stock', 'minimum stock', 'low stock alert'],
    batch_no: ['batch', 'batch no', 'batch number', 'serial', 'serial no', 'serial number', 'batchno', 'lot', 'lot no'],
    expiry_date: ['expiry', 'expiry date', 'exp date', 'exp', 'expirydate', 'best before'],
  },
  parties: {
    name: ['name', 'party name', 'customer name', 'supplier name', 'ledger name', 'account name', 'party', 'particulars'],
    type: ['type', 'party type', 'group', 'ledger group', 'category'],
    phone: ['phone', 'mobile', 'contact', 'mobile no', 'phone no', 'contact no', 'telephone', 'mobile number'],
    email: ['email', 'e-mail', 'email id', 'mail'],
    gstin: ['gstin', 'gst no', 'gst number', 'gstin/uin', 'gst', 'tax no', 'gstin no'],
    address: ['address', 'billing address', 'addr', 'address1', 'street', 'location'],
    state: ['state', 'state name', 'province'],
    opening_balance: ['opening balance', 'balance', 'opening', 'outstanding', 'closing balance', 'op. balance', 'opening bal'],
  },
};

function norm(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

// Build header -> canonical mapping for a record set.
function autoMap(headers, entity) {
  const syn = FIELD_SYNONYMS[entity] || {};
  const map = {};
  const used = new Set();
  for (const [field, names] of Object.entries(syn)) {
    const want = names.map(norm);
    const hit = headers.find((h) => want.includes(norm(h)) && !used.has(h));
    if (hit) { map[field] = hit; used.add(hit); }
  }
  return map;
}

const num = (v) => {
  if (v === undefined || v === null) return 0;
  const n = parseFloat(String(v).replace(/[₹,\s]/g, ''));
  return isNaN(n) ? 0 : n;
};

// Normalise various date formats to YYYY-MM-DD (handles dd/mm/yyyy, dd-mm-yy etc.)
function normDate(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = (Number(y) > 50 ? '19' : '20') + y;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const dt = new Date(s);
  return isNaN(dt) ? '' : dt.toISOString().slice(0, 10);
}

// ---- Preview: parse CSV, auto-map, show first rows (no DB writes) ----
router.post('/preview', (req, res) => {
  const { csv, entity } = req.body || {};
  if (!csv || !entity) return res.status(400).json({ error: 'csv and entity required' });
  const { headers, records } = parseCSVObjects(csv);
  if (!headers.length) return res.status(400).json({ error: 'Could not read any columns from the file' });
  const mapping = autoMap(headers, entity);
  res.json({
    headers,
    mapping,
    totalRows: records.length,
    sample: records.slice(0, 8),
    fields: Object.keys(FIELD_SYNONYMS[entity] || {}),
  });
});

function findOrCreateCategory(name) {
  if (!name) return null;
  // Support "Parent > Child" hierarchy in the cell
  const parts = String(name).split(/>|\//).map((s) => s.trim()).filter(Boolean);
  let parent = null;
  for (const part of parts) {
    let row = db.prepare('SELECT id FROM categories WHERE name = ? AND IFNULL(parent_id,0) = IFNULL(?,0)').get(part, parent);
    if (!row) {
      const info = db.prepare('INSERT INTO categories (name, parent_id) VALUES (?, ?)').run(part, parent);
      parent = info.lastInsertRowid;
    } else parent = row.id;
  }
  return parent;
}

// ---- Commit: import using a (possibly user-adjusted) mapping ----
router.post('/commit', (req, res) => {
  const { csv, entity, mapping: userMap, duplicateMode = 'skip' } = req.body || {};
  if (!csv || !entity) return res.status(400).json({ error: 'csv and entity required' });
  const { headers, records } = parseCSVObjects(csv);
  const mapping = userMap && Object.keys(userMap).length ? userMap : autoMap(headers, entity);

  const get = (rec, field) => (mapping[field] ? rec[mapping[field]] : '');
  const result = { entity, inserted: 0, updated: 0, skipped: 0, errors: [] };

  const run = db.transaction(() => {
    if (entity === 'parties') {
      for (let i = 0; i < records.length; i++) {
        const rec = records[i];
        const name = (get(rec, 'name') || '').trim();
        if (!name) { result.skipped++; continue; }
        let type = norm(get(rec, 'type'));
        type = type.includes('supp') || type.includes('vendor') || type.includes('creditor') ? 'supplier' : 'customer';
        const existing = db.prepare('SELECT id FROM parties WHERE name = ? COLLATE NOCASE').get(name);
        const data = {
          name, type,
          phone: get(rec, 'phone') || '', email: get(rec, 'email') || '',
          gstin: get(rec, 'gstin') || '', address: get(rec, 'address') || '',
          state: get(rec, 'state') || '', opening_balance: num(get(rec, 'opening_balance')),
        };
        if (existing) {
          if (duplicateMode === 'skip') { result.skipped++; continue; }
          db.prepare(`UPDATE parties SET type=@type, phone=@phone, email=@email, gstin=@gstin, address=@address, state=@state, opening_balance=@opening_balance WHERE id=${existing.id}`).run(data);
          result.updated++;
        } else {
          db.prepare(`INSERT INTO parties (name,type,phone,email,gstin,address,state,opening_balance) VALUES (@name,@type,@phone,@email,@gstin,@address,@state,@opening_balance)`).run(data);
          result.inserted++;
        }
      }
    } else if (entity === 'items') {
      for (let i = 0; i < records.length; i++) {
        const rec = records[i];
        const name = (get(rec, 'name') || '').trim();
        if (!name) { result.skipped++; continue; }
        const categoryId = findOrCreateCategory(get(rec, 'category'));
        const data = {
          name,
          sku: get(rec, 'sku') || '',
          category_id: categoryId,
          unit: (get(rec, 'unit') || 'PCS').toUpperCase().slice(0, 10) || 'PCS',
          hsn: get(rec, 'hsn') || '',
          gst_rate: num(get(rec, 'gst_rate')),
          purchase_price: num(get(rec, 'purchase_price')),
          sale_price: num(get(rec, 'sale_price')),
          low_stock_alert: num(get(rec, 'low_stock_alert')),
        };
        let itemId;
        const existing = db.prepare('SELECT id FROM items WHERE name = ? COLLATE NOCASE').get(name);
        if (existing) {
          if (duplicateMode === 'skip') { result.skipped++; continue; }
          db.prepare(`UPDATE items SET sku=@sku, category_id=@category_id, unit=@unit, hsn=@hsn, gst_rate=@gst_rate, purchase_price=@purchase_price, sale_price=@sale_price, low_stock_alert=@low_stock_alert WHERE id=${existing.id}`).run(data);
          itemId = existing.id;
          result.updated++;
        } else {
          const info = db.prepare(`INSERT INTO items (name,sku,category_id,unit,hsn,gst_rate,purchase_price,sale_price,low_stock_alert) VALUES (@name,@sku,@category_id,@unit,@hsn,@gst_rate,@purchase_price,@sale_price,@low_stock_alert)`).run(data);
          itemId = info.lastInsertRowid;
          result.inserted++;
        }
        // Opening stock -> create an opening batch so inventory & costing work
        const openQty = num(get(rec, 'opening_stock'));
        if (openQty > 0 && !existing) {
          const batchNo = (get(rec, 'batch_no') || 'OPENING').trim() || 'OPENING';
          db.prepare(`INSERT INTO batches (item_id,batch_no,mfg_date,expiry_date,purchase_price,mrp,qty_in,qty_available) VALUES (?,?,?,?,?,?,?,?)`)
            .run(itemId, batchNo, '', normDate(get(rec, 'expiry_date')), data.purchase_price, data.sale_price, openQty, openQty);
          recalcAvgCost(itemId);
        }
      }
    } else {
      throw new Error('Unsupported entity: ' + entity);
    }
  });

  try {
    run();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Sample template CSV for download ----
router.get('/template/:entity', (req, res) => {
  const entity = req.params.entity;
  let csv = '';
  if (entity === 'items') {
    csv = 'Name,SKU,Category,Unit,HSN,GST Rate,Purchase Price,Sale Price,Opening Stock,Batch No,Expiry Date,Low Stock\n' +
          'Cola 500ml,BEV001,Beverages > Soft Drinks,PCS,2202,28,18,25,100,B-001,2026-12-31,24\n';
  } else if (entity === 'parties') {
    csv = 'Name,Type,Phone,Email,GSTIN,Address,State,Opening Balance\n' +
          'Gupta Kirana Store,Customer,9811111111,gupta@example.com,22AAAAA0000A1Z5,"Lajpat Nagar, Delhi",Delhi,0\n';
  } else {
    return res.status(404).json({ error: 'Unknown template' });
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${entity}-template.csv"`);
  res.send(csv);
});

module.exports = router;
