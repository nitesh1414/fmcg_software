// Shared stock helpers: average costing + batch/serial duplicate detection.
const db = require('./db');

/**
 * Recalculate and store the moving-average cost for an item, based on all its
 * batches' received quantity and purchase price (weighted by qty received).
 *
 *   avg_cost = Σ(qty_in × purchase_price) / Σ(qty_in)
 *
 * Falls back to the item's purchase_price when no batch quantity exists.
 */
function recalcAvgCost(itemId) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(qty_in),0) AS q,
              COALESCE(SUM(qty_in * purchase_price),0) AS v
       FROM batches WHERE item_id = ?`
    )
    .get(itemId);
  let avg = 0;
  if (row.q > 0) {
    avg = row.v / row.q;
  } else {
    const it = db.prepare('SELECT purchase_price FROM items WHERE id = ?').get(itemId);
    avg = it ? it.purchase_price : 0;
  }
  avg = Math.round((avg + Number.EPSILON) * 100) / 100;
  db.prepare('UPDATE items SET avg_cost = ? WHERE id = ?').run(avg, itemId);
  return avg;
}

/**
 * Find existing batches with the same batch/serial number.
 * For serial-tracked goods a batch_no is a unique serial; duplicates usually
 * mean a scan/entry error or fraud. Returns matching batch rows (with item name).
 *
 * @param {string} batchNo
 * @param {number} [excludeBatchId] - ignore this batch id (when editing)
 */
function findDuplicateBatch(batchNo, excludeBatchId) {
  if (!batchNo || !String(batchNo).trim() || String(batchNo).trim().toUpperCase() === 'NA') return [];
  const rows = db
    .prepare(
      `SELECT b.id, b.item_id, b.batch_no, b.qty_available, b.expiry_date, i.name AS item_name
       FROM batches b JOIN items i ON i.id = b.item_id
       WHERE b.batch_no = ? COLLATE NOCASE`
    )
    .all(String(batchNo).trim());
  return excludeBatchId ? rows.filter((r) => r.id !== Number(excludeBatchId)) : rows;
}

module.exports = { recalcAvgCost, findDuplicateBatch };
