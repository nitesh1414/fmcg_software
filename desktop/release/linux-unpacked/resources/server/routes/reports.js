const express = require('express');
const db = require('../db');
const { fyRange, currentFy, listFinancialYears } = require('../fy');
const { buildGstr1 } = require('../gstr1');
const { validateGstr1 } = require('../gstr1validate');
const { toUQC } = require('../uqc');
const { businessContext } = require('../business');
const router = express.Router();

router.use(businessContext);

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().slice(0, 10);
};

// ---- Dashboard summary ----
router.get('/dashboard', (req, res) => {
  const t = today();
  const monthStart = t.slice(0, 7) + '-01';
  const bid = req.businessId;

  const todaySales = db.prepare(`SELECT COALESCE(SUM(total),0) v FROM invoices WHERE type='sale' AND date=? AND business_id=?`).get(t, bid).v;
  const monthSales = db.prepare(`SELECT COALESCE(SUM(total),0) v FROM invoices WHERE type='sale' AND date>=? AND business_id=?`).get(monthStart, bid).v;
  const monthPurchase = db.prepare(`SELECT COALESCE(SUM(total),0) v FROM invoices WHERE type='purchase' AND date>=? AND business_id=?`).get(monthStart, bid).v;

  // Receivable / payable reflect the TRUE party balances: opening balance +
  // sales − receipts − (purchases − payments). This includes standalone
  // Receipts & Payments entries (not just the amount paid on each invoice), so
  // recording a payment in Receipts & Payments updates these cards too.
  // balance > 0 => they owe us (receivable); < 0 => we owe them (payable).
  // Opening balances (shared party value) are counted only in the DEFAULT
  // business so multi-firm setups don't double-count them.
  const defBiz = db.prepare('SELECT id FROM businesses WHERE is_default=1 AND active=1').get();
  const includeOpening = defBiz && defBiz.id === bid ? 1 : 0;

  // Sum each party's net balance so receivable/payable don't net each other out.
  const balRows = db.prepare(`
    SELECT p.id,
      (p.opening_balance * ${includeOpening})
      + COALESCE((SELECT SUM(total) FROM invoices WHERE party_id=p.id AND type='sale' AND business_id=@bid),0)
      - COALESCE((SELECT SUM(amount) FROM payments WHERE party_id=p.id AND type='in' AND business_id=@bid),0)
      - ( COALESCE((SELECT SUM(total) FROM invoices WHERE party_id=p.id AND type='purchase' AND business_id=@bid),0)
          - COALESCE((SELECT SUM(amount) FROM payments WHERE party_id=p.id AND type='out' AND business_id=@bid),0) ) AS bal
    FROM parties p
  `).all({ bid });
  let receivable = 0, payable = 0;
  for (const r of balRows) {
    if (r.bal > 0) receivable += r.bal;
    else if (r.bal < 0) payable += -r.bal;
  }

  const stockValue = db.prepare('SELECT COALESCE(SUM(qty_available*purchase_price),0) v FROM batches WHERE business_id=?').get(bid).v;
  const itemCount = db.prepare('SELECT COUNT(*) c FROM items').get().c;
  const partyCount = db.prepare('SELECT COUNT(*) c FROM parties').get().c;

  // Low stock items (stock scoped to the active business)
  const lowStock = db
    .prepare(
      `SELECT i.id, i.name, i.unit, i.low_stock_alert,
        COALESCE((SELECT SUM(qty_available) FROM batches b WHERE b.item_id=i.id AND b.business_id=@bid),0) AS stock
       FROM items i
       WHERE i.low_stock_alert > 0
         AND COALESCE((SELECT SUM(qty_available) FROM batches b WHERE b.item_id=i.id AND b.business_id=@bid),0) <= i.low_stock_alert
       ORDER BY stock ASC`
    )
    .all({ bid });

  // Expiring within 30 days
  const expSoon = db
    .prepare(
      `SELECT b.id, b.batch_no, b.expiry_date, b.qty_available, i.name AS item_name, i.unit
       FROM batches b JOIN items i ON i.id=b.item_id
       WHERE b.business_id=? AND b.qty_available > 0 AND b.expiry_date != '' AND b.expiry_date <= ?
       ORDER BY b.expiry_date ASC`
    )
    .all(bid, addDays(t, 30));

  // Last 7 days sales trend
  const trend = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(t, -i);
    const v = db.prepare(`SELECT COALESCE(SUM(total),0) v FROM invoices WHERE type='sale' AND date=? AND business_id=?`).get(d, bid).v;
    trend.push({ date: d, sales: v });
  }

  // Top selling items (by qty) last 30 days
  const topItems = db
    .prepare(
      `SELECT ii.item_name, SUM(ii.qty) qty, SUM(ii.line_total) amount
       FROM invoice_items ii JOIN invoices inv ON inv.id=ii.invoice_id
       WHERE inv.type='sale' AND inv.date>=? AND inv.business_id=?
       GROUP BY ii.item_name ORDER BY qty DESC LIMIT 5`
    )
    .all(addDays(t, -30), bid);

  res.json({
    todaySales, monthSales, monthPurchase, receivable, payable,
    stockValue, itemCount, partyCount,
    lowStockCount: lowStock.length, expSoonCount: expSoon.length,
    lowStock, expSoon, trend, topItems,
  });
});

