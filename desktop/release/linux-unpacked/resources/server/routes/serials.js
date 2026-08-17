// Serial / batch lookup & availability filters.
const express = require('express');
const db = require('../db');
const { businessContext } = require('../business');
const router = express.Router();

router.use(businessContext);

// GET /serials  — multi-filter search of the serial registry.
// Query params (all optional, combined with AND):
//   q         : matches serial_no OR item name OR sku (LIKE)
//   serial    : exact-ish serial match (LIKE)
//   batch     : batch number (LIKE)
//   item_id   : restrict to an item
//   status    : in_stock | sold | all   (default all)
router.get('/', (req, res) => {
  const { q = '', serial = '', batch = '', item_id = '', status = 'all' } = req.query;
  const where = ['s.business_id = @bid'];
  const p = { bid: req.businessId };
  if (q) { where.push('(s.serial_no LIKE @q OR i.name LIKE @q OR i.sku LIKE @q)'); p.q = '%' + q + '%'; }
  if (serial) { where.push('s.serial_no LIKE @serial'); p.serial = '%' + serial + '%'; }
  if (batch) { where.push('s.batch_no LIKE @batch'); p.batch = '%' + batch + '%'; }
  if (item_id) { where.push('s.item_id = @item_id'); p.item_id = Number(item_id); }
  if (status === 'in_stock' || status === 'sold') { where.push('s.status = @status'); p.status = status; }

  const rows = db.prepare(
    `SELECT s.id, s.serial_no, s.batch_no, s.status, s.created_at,
            i.id AS item_id, i.name AS item_name, i.sku, i.unit, i.hsn,
            pi.invoice_no AS purchase_invoice_no, si.invoice_no AS sale_invoice_no
     FROM serials s
     JOIN items i ON i.id = s.item_id
     LEFT JOIN invoices pi ON pi.id = s.purchase_invoice_id
     LEFT JOIN invoices si ON si.id = s.sale_invoice_id
     WHERE ${where.join(' AND ')}
     ORDER BY i.name, s.status, s.serial_no
     LIMIT 500`
  ).all(p);

  const summary = {
    total: rows.length,
    in_stock: rows.filter((r) => r.status === 'in_stock').length,
    sold: rows.filter((r) => r.status === 'sold').length,
  };
  res.json({ rows, summary });
});

// GET /serials/in-stock?item_id=  — serials currently available for an item
// (used by the sale voucher to offer/validate serials).
router.get('/in-stock', (req, res) => {
  const itemId = Number(req.query.item_id);
  if (!itemId) return res.json([]);
  const rows = db.prepare(
    `SELECT serial_no, batch_no FROM serials
     WHERE business_id=? AND item_id=? AND status='in_stock' ORDER BY serial_no`
  ).all(req.businessId, itemId);
  res.json(rows);
});

module.exports = router;
