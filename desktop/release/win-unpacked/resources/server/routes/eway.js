// E-Way Bill management: create/track transport docs for invoices, export the
// GST portal (EWB) JSON, and print a slip.
const express = require('express');
const db = require('../db');
const { businessContext } = require('../business');
const router = express.Router();

router.use(businessContext);

const TRANS_MODE = { road: '1', rail: '2', air: '3', ship: '4' };

function interState(fromState, toState) {
  const a = (fromState || '').trim().toLowerCase();
  const b = (toState || '').trim().toLowerCase();
  return a && b && a !== b;
}

// List e-way bills for the active business.
router.get('/', (req, res) => {
  const rows = db.prepare(
    `SELECT e.*, inv.invoice_no FROM eway_bills e
     LEFT JOIN invoices inv ON inv.id = e.invoice_id
     WHERE e.business_id = ? ORDER BY e.id DESC`
  ).all(req.businessId);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const e = db.prepare('SELECT * FROM eway_bills WHERE id=?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'E-Way Bill not found' });
  res.json(e);
});

// Prefill helper: build a draft from an existing invoice.
router.get('/from-invoice/:invId', (req, res) => {
  const inv = db.prepare(
    `SELECT inv.*, p.name party_name, p.gstin party_gstin, p.address party_address, p.state party_state
     FROM invoices inv LEFT JOIN parties p ON p.id=inv.party_id WHERE inv.id=?`
  ).get(req.params.invId);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const biz = db.prepare('SELECT * FROM businesses WHERE id=?').get(inv.business_id) || {};
  const outward = inv.type === 'sale';
  const seller = { gstin: biz.gstin, name: biz.name, addr: biz.address, state: biz.state };
  const buyer = { gstin: inv.party_gstin, name: inv.party_name, addr: inv.party_address, state: inv.party_state };
  const from = outward ? seller : buyer;
  const to = outward ? buyer : seller;
  res.json({
    invoice_id: inv.id, doc_no: inv.invoice_no, doc_date: inv.date, doc_type: 'INV',
    supply_type: outward ? 'O' : 'I', sub_type: 'supply',
    from_gstin: from.gstin || '', from_name: from.name || '', from_addr: from.addr || '', from_state: from.state || '',
    to_gstin: to.gstin || '', to_name: to.name || '', to_addr: to.addr || '', to_state: to.state || '',
    total_value: inv.total, taxable_value: inv.subtotal,
    cgst: interState(from.state, to.state) ? 0 : inv.tax_total / 2,
    sgst: interState(from.state, to.state) ? 0 : inv.tax_total / 2,
    igst: interState(from.state, to.state) ? inv.tax_total : 0,
  });
});

const FIELDS = [
  'invoice_id', 'ewb_no', 'ewb_date', 'supply_type', 'sub_type', 'doc_type', 'doc_no', 'doc_date',
  'from_gstin', 'from_name', 'from_addr', 'from_place', 'from_pin', 'from_state',
  'to_gstin', 'to_name', 'to_addr', 'to_place', 'to_pin', 'to_state',
  'transporter_id', 'transporter_name', 'trans_mode', 'trans_distance', 'trans_doc_no', 'trans_doc_date',
  'vehicle_no', 'vehicle_type', 'total_value', 'taxable_value', 'cgst', 'sgst', 'igst', 'notes', 'status',
];

function sanitize(b) {
  const today = new Date().toISOString().slice(0, 10);
  const o = {};
  for (const f of FIELDS) o[f] = b[f] !== undefined && b[f] !== null ? b[f] : '';
  o.ewb_date = b.ewb_date || today; // NOT NULL
  o.invoice_id = b.invoice_id || null;
  o.trans_distance = Number(b.trans_distance) || 0;
  o.total_value = Number(b.total_value) || 0;
  o.taxable_value = Number(b.taxable_value) || 0;
  o.cgst = Number(b.cgst) || 0; o.sgst = Number(b.sgst) || 0; o.igst = Number(b.igst) || 0;
  o.status = ['draft', 'generated', 'cancelled'].includes(b.status) ? b.status : 'draft';
  o.trans_mode = ['road', 'rail', 'air', 'ship'].includes(b.trans_mode) ? b.trans_mode : 'road';
  o.vehicle_type = b.vehicle_type === 'O' ? 'O' : 'R';
  return o;
}

router.post('/', (req, res) => {
  const s = sanitize(req.body || {});
  const cols = FIELDS.join(', ');
  const vals = FIELDS.map((f) => '@' + f).join(', ');
  const info = db.prepare(
    `INSERT INTO eway_bills (business_id, created_by, ${cols}) VALUES (@business_id, @created_by, ${vals})`
  ).run({ ...s, business_id: req.businessId, created_by: (req.user && req.user.id) || null });
  res.json(db.prepare('SELECT * FROM eway_bills WHERE id=?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM eway_bills WHERE id=?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  const s = sanitize({ ...cur, ...req.body });
  const setSql = FIELDS.map((f) => `${f}=@${f}`).join(', ');
  db.prepare(`UPDATE eway_bills SET ${setSql} WHERE id=@id`).run({ ...s, id: req.params.id });
  res.json(db.prepare('SELECT * FROM eway_bills WHERE id=?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM eway_bills WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Export GST-portal-compatible EWB JSON (offline utility bulk format).
router.get('/:id/json', (req, res) => {
  const e = db.prepare('SELECT * FROM eway_bills WHERE id=?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Not found' });
  const gstDate = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  const rec = {
    supplyType: e.supply_type || 'O',
    subSupplyType: '1',
    docType: e.doc_type || 'INV',
    docNo: e.doc_no || '',
    docDate: gstDate(e.doc_date),
    fromGstin: e.from_gstin || 'URP',
    fromTrdName: e.from_name || '',
    fromAddr1: e.from_addr || '',
    fromPlace: e.from_place || '',
    fromPincode: Number(e.from_pin) || 0,
    fromStateCode: (e.from_gstin || '').slice(0, 2) || '',
    toGstin: e.to_gstin || 'URP',
    toTrdName: e.to_name || '',
    toAddr1: e.to_addr || '',
    toPlace: e.to_place || '',
    toPincode: Number(e.to_pin) || 0,
    toStateCode: (e.to_gstin || '').slice(0, 2) || '',
    totInvValue: e.total_value || 0,
    totalValue: e.taxable_value || 0,
    cgstValue: e.cgst || 0,
    sgstValue: e.sgst || 0,
    igstValue: e.igst || 0,
    transporterId: e.transporter_id || '',
    transporterName: e.transporter_name || '',
    transMode: TRANS_MODE[e.trans_mode] || '1',
    transDistance: String(e.trans_distance || 0),
    transDocNo: e.trans_doc_no || '',
    transDocDate: gstDate(e.trans_doc_date),
    vehicleNo: (e.vehicle_no || '').replace(/\s/g, '').toUpperCase(),
    vehicleType: e.vehicle_type || 'R',
  };
  const payload = { version: '1.0.0', billLists: [rec] };
  if (req.query.download === '1') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="EWB_${e.doc_no || e.id}.json"`);
    return res.send(JSON.stringify(payload, null, 2));
  }
  res.json(payload);
});

module.exports = router;