// ---- Stock report (batch-wise) ----
router.get('/stock', (req, res) => {
  // status: all | available | sold ; only=expiring/expired optional
  const { status = 'all', q = '' } = req.query;
  const rows = db
    .prepare(
      `SELECT i.name AS item_name, i.sku, i.unit, i.hsn, i.avg_cost,
              b.batch_no, b.mfg_date, b.expiry_date,
              b.qty_in, b.qty_available,
              (b.qty_in - b.qty_available) AS qty_sold,
              b.purchase_price, b.mrp,
              (b.qty_available*b.purchase_price) AS stock_value,
              CASE WHEN b.qty_available > 0 THEN 'In Stock' ELSE 'Sold Out' END AS stock_status
       FROM batches b JOIN items i ON i.id=b.item_id
       WHERE b.business_id=?
       ORDER BY i.name, (b.expiry_date = ''), b.expiry_date`
    )
    .all(req.businessId);
  let out = rows;
  if (status === 'available') out = out.filter((r) => r.qty_available > 0);
  else if (status === 'sold') out = out.filter((r) => r.qty_available <= 0);
  if (q) {
    const s = q.toLowerCase();
    out = out.filter((r) => r.item_name.toLowerCase().includes(s) || (r.batch_no || '').toLowerCase().includes(s) || (r.sku || '').toLowerCase().includes(s));
  }
  res.json(out);
});

// Real-time quick stock lookup for an item search (name/sku) with per-batch breakup
router.get('/stock-search', (req, res) => {
  const { q = '' } = req.query;
  const like = '%' + q + '%';
  const items = db
    .prepare(
      `SELECT i.id, i.name, i.sku, i.unit, i.gst_rate, i.sale_price, i.avg_cost,
              COALESCE((SELECT SUM(qty_available) FROM batches b WHERE b.item_id=i.id AND b.business_id=@bid),0) AS stock,
              COALESCE((SELECT SUM(qty_available*purchase_price) FROM batches b WHERE b.item_id=i.id AND b.business_id=@bid),0) AS stock_value
       FROM items i
       WHERE i.name LIKE @like OR i.sku LIKE @like
       ORDER BY i.name LIMIT 50`
    )
    .all({ like, bid: req.businessId });
  items.forEach((it) => {
    it.batches = db
      .prepare(
        `SELECT batch_no, qty_available, expiry_date, mrp, purchase_price
         FROM batches WHERE item_id=? AND business_id=? AND qty_available>0
         ORDER BY (expiry_date=''), expiry_date`
      )
      .all(it.id, req.businessId);
  });
  res.json(items);
});

// Duplicate serial/batch numbers across stock (data-integrity report)
router.get('/duplicate-serials', (req, res) => {
  const rows = db
    .prepare(
      `SELECT b.batch_no,
              COUNT(*) AS occurrences,
              SUM(b.qty_available) AS total_available,
              GROUP_CONCAT(i.name, ' | ') AS items
       FROM batches b JOIN items i ON i.id=b.item_id
       WHERE b.business_id=? AND b.batch_no <> '' AND UPPER(b.batch_no) <> 'NA'
       GROUP BY b.batch_no COLLATE NOCASE
       HAVING COUNT(*) > 1
       ORDER BY occurrences DESC, b.batch_no`
    )
    .all(req.businessId);
  res.json(rows);
});

