const express = require('express');
const db = require('../db');
const router = express.Router();

// Default feature toggles (Tally "F11/F12" style company features)
const DEFAULT_FEATURES = {
  enableGST: true,          // show GST columns / CGST-SGST split
  enableBatch: true,        // batch-wise inventory & expiry
  enableExpiry: true,       // track & alert on expiry
  enableDiscount: true,     // per-line discount column
  discountMode: 'tcs',      // 'tcs' = Trade/CD/SD columns (default) | 'pct' = single % discount column
  enableMRP: true,          // show MRP on batches/print
  enableHSN: true,          // show HSN column
  autoRoundOff: true,       // round invoice total to nearest rupee
  whatsappAutoSend: false,  // auto-send the bill PDF to the customer on WhatsApp after saving a sale
  whatsappAutoPrompt: true, // if no number is saved, ask for one instead of skipping
  negativeStock: false,     // allow selling beyond available stock
  duplicateSerialAlert: true, // warn on duplicate batch/serial numbers
  showStockInVoucher: true, // show available stock next to items
  printPreview: true,       // in-app print preview instead of new tab
  defaultPayMode: 'cash',   // cash | upi | bank | cheque
  invoiceFooter: 'Thank you for your business!',
  b2clThreshold: 250000,    // ₹ above which inter-state B2C is reported invoice-wise (B2CL)
  autoHSN: true,            // auto-suggest HSN code & GST rate while adding items
  gstinAutoFill: true,      // auto-fill party details from GSTIN
  gstApiUrl: '',            // optional GSTIN lookup API URL template ({gstin}/{key})
  gstApiKey: '',            // optional API key for the above
  gstApiHeader: 'Authorization', // header name to send the key in
};

function parseFeatures(row) {
  let f = {};
  try { f = JSON.parse(row.features || '{}'); } catch (_) { f = {}; }
  return { ...DEFAULT_FEATURES, ...f };
}

function getCompany() {
  const row = db.prepare('SELECT * FROM company WHERE id=1').get();
  row.features = parseFeatures(row);
  return row;
}

router.get('/', (req, res) => {
  res.json(getCompany());
});

// Expose just the defaults (handy for the UI to render the toggle list)
router.get('/feature-defaults', (req, res) => {
  res.json(DEFAULT_FEATURES);
});

router.put('/', (req, res) => {
  const b = req.body || {};
  const current = getCompany();
  const features = b.features ? { ...current.features, ...b.features } : current.features;
  db.prepare(
    `UPDATE company SET name=@name, gstin=@gstin, phone=@phone, email=@email, address=@address,
      state=@state, state_code=@state_code, invoice_prefix=@invoice_prefix, terms=@terms,
      fy_start_month=@fy_start_month, features=@features WHERE id=1`
  ).run({
    name: b.name ?? current.name,
    gstin: b.gstin ?? current.gstin,
    phone: b.phone ?? current.phone,
    email: b.email ?? current.email,
    address: b.address ?? current.address,
    state: b.state ?? current.state,
    state_code: b.state_code ?? current.state_code,
    invoice_prefix: b.invoice_prefix ?? current.invoice_prefix,
    terms: b.terms ?? current.terms,
    fy_start_month: Number(b.fy_start_month) || current.fy_start_month || 4,
    features: JSON.stringify(features),
  });
  res.json(getCompany());
});

// PATCH only the feature toggles (used by the F12 configuration panel)
router.patch('/features', (req, res) => {
  const current = getCompany();
  const merged = { ...current.features, ...(req.body || {}) };
  db.prepare('UPDATE company SET features=? WHERE id=1').run(JSON.stringify(merged));
  res.json(getCompany());
});

module.exports = router;
