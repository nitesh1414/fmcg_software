// Serial-number registry helpers.
// A serial-tracked item has one `serials` row per physical unit. Purchases
// register serials as in_stock; sales mark them sold; edits/deletes reverse.
const db = require('./db');

function parseSerials(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : String(raw).split(/[\n,]+/);
  const seen = new Set();
  const out = [];
  for (const s of arr) {
    const v = String(s).trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue; // de-dupe within the same line
    seen.add(key);
    out.push(v);
  }
  return out;
}

// Is a serial currently in stock for this item/business? Returns the row or null.
function findInStock(businessId, itemId, serialNo) {
  return db.prepare(
    `SELECT * FROM serials WHERE business_id=? AND item_id=? AND serial_no=? COLLATE NOCASE AND status='in_stock'`
  ).get(businessId, itemId, serialNo) || null;
}

// Validate serials before a SALE: every serial must exist and be in stock.
// Returns { ok, missing:[], notInStock:[] }.
function validateSaleSerials(businessId, itemId, serials) {
  const missing = [], notInStock = [];
  for (const s of serials) {
    const row = db.prepare(
      `SELECT status FROM serials WHERE business_id=? AND item_id=? AND serial_no=? COLLATE NOCASE`
    ).get(businessId, itemId, s);
    if (!row) missing.push(s);
    else if (row.status !== 'in_stock') notInStock.push(s);
  }
  return { ok: missing.length === 0 && notInStock.length === 0, missing, notInStock };
}

// Register serials received on a PURCHASE line (idempotent-ish: reactivate if
// the same serial was previously sold/exists). Throws on a hard duplicate that
// is still in stock (would be a genuine data error).
function registerPurchaseSerials(businessId, itemId, batchNo, invoiceId, serials) {
  const upsert = db.prepare(
    `INSERT INTO serials (business_id, item_id, serial_no, batch_no, status, purchase_invoice_id, sale_invoice_id)
     VALUES (?,?,?,?, 'in_stock', ?, NULL)
     ON CONFLICT(business_id, item_id, serial_no)
     DO UPDATE SET status='in_stock', batch_no=excluded.batch_no, purchase_invoice_id=excluded.purchase_invoice_id, sale_invoice_id=NULL`
  );
  for (const s of serials) upsert.run(businessId, itemId, s, batchNo || '', invoiceId);
}

// Mark serials as SOLD on a sale line.
function markSerialsSold(businessId, itemId, invoiceId, serials) {
  const upd = db.prepare(
    `UPDATE serials SET status='sold', sale_invoice_id=? WHERE business_id=? AND item_id=? AND serial_no=? COLLATE NOCASE`
  );
  for (const s of serials) upd.run(invoiceId, businessId, itemId, s);
}

// Reverse the serial effect of an invoice (used on edit/delete):
//   sale     → the serials it sold go back to in_stock
//   purchase → the serials it registered are removed (if still in stock)
function reverseInvoiceSerials(inv) {
  if (inv.type === 'sale') {
    db.prepare(`UPDATE serials SET status='in_stock', sale_invoice_id=NULL WHERE sale_invoice_id=?`).run(inv.id);
  } else if (inv.type === 'purchase') {
    // Only remove ones still in stock; if already sold elsewhere, just detach.
    db.prepare(`DELETE FROM serials WHERE purchase_invoice_id=? AND status='in_stock'`).run(inv.id);
    db.prepare(`UPDATE serials SET purchase_invoice_id=NULL WHERE purchase_invoice_id=?`).run(inv.id);
  }
}

module.exports = {
  parseSerials, findInStock, validateSaleSerials,
  registerPurchaseSerials, markSerialsSold, reverseInvoiceSerials,
};