// ---- Sales / Purchase report ----
router.get('/transactions', (req, res) => {
  const { type = 'sale', from = '2000-01-01', to = '2999-12-31' } = req.query;
  const rows = db
    .prepare(
      `SELECT inv.invoice_no, inv.date, p.name AS party_name, inv.subtotal, inv.discount,
              inv.tax_total, inv.total, inv.paid, (inv.total-inv.paid) AS due, inv.status
       FROM invoices inv LEFT JOIN parties p ON p.id=inv.party_id
       WHERE inv.type=? AND inv.business_id=? AND inv.date>=? AND inv.date<=?
       ORDER BY inv.date, inv.id`
    )
    .all(type, req.businessId, from, to);
  res.json(rows);
});

// ---- GST report (GSTR-style summary) ----
router.get('/gst', (req, res) => {
  const { type = 'sale', from = '2000-01-01', to = '2999-12-31' } = req.query;
  const rows = db
    .prepare(
      `SELECT ii.gst_rate,
              SUM(ii.taxable) AS taxable,
              SUM(ii.tax_amount) AS tax,
              SUM(ii.tax_amount)/2 AS cgst,
              SUM(ii.tax_amount)/2 AS sgst,
              SUM(ii.line_total) AS total
       FROM invoice_items ii JOIN invoices inv ON inv.id=ii.invoice_id
       WHERE inv.type=? AND inv.business_id=? AND inv.date>=? AND inv.date<=?
       GROUP BY ii.gst_rate ORDER BY ii.gst_rate`
    )
    .all(type, req.businessId, from, to);
  res.json(rows);
});

// ---- Party outstanding report ----
router.get('/outstanding', (req, res) => {
  const { type } = req.query; // customer|supplier
  let sql = `SELECT p.id, p.name, p.type, p.phone, p.opening_balance FROM parties p`;
  if (type) sql += ` WHERE p.type='${type === 'supplier' ? 'supplier' : 'customer'}'`;
  const parties = db.prepare(sql).all();
  const bid = req.businessId;
  const defBiz = db.prepare('SELECT id FROM businesses WHERE is_default=1 AND active=1').get();
  const opWeight = defBiz && defBiz.id === bid ? 1 : 0;
  const out = parties.map((p) => {
    const sale = db.prepare(`SELECT COALESCE(SUM(total),0) t FROM invoices WHERE party_id=? AND type='sale' AND business_id=?`).get(p.id, bid).t;
    const purchase = db.prepare(`SELECT COALESCE(SUM(total),0) t FROM invoices WHERE party_id=? AND type='purchase' AND business_id=?`).get(p.id, bid).t;
    const inP = db.prepare(`SELECT COALESCE(SUM(amount),0) a FROM payments WHERE party_id=? AND type='in' AND business_id=?`).get(p.id, bid).a;
    const outP = db.prepare(`SELECT COALESCE(SUM(amount),0) a FROM payments WHERE party_id=? AND type='out' AND business_id=?`).get(p.id, bid).a;
    const balance = p.opening_balance * opWeight + sale - inP - (purchase - outP);
    return { name: p.name, type: p.type, phone: p.phone, total_sale: sale, total_purchase: purchase, received: inP, paid: outP, balance };
  });
  res.json(out);
});

// ---- Batch / Serial traceability ----
// Find every invoice touching a product/batch. type=all returns BOTH purchase
// (supplier — for warranty) and sale (customer — for support).
router.get('/trace', (req, res) => {
  const { q = '', batch = '', type = 'all' } = req.query;
  const conds = ['inv.business_id = ?'];
  const params = [req.businessId];
  if (type === 'sale' || type === 'purchase') {
    conds.push('inv.type = ?');
    params.push(type);
  }
  if (q) {
    conds.push('(ii.item_name LIKE ? OR i.sku LIKE ?)');
    params.push('%' + q + '%', '%' + q + '%');
  }
  if (batch) {
    conds.push('ii.batch_no LIKE ?');
    params.push('%' + batch + '%');
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const rows = db
    .prepare(
      `SELECT inv.invoice_no, inv.date, inv.type,
              CASE inv.type WHEN 'purchase' THEN 'Bought From' ELSE 'Sold To' END AS direction,
              p.name AS party_name, p.phone AS party_phone,
              ii.item_name, i.sku, ii.batch_no, ii.hsn,
              ii.qty, ii.price, ii.line_total
       FROM invoice_items ii
       JOIN invoices inv ON inv.id = ii.invoice_id
       LEFT JOIN parties p ON p.id = inv.party_id
       LEFT JOIN items i ON i.id = ii.item_id
       ${where}
       ORDER BY inv.type DESC, inv.date DESC, inv.id DESC`
    )
    .all(...params);
  res.json(rows);
});

// Locate the purchase + sale invoice(s) for an exact serial/batch (warranty/audit)
router.get('/locate/:batch', (req, res) => {
  const batch = req.params.batch;
  const rows = db
    .prepare(
      `SELECT inv.invoice_no, inv.date, inv.type,
              p.name AS party_name, p.phone AS party_phone, p.gstin AS party_gstin,
              ii.item_name, i.sku, ii.batch_no, ii.qty, ii.price, ii.line_total
       FROM invoice_items ii
       JOIN invoices inv ON inv.id = ii.invoice_id
       LEFT JOIN parties p ON p.id = inv.party_id
       LEFT JOIN items i ON i.id = ii.item_id
       WHERE ii.batch_no = ? COLLATE NOCASE AND inv.business_id = ?
       ORDER BY inv.type DESC, inv.date`
    )
    .all(batch, req.businessId);
  const stock = db
    .prepare(
      `SELECT b.batch_no, b.qty_available, b.expiry_date, i.name AS item_name
       FROM batches b JOIN items i ON i.id=b.item_id
       WHERE b.batch_no = ? COLLATE NOCASE AND b.business_id = ?`
    )
    .all(batch, req.businessId);
  res.json({
    batch_no: batch,
    purchases: rows.filter((r) => r.type === 'purchase'),
    sales: rows.filter((r) => r.type === 'sale'),
    in_stock: stock,
  });
});

// ---- Financial years available ----
router.get('/financial-years', (req, res) => {
  res.json(listFinancialYears());
});

// ---- Current financial year (auto-detected from today's date) ----
// Reports and the dashboard use this so the active FY always reflects the
// current date and rolls over automatically at the start of a new FY.
router.get('/current-fy', (req, res) => {
  res.json(currentFy());
});

// ---- Financial-year balance / summary (P&L style snapshot) ----
router.get('/fy-balance', (req, res) => {
  const { fy } = req.query;
  const { from, to, label } = fyRange(fy);
  const bid = req.businessId;

  const sumInv = (type, col) =>
    db.prepare(`SELECT COALESCE(SUM(${col}),0) v FROM invoices WHERE type=? AND business_id=? AND date>=? AND date<=?`).get(type, bid, from, to).v;

  const salesTotal = sumInv('sale', 'total');
  const salesTaxable = sumInv('sale', 'subtotal');
  const salesTax = sumInv('sale', 'tax_total');
  const purchaseTotal = sumInv('purchase', 'total');
  const purchaseTaxable = sumInv('purchase', 'subtotal');
  const purchaseTax = sumInv('purchase', 'tax_total');

  const receiptIn = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM payments WHERE type='in' AND business_id=? AND date>=? AND date<=?`).get(bid, from, to).v;
  const paymentOut = db.prepare(`SELECT COALESCE(SUM(amount),0) v FROM payments WHERE type='out' AND business_id=? AND date>=? AND date<=?`).get(bid, from, to).v;

  // Cost of goods sold (approx) using item avg_cost × qty sold in the period
  const cogsRow = db.prepare(
    `SELECT COALESCE(SUM(ii.qty * i.avg_cost),0) v
     FROM invoice_items ii JOIN invoices inv ON inv.id=ii.invoice_id
     LEFT JOIN items i ON i.id=ii.item_id
     WHERE inv.type='sale' AND inv.business_id=? AND inv.date>=? AND inv.date<=?`
  ).get(bid, from, to).v;

  const closingStock = db.prepare(`SELECT COALESCE(SUM(qty_available*purchase_price),0) v FROM batches WHERE business_id=?`).get(bid).v;

  const grossProfit = salesTaxable - cogsRow;
  const netGstPayable = salesTax - purchaseTax;

  res.json({
    fy: label, from, to,
    rows: [
      { metric: 'Sales (Taxable)', amount: salesTaxable },
      { metric: 'Sales Tax (GST collected)', amount: salesTax },
      { metric: 'Total Sales (incl. GST)', amount: salesTotal },
      { metric: 'Purchases (Taxable)', amount: purchaseTaxable },
      { metric: 'Purchase Tax (GST paid / ITC)', amount: purchaseTax },
      { metric: 'Total Purchases (incl. GST)', amount: purchaseTotal },
      { metric: 'Cost of Goods Sold (avg cost)', amount: cogsRow },
      { metric: 'Gross Profit (Sales − COGS)', amount: grossProfit },
      { metric: 'Net GST Payable (Output − ITC)', amount: netGstPayable },
      { metric: 'Amount Received', amount: receiptIn },
      { metric: 'Amount Paid', amount: paymentOut },
      { metric: 'Closing Stock Value', amount: closingStock },
    ],
    summary: { salesTotal, purchaseTotal, grossProfit, netGstPayable, closingStock },
  });
});

// ---- GST-compliant report (GSTR-1 / GSTR-3B style) ----
// Returns rate-wise summary + invoice-level B2B/B2C split with CGST/SGST/IGST.
router.get('/gst-return', (req, res) => {
  const { fy, type = 'sale' } = req.query;
  let from, to;
  if (fy) { ({ from, to } = fyRange(fy)); }
  else { from = req.query.from || '2000-01-01'; to = req.query.to || '2999-12-31'; }

  const company = db.prepare('SELECT state, state_code, gstin FROM businesses WHERE id=?').get(req.businessId) || {};

  // Rate-wise summary
  const rateWise = db.prepare(
    `SELECT ii.gst_rate,
            ROUND(SUM(ii.taxable),2) AS taxable,
            ROUND(SUM(ii.tax_amount),2) AS total_tax
     FROM invoice_items ii JOIN invoices inv ON inv.id=ii.invoice_id
     WHERE inv.type=? AND inv.business_id=? AND inv.date>=? AND inv.date<=?
     GROUP BY ii.gst_rate ORDER BY ii.gst_rate`
  ).all(type, req.businessId, from, to);

  // Invoice-level detail with party GSTIN & state for inter/intra-state split
  const invoices = db.prepare(
    `SELECT inv.invoice_no, inv.date, inv.subtotal, inv.tax_total, inv.total,
            p.name AS party_name, p.gstin AS party_gstin, p.state AS party_state
     FROM invoices inv LEFT JOIN parties p ON p.id=inv.party_id
     WHERE inv.type=? AND inv.business_id=? AND inv.date>=? AND inv.date<=?
     ORDER BY inv.date, inv.id`
  ).all(type, req.businessId, from, to);

  const homeState = (company.state || '').trim().toLowerCase();
  const detail = invoices.map((r) => {
    const interState = r.party_state && homeState && r.party_state.trim().toLowerCase() !== homeState;
    const igst = interState ? r.tax_total : 0;
    const cgst = interState ? 0 : r.tax_total / 2;
    const sgst = interState ? 0 : r.tax_total / 2;
    return {
      invoice_no: r.invoice_no, date: r.date,
      party_name: r.party_name || 'Unregistered/Walk-in',
      gstin: r.party_gstin || '',
      category: r.party_gstin ? 'B2B' : 'B2C',
      place: r.party_state || '',
      taxable: r.subtotal,
      cgst: round2(cgst), sgst: round2(sgst), igst: round2(igst),
      total: r.total,
    };
  });

  const totals = detail.reduce((a, d) => {
    a.taxable += d.taxable; a.cgst += d.cgst; a.sgst += d.sgst; a.igst += d.igst; a.total += d.total;
    return a;
  }, { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 });
  Object.keys(totals).forEach((k) => (totals[k] = round2(totals[k])));

  res.json({
    type, from, to,
    company,
    rateWise: rateWise.map((r) => ({
      gst_rate: r.gst_rate, taxable: r.taxable,
      cgst: round2(r.total_tax / 2), sgst: round2(r.total_tax / 2), total_tax: r.total_tax,
    })),
    detail, totals,
    b2bCount: detail.filter((d) => d.category === 'B2B').length,
    b2cCount: detail.filter((d) => d.category === 'B2C').length,
  });
});

function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

// ---- Months that have sales (for the GSTR-1 month picker) ----
router.get('/gst-months', (req, res) => {
  const rows = db.prepare(
    `SELECT DISTINCT substr(date,1,7) AS month FROM invoices WHERE type='sale' AND business_id=? ORDER BY month DESC`
  ).all(req.businessId);
  res.json(rows.map((r) => r.month));
});

// ---- HSN-wise summary (Table 12 of GSTR-1) ----
router.get('/hsn-summary', (req, res) => {
  const { fy, from: qf, to: qt } = req.query;
  let from, to;
  if (fy) { ({ from, to } = fyRange(fy)); }
  else { from = qf || '2000-01-01'; to = qt || '2999-12-31'; }
  const company = db.prepare('SELECT state, state_code, gstin FROM businesses WHERE id=?').get(req.businessId) || {};
  const home = (company.state_code || (company.gstin || '').slice(0, 2) || '').trim();

  const rows = db.prepare(
    `SELECT ii.hsn, ii.item_name, ii.gst_rate, i.unit AS item_unit,
            SUM(ii.qty) AS qty, SUM(ii.taxable) AS taxable, SUM(ii.tax_amount) AS tax
     FROM invoice_items ii
     JOIN invoices inv ON inv.id=ii.invoice_id
     LEFT JOIN items i ON i.id=ii.item_id
     WHERE inv.type='sale' AND inv.business_id=? AND inv.date>=? AND inv.date<=?
     GROUP BY ii.hsn, ii.gst_rate, i.unit`
  ).all(req.businessId, from, to);

  // Aggregate by HSN + rate + UQC
  const map = {};
  for (const r of rows) {
    const uqc = toUQC(r.item_unit);
    const key = (r.hsn || 'NA') + '|' + r.gst_rate + '|' + uqc;
    if (!map[key]) map[key] = { hsn: r.hsn || '', description: r.item_name, uqc, gst_rate: r.gst_rate, qty: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, total_tax: 0 };
    const m = map[key];
    m.qty += Number(r.qty) || 0;
    m.taxable += r.taxable;
    m.total_tax += r.tax;
    m.cgst += r.tax / 2; m.sgst += r.tax / 2;
  }
  const data = Object.values(map).map((m) => ({
    hsn: m.hsn, description: (m.description || '').slice(0, 30), uqc: m.uqc,
    gst_rate: m.gst_rate,
    qty: round2(m.qty), taxable: round2(m.taxable),
    cgst: round2(m.cgst), sgst: round2(m.sgst), igst: round2(m.igst),
    total_tax: round2(m.total_tax),
    total_value: round2(m.taxable + m.total_tax),
  })).sort((a, b) => String(a.hsn).localeCompare(String(b.hsn)));

  res.json(data);
});

// ---- GSTR-1 JSON (GST portal offline-utility format) ----
router.get('/gstr1-json', (req, res) => {
  const month = req.query.month;
  if (!month || !/^\d{4}-\d{2}$/.test(month))
    return res.status(400).json({ error: 'month (YYYY-MM) is required' });
  const company = db.prepare('SELECT gstin FROM businesses WHERE id=?').get(req.businessId) || {};
  if (!company.gstin)
    return res.status(400).json({ error: 'Set this business\'s GSTIN in Settings before exporting GSTR-1.' });

  const { json } = buildGstr1(month, req.businessId);
  // Block download of an invalid file (can be overridden with ?force=1)
  if (req.query.download === '1') {
    const v = validateGstr1(json);
    if (!v.ok && req.query.force !== '1') {
      return res.status(422).json({ error: 'GSTR-1 JSON has validation errors', validation: v });
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="GSTR1_${json.gstin}_${json.fp}.json"`);
    return res.send(JSON.stringify(json, null, 2));
  }
  res.json(json);
});

// Preview summary + schema validation for the GSTR-1 export screen
router.get('/gstr1-summary', (req, res) => {
  const month = req.query.month;
  if (!month || !/^\d{4}-\d{2}$/.test(month))
    return res.status(400).json({ error: 'month (YYYY-MM) is required' });
  const { summary, hsn, json } = buildGstr1(month, req.businessId);
  const validation = validateGstr1(json);
  res.json({
    summary, hsn, validation,
    sections: {
      b2b: summary.b2bCount, b2cl: summary.b2clCount, b2cs: summary.b2csCount,
      cdnr: summary.cdnrCount, cdnur: summary.cdnurCount, nil: summary.nilCount,
      hsn: summary.hsnCount,
    },
  });
});

// Standalone validation endpoint (validate without downloading)
router.get('/gstr1-validate', (req, res) => {
  const month = req.query.month;
  if (!month || !/^\d{4}-\d{2}$/.test(month))
    return res.status(400).json({ error: 'month (YYYY-MM) is required' });
  const { json } = buildGstr1(month, req.businessId);
  res.json(validateGstr1(json));
});

module.exports = router;
