const express = require('express');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const db = require('../db');
let QRCode = null;
try { QRCode = require('qrcode'); } catch (_) { QRCode = null; }
const router = express.Router();

// Unicode font (has the ₹ glyph). Falls back to Helvetica if missing.
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const FONT_REG = path.join(FONT_DIR, 'DejaVuSans.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'DejaVuSans-Bold.ttf');
const HAS_UNICODE = fs.existsSync(FONT_REG) && fs.existsSync(FONT_BOLD);

// Module-level font names, updated per document by setupFonts(). Shared helpers
// reference these so every layout uses the ₹-capable font when available.
let FR = 'Helvetica', FB = 'Helvetica-Bold', FO = 'Helvetica-Oblique';

// Register the fonts on a doc and return font-name helpers.
function setupFonts(doc) {
  if (HAS_UNICODE) {
    try {
      doc.registerFont('body', FONT_REG);
      doc.registerFont('bold', FONT_BOLD);
      FR = 'body'; FB = 'bold'; FO = 'body';
      return { reg: 'body', bold: 'bold', oblique: 'body', rupee: '\u20b9' };
    } catch (_) { /* fall through */ }
  }
  FR = 'Helvetica'; FB = 'Helvetica-Bold'; FO = 'Helvetica-Oblique';
  return { reg: 'Helvetica', bold: 'Helvetica-Bold', oblique: 'Helvetica-Oblique', rupee: 'Rs ' };
}

// Rupee formatting is doc-aware (uses ₹ glyph when the unicode font is active).
let RS = 'Rs ';
const rupee = (n) => RS + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num2 = (n) => (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Measure the wrapped height of the item description (incl. serials) so rows
// grow to fit long serial lists.
function descHeight(doc, font, text, width, size) {
  if (!text) return 0;
  try {
    doc.font(font).fontSize(size);
    return doc.heightOfString(String(text), { width });
  } catch (_) { return size + 2; }
}

// Decode a base64 image data URI into a Buffer PDFKit can embed (png/jpeg only).
function imageBuffer(dataUri) {
  if (!dataUri || typeof dataUri !== 'string') return null;
  const m = dataUri.match(/^data:image\/(png|jpe?g);base64,(.+)$/);
  if (!m) return null;
  try { return Buffer.from(m[2], 'base64'); } catch (_) { return null; }
}

// Number → Indian words (for the "Amount in words" line).
function amountInWords(num) {
  num = Math.round(Number(num) || 0);
  if (num === 0) return 'Zero Rupees Only';
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n) => n < 20 ? a[n] : b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : '');
  const three = (n) => (n >= 100 ? a[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + two(n % 100) : '') : two(n));
  let out = '';
  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thousand = Math.floor(num / 1000); num %= 1000;
  const hundred = num;
  if (crore) out += three(crore) + ' Crore ';
  if (lakh) out += two(lakh) + ' Lakh ';
  if (thousand) out += two(thousand) + ' Thousand ';
  if (hundred) out += three(hundred);
  return out.trim() + ' Rupees Only';
}

// Build the business + invoice bundle for a given invoice id.
function loadInvoice(id) {
  const inv = db.prepare(
    `SELECT inv.*, p.name AS party_name, p.gstin AS party_gstin, p.address AS party_address,
            p.phone AS party_phone, p.state AS party_state
     FROM invoices inv LEFT JOIN parties p ON p.id=inv.party_id WHERE inv.id=?`
  ).get(id);
  if (!inv) return null;
  inv.items = db.prepare(
    `SELECT ii.*, COALESCE(NULLIF(ii.unit,''), NULLIF(it.unit,''), 'NOS') AS unit
     FROM invoice_items ii LEFT JOIN items it ON it.id = ii.item_id
     WHERE ii.invoice_id = ?`
  ).all(inv.id);
  // Combined description text shown under the item name on the bill:
  // the free-text description + any captured serial numbers.
  for (const it of inv.items) {
    const parts = [];
    if (it.description && String(it.description).trim()) parts.push(String(it.description).trim());
    if (it.serials && String(it.serials).trim()) {
      const list = String(it.serials).split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      if (list.length) parts.push('S/N: ' + list.join(', '));
    }
    it._descText = parts.join('\n');
  }
  const biz =
    (inv.business_id && db.prepare('SELECT * FROM businesses WHERE id=?').get(inv.business_id)) ||
    db.prepare('SELECT * FROM businesses WHERE is_default=1').get() ||
    db.prepare('SELECT * FROM company WHERE id=1').get() || {};
  return { inv, biz };
}

// Resolve a QR image buffer: custom upload wins; else auto-generate a UPI QR.
async function resolveQr(biz, inv) {
  const custom = imageBuffer(biz.qr_image);
  if (custom) return custom;
  if (QRCode && biz.upi_id && String(biz.upi_id).includes('@')) {
    const payee = encodeURIComponent(biz.account_holder || biz.name || 'Payee');
    const amt = (Number(inv.total) || 0).toFixed(2);
    const upiUrl = `upi://pay?pa=${biz.upi_id}&pn=${payee}&am=${amt}&cu=INR&tn=${encodeURIComponent(inv.invoice_no || '')}`;
    try {
      const dataUrl = await QRCode.toDataURL(upiUrl, { margin: 1, width: 220 });
      return imageBuffer(dataUrl);
    } catch (_) { return null; }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Invoice PDF — 6 selectable GST tax-invoice designs
//   format1 (Vyapar)  format2 (Marg)  format3 (Miracle)
//   format4 (Tally)   format5 (Busy)  format6 (Zoho)
// All share one multi-page engine (renderTaxInvoice) with per-page header +
// footer and a carried-forward running total; only the theme differs.
// ---------------------------------------------------------------------------
const ALL_FORMATS = ['format1', 'format2', 'format3', 'format4', 'format5', 'format6'];
// Legacy bill_format values map onto the new designs.
const FORMAT_ALIASES = {
  classic: 'format4', tally: 'format4', busy: 'format5',
  vyapar: 'format1', marg: 'format2', miracle: 'format3',
  modern: 'format6', zoho: 'format6', compact: 'format3',
};
function resolveFormat(format, biz) {
  const norm = (v) => (ALL_FORMATS.includes(v) ? v : FORMAT_ALIASES[v]);
  return norm(format) || norm(biz && biz.bill_format) || 'format1';
}

function renderInvoiceDoc(doc, inv, biz, qrBuf, format) {
  const F = setupFonts(doc);
  RS = F.rupee;
  const fmt = resolveFormat(format, biz);
  renderTaxInvoice({ doc, inv, biz, qrBuf, F, fmt });
}

router.get('/invoice/:id', async (req, res) => {
  const bundle = loadInvoice(req.params.id);
  if (!bundle) return res.status(404).json({ error: 'Invoice not found' });
  const { inv, biz } = bundle;
  const qrBuf = await resolveQr(biz, inv);

  const doc = new PDFDocument({ size: 'A4', margin: 36 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${inv.invoice_no}.pdf"`);
  doc.pipe(res);
  renderInvoiceDoc(doc, inv, biz, qrBuf, req.query.format);
  doc.end();
});

// Sample-preview PDF: render a demo invoice using posted business form values,
// so users can preview each bill design (with their logo/bank/terms) before
// saving. Body = the business fields being edited; ?format=<layout>.
router.post('/invoice-preview', async (req, res) => {
  const biz = req.body || {};
  const demoInter = false;
  const inv = {
    invoice_no: (biz.invoice_prefix || 'INV') + '-0001',
    type: 'sale', note_kind: '',
    date: new Date().toISOString().slice(0, 10),
    status: 'unpaid', ref_invoice_no: '', po_no: '',
    party_name: 'Sample Customer',
    party_gstin: '27ABCDE1234F1Z5',
    party_address: 'Sample Address, Nagpur - 440001',
    party_phone: '9800000000',
    party_state: biz.state || 'Maharashtra',
    subtotal: 2440, discount: 0, tax_total: 439.2, total: 2879, paid: 1000,
    items: [
      { item_name: 'Sample Product A', _descText: 'Demo description line (small font)\nS/N: SN-001, SN-002', hsn: '1905', batch_no: 'B001', unit: 'PCS', qty: 10, price: 100, gst_rate: 18, disc_trade_pct: 5, disc_trade_amt: 50, disc_cd_pct: 2, disc_cd_amt: 19, disc_sd_pct: 0, disc_sd_amt: 0, taxable: 931, tax_amount: 167.58, line_total: 1098.58 },
      { item_name: 'Sample Product B', _descText: '', hsn: '2106', batch_no: 'B002', unit: 'BOX', qty: 5, price: 300, gst_rate: 18, disc_trade_pct: 0, disc_trade_amt: 0, disc_cd_pct: 0, disc_cd_amt: 0, disc_sd_pct: 1, disc_sd_amt: 15, disc_trade_amt2: 0, taxable: 1485, tax_amount: 267.3, line_total: 1752.3 },
    ],
  };
  const qrBuf = await resolveQr(biz, inv);
  const doc = new PDFDocument({ size: 'A4', margin: 36 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="preview.pdf"');
  doc.pipe(res);
  renderInvoiceDoc(doc, inv, biz, qrBuf, req.query.format || biz.bill_format);
  doc.end();
});

// Shared helpers ------------------------------------------------------------
const PAGE_L = 36, PAGE_R = 559, PAGE_W = PAGE_R - PAGE_L; // 523pt content width

// Returns the discount lines to print: the 3-way breakdown if present, else the
// legacy single discount. Each: { label, amount }.
function discountLines(inv) {
  // Bill-level discounts are now a single optional "Extra Discount"; the
  // Trade/CD/SD discounts live per item line.
  const out = [];
  if (inv.discount > 0) out.push({ label: 'Extra Discount', amount: inv.discount });
  return out;
}

// Total per-line discount across all items (for an informational bill line).
function lineDiscountTotal(inv) {
  return (inv.items || []).reduce((s, it) =>
    s + (Number(it.disc_trade_amt) || 0) + (Number(it.disc_cd_amt) || 0) + (Number(it.disc_sd_amt) || 0), 0);
}

// Read the company-wide feature toggles (F12 config).
function companyFeatures() {
  try {
    const row = db.prepare('SELECT features FROM company WHERE id=1').get();
    return JSON.parse((row && row.features) || '{}') || {};
  } catch (_) { return {}; }
}

// Decide which discount columns to show: 'tcs' (Trade/CD/SD), 'pct' (single %),
// or 'none'. Detect from the invoice data first so past bills print as billed;
// otherwise fall back to the company's configured discountMode.
function discountMode(inv) {
  const items = inv.items || [];
  const hasTcs = items.some((it) => (Number(it.disc_trade_amt) || 0) + (Number(it.disc_cd_amt) || 0) + (Number(it.disc_sd_amt) || 0) > 0.005);
  const hasPct = items.some((it) => (Number(it.discount) || 0) > 0.005);
  if (hasTcs) return 'tcs';
  if (hasPct) return 'pct';
  const cfg = companyFeatures();
  if (cfg.enableDiscount === false) return 'none';
  return cfg.discountMode === 'pct' ? 'pct' : 'tcs';
}

function interState(biz, inv) {
  const home = (biz.state || '').trim().toLowerCase();
  const other = (inv.party_state || '').trim().toLowerCase();
  return home && other && home !== other;
}

// dd/mm/yyyy
function fmtDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '');
}

// Build an HSN-wise tax summary (rate-grouped) for the bottom grid.
function hsnSummary(inv) {
  const map = {};
  for (const it of inv.items) {
    const key = (it.hsn || '-') + '|' + (it.gst_rate || 0);
    if (!map[key]) map[key] = { hsn: it.hsn || '-', rate: Number(it.gst_rate) || 0, taxable: 0, tax: 0 };
    map[key].taxable += Number(it.taxable != null ? it.taxable : Number(it.qty) * Number(it.price)) || 0;
    map[key].tax += Number(it.tax_amount) || 0;
  }
  return Object.values(map);
}

// ===========================================================================
// Unified tax-invoice engine + 6 themed designs
// ===========================================================================
const HEX = (c) => (/^#[0-9a-fA-F]{6}$/.test(c || '') ? c : null);

// Blend a hex colour toward white (pct>0) or black (pct<0).
function shade(hex, pct) {
  const h = HEX(hex) || '#000000';
  const n = parseInt(h.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const t = pct < 0 ? 0 : 255; const p = Math.abs(pct);
  r = Math.round((t - r) * p + r); g = Math.round((t - g) * p + g); b = Math.round((t - b) * p + b);
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
// Choose black/white text for legibility on a given background.
function idealFg(bg) {
  const h = HEX(bg) || '#ffffff';
  const n = parseInt(h.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#111111' : '#ffffff';
}

// Per-format visual theme. 'ACCENT' means: use the business accent colour.
const THEMES = {
  format1: { name: 'Vyapar', headerStyle: 'band', accent: '#2563eb', headerBg: 'ACCENT', headerFg: '#ffffff', tableBg: 'ACCENT', tableFg: '#ffffff', totalBg: 'ACCENT', totalFg: '#ffffff', border: '#c9d6f0', zebra: '#f4f7ff', frame: false, rounded: true, margin: 28 },
  format2: { name: 'Marg', headerStyle: 'band', accent: '#0a3d62', headerBg: 'ACCENT', headerFg: '#ffffff', tableBg: 'ACCENT', tableFg: '#ffffff', totalBg: 'ACCENT', totalFg: '#ffffff', border: '#0a3d62', zebra: '#eef4fb', frame: true, rounded: false, margin: 20 },
  format3: { name: 'Miracle', headerStyle: 'line', accent: '#0d7a6f', headerBg: '#ffffff', headerFg: '#0d7a6f', tableBg: '#e6f5f2', tableFg: '#0b5c54', totalBg: 'ACCENT', totalFg: '#ffffff', border: '#cfe3df', zebra: '#f4faf9', frame: true, rounded: false, margin: 26 },
  format4: { name: 'Tally', headerStyle: 'boxed', accent: '#000000', headerBg: '#ffffff', headerFg: '#000000', tableBg: '#ffffff', tableFg: '#000000', totalBg: '#ffffff', totalFg: '#000000', border: '#000000', zebra: '#ffffff', frame: true, rounded: false, margin: 22 },
  format5: { name: 'Busy', headerStyle: 'boxed', accent: '#1f4e79', headerBg: '#dbe7f3', headerFg: '#14385c', tableBg: 'ACCENT', tableFg: '#ffffff', totalBg: '#dbe7f3', totalFg: '#14385c', border: '#1f4e79', zebra: '#eef4fb', frame: true, rounded: false, margin: 22 },
  format6: { name: 'Zoho', headerStyle: 'line', accent: '#2b6cb0', headerBg: '#ffffff', headerFg: '#1a202c', tableBg: '#eef2f7', tableFg: '#334155', totalBg: 'ACCENT', totalFg: '#ffffff', border: '#e2e8f0', zebra: '#f8fafc', frame: false, rounded: true, margin: 30 },
};

function palette(biz, theme) {
  const base = HEX(biz.bill_color) || theme.accent;
  const pick = (userVal, themeVal) => HEX(userVal) || (themeVal === 'ACCENT' ? base : themeVal);
  const headerBg = pick(biz.bill_header_bg, theme.headerBg);
  const tableBg = pick(biz.bill_table_bg, theme.tableBg);
  const totalBg = pick(biz.bill_total_bg, theme.totalBg);
  return {
    accent: base,
    headerBg, headerFg: HEX(biz.bill_header_fg) || (theme.headerBg === 'ACCENT' && !HEX(biz.bill_header_bg) ? theme.headerFg : (HEX(biz.bill_header_bg) ? idealFg(headerBg) : theme.headerFg)),
    tableBg, tableFg: HEX(biz.bill_table_fg) || (HEX(biz.bill_table_bg) ? idealFg(tableBg) : (theme.tableBg === 'ACCENT' ? theme.tableFg : theme.tableFg)),
    totalBg, totalFg: HEX(biz.bill_total_fg) || (HEX(biz.bill_total_bg) ? idealFg(totalBg) : theme.totalFg),
    border: theme.border, zebra: theme.zebra, headerStyle: theme.headerStyle,
    frame: theme.frame, rounded: theme.rounded, margin: theme.margin, name: theme.name,
  };
}

// Editable invoice texts (business overrides → sensible defaults).
function invoiceTexts(biz, inv) {
  let features = {};
  try { features = JSON.parse(biz.features || '{}'); } catch (_) {}
  const auto = inv.note_kind === 'credit' ? 'CREDIT NOTE' : inv.note_kind === 'debit' ? 'DEBIT NOTE'
    : (inv.type === 'purchase' ? 'PURCHASE BILL' : 'TAX INVOICE');
  const title = (inv.note_kind || inv.type === 'purchase') ? auto : ((biz.bill_title || '').trim() || 'TAX INVOICE');
  return {
    title,
    signatory: (biz.bill_signatory || '').trim() || 'Authorised Signatory',
    billTo: (biz.bill_billto_label || '').trim() || (inv.type === 'purchase' ? 'Supplier' : 'Bill To'),
    termsHeading: (biz.bill_terms_heading || '').trim() || 'Terms & Conditions',
    declaration: (biz.bill_declaration || '').trim() || '',
    footerNote: (biz.bill_footer_note || '').trim() || (features.invoiceFooter || '').trim() || '',
  };
}

// Terms as an ordered list of strings.
function termsArray(biz) {
  let list = [];
  const raw = biz.bill_terms_list;
  if (Array.isArray(raw)) list = raw.slice();
  else if (typeof raw === 'string' && raw.trim()) {
    try { const p = JSON.parse(raw); list = Array.isArray(p) ? p : String(raw).split('\n'); }
    catch (_) { list = raw.split('\n'); }
  }
  list = list.map((s) => String(s).trim()).filter(Boolean);
  if (!list.length) {
    const fb = [];
    [biz.terms, biz.bill_terms].forEach((s) => { if (s) String(s).split(/[\n;]+/).forEach((x) => { if (x.trim()) fb.push(x.trim()); }); });
    list = fb;
  }
  return list;
}

// The main engine — draws a themed, multi-page tax invoice with a repeating
// header + footer strip and a carried-forward running total.
function renderTaxInvoice({ doc, inv, biz, qrBuf, F, fmt }) {
  F = F || setupFonts(doc); RS = F.rupee;
  const theme = THEMES[fmt] || THEMES.format1;
  const P = palette(biz, theme);
  const T = invoiceTexts(biz, inv);
  const terms = termsArray(biz);
  const inter = interState(biz, inv);

  const M = P.margin;
  const L = M, R = 595 - M, W = R - L;
  const PAGE_H = 842, BOT = PAGE_H - 30, STRIP_Y = PAGE_H - 22;
  const logoBuf = imageBuffer(biz.logo);
  const sigBuf = imageBuffer(biz.signature);
  const stampBuf = imageBuffer(biz.stamp);

  // ---- discount display mode ----
  // Detect from the invoice data first (so historical bills always show how they
  // were billed); otherwise fall back to the company's configured preference.
  const dMode = discountMode(inv);

  // ---- columns (discount columns depend on the mode) ----
  const baseCols = [
    { k: 'sr', label: 'Sr', w: 22, align: 'center' },
    { k: 'desc', label: 'Description of Goods', w: 176, align: 'left' },
    { k: 'hsn', label: 'HSN', w: 42, align: 'center' },
    { k: 'qty', label: 'Qty', w: 42, align: 'right' },
    { k: 'rate', label: 'Rate', w: 46, align: 'right' },
  ];
  if (dMode === 'tcs') baseCols.push(
    { k: 'trade', label: 'Trade', w: 44, align: 'right' },
    { k: 'cd', label: 'CD', w: 44, align: 'right' },
    { k: 'sd', label: 'SD', w: 44, align: 'right' },
  );
  else if (dMode === 'pct') baseCols.push({ k: 'disc', label: 'Disc%', w: 40, align: 'right' });
  baseCols.push(
    { k: 'gst', label: 'GST%', w: 34, align: 'right' },
    { k: 'amt', label: 'Amount', w: 62, align: 'right' },
  );
  const cols = baseCols.map((c) => ({ ...c }));
  const fixed = cols.filter((c) => c.k !== 'desc').reduce((a, c) => a + c.w, 0);
  cols.find((c) => c.k === 'desc').w = W - fixed;
  let cxp = L; cols.forEach((c) => { c.x = cxp; cxp += c.w; });
  const descColW = cols.find((c) => c.k === 'desc').w - 8;

  // amount shown per line = taxable value (pre-tax); carry-forward tracks this.
  const lineAmt = (it) => Number(it.taxable != null ? it.taxable : Number(it.qty) * Number(it.price)) || 0;

  // ---- pre-measure rows ----
  doc.font(F.reg);
  const rowsMeta = (inv.items || []).map((it, i) => {
    const desc = it._descText || '';
    const dh = desc ? descHeight(doc, F.reg, desc, descColW, 6.8) : 0;
    const rowH = Math.max(16, desc ? 14 + dh : 16);
    return { it, i, desc, rowH, amt: lineAmt(it) };
  });

  // ---- totals rows (used to size the final footer) ----
  const sum = (f) => (inv.items || []).reduce((s, it) => s + (Number(f(it)) || 0), 0);
  const tradeTot = sum((it) => it.disc_trade_amt);
  const cdTot = sum((it) => it.disc_cd_amt);
  const sdTot = sum((it) => it.disc_sd_amt);
  const roundOff = Math.round(inv.total) - inv.total;
  const half = inv.tax_total / 2;
  const rate = inv.subtotal > 0 ? ((inv.tax_total / inv.subtotal) * 100) : 0;
  // Single-% discount total (per-line gross × discount%), for 'pct' mode.
  const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const pctDiscTot = sum((it) => { const g = (Number(it.qty) || 0) * (Number(it.price) || 0); return r2((g * (Number(it.discount) || 0)) / 100); });
  const grossTot = sum((it) => (Number(it.qty) || 0) * (Number(it.price) || 0));
  const totalRows = [];
  if (dMode === 'pct' && pctDiscTot > 0.005) {
    totalRows.push({ label: 'Sub Total', val: grossTot });
    totalRows.push({ label: 'Discount', val: -pctDiscTot });
  } else {
    totalRows.push({ label: 'Sub Total', val: inv.subtotal });
    if (tradeTot > 0.005) totalRows.push({ label: 'Trade Disc.', val: -tradeTot });
    if (cdTot > 0.005) totalRows.push({ label: 'Cash Disc (CD)', val: -cdTot });
    if (sdTot > 0.005) totalRows.push({ label: 'Special Disc (SD)', val: -sdTot });
  }
  discountLines(inv).forEach((d) => totalRows.push({ label: d.label, val: -d.amount }));
  totalRows.push({ label: 'Taxable Value', val: inv.subtotal });
  if (inter) totalRows.push({ label: 'IGST', val: inv.tax_total, pct: rate.toFixed(1) + '%' });
  else { totalRows.push({ label: 'CGST', val: half, pct: (rate / 2).toFixed(1) + '%' }); totalRows.push({ label: 'SGST', val: half, pct: (rate / 2).toFixed(1) + '%' }); }
  if (Math.abs(roundOff) >= 0.01) totalRows.push({ label: 'Round Off', val: roundOff });

  // ---- measure the final footer block ----
  const bankLines = [];
  if (biz.bank_name || biz.bank_branch) bankLines.push([biz.bank_name, biz.bank_branch].filter(Boolean).join(', '));
  if (biz.bank_account) bankLines.push('A/c No: ' + biz.bank_account);
  if (biz.bank_ifsc) bankLines.push('IFSC: ' + biz.bank_ifsc);
  if (biz.account_holder) bankLines.push('A/c Name: ' + biz.account_holder);
  if (biz.upi_id) bankLines.push('UPI: ' + biz.upi_id);

  const rightW = 210, rightX = R - rightW;
  const leftW = rightX - L - 12;
  // totals table height
  const totalsH = totalRows.length * 13 + 26; // rows + grand-total box
  // terms height
  doc.font(F.reg).fontSize(7.5);
  let termsH = 14;
  terms.forEach((t, i) => { termsH += doc.heightOfString((i + 1) + '. ' + t, { width: leftW - 8 }) + 2; });
  const block1H = Math.max(totalsH, termsH, 40) + 8;
  // words band
  const wordsH = 22;
  // bank + signatory
  doc.font(F.reg).fontSize(8);
  let bankH = 14; bankLines.forEach((s) => { bankH += doc.heightOfString(s, { width: leftW - 8 }) + 1.5; });
  const block3H = Math.max(bankH, 82) + 6;
  // declaration + footer note
  doc.font(F.reg).fontSize(7.5);
  let declH = 0;
  if (T.declaration) declH += doc.heightOfString(T.declaration, { width: W - 12 }) + 3;
  if (T.footerNote) declH += doc.heightOfString(T.footerNote, { width: W - 12 }) + 3;
  const block4H = declH ? declH + 6 : 0;
  const footerH = block1H + wordsH + block3H + block4H + 10;

  // ---- geometry / pagination ----
  // Where the business block ends (party/meta box starts) for each header style.
  const HEADER_BODY_END = P.headerStyle === 'band' ? (M + 92 + 6)
    : P.headerStyle === 'boxed' ? (M + 34 + 66)
    : (M + 62 + 8);                       // line style
  const PARTY_BOX_H = 88;
  const HEAD_FULL = HEADER_BODY_END + PARTY_BOX_H;   // table header starts here on page 1
  const HEAD_CONT = 54;
  const colHeaderH = 18;
  const carryH = 16, broughtH = 16, stripH = 14;
  const headTopFor = (p) => (p === 0 ? HEAD_FULL : HEAD_CONT);
  const rowsTopFor = (p) => headTopFor(p) + colHeaderH + (p === 0 ? 0 : broughtH);
  const contMaxY = BOT - stripH - carryH;
  const lastMaxY = BOT - stripH - footerH;

  // greedy fill by contMaxY, then push overflow off the last page for the footer
  let pages = []; { let cur = [], p = 0, y = rowsTopFor(0);
    for (const r of rowsMeta) {
      if (cur.length && y + r.rowH > contMaxY) { pages.push(cur); cur = []; p++; y = rowsTopFor(p); }
      cur.push(r); y += r.rowH;
    }
    pages.push(cur);
  }
  if (!pages.length) pages = [[]];
  for (let guard = 0; guard < rowsMeta.length + 2; guard++) {
    const last = pages[pages.length - 1];
    let y = rowsTopFor(pages.length - 1); last.forEach((r) => { y += r.rowH; });
    if (y <= lastMaxY || last.length <= 1) break;
    const moved = [];
    while (last.length > 1) {
      let yy = rowsTopFor(pages.length - 1); last.forEach((r) => { yy += r.rowH; });
      if (yy <= lastMaxY) break;
      moved.unshift(last.pop());
    }
    pages.push(moved);
  }
  const totalPages = pages.length;

  // ---- drawing primitives ----
  const money = (n) => RS + num2(n);
  const drawFrame = () => {
    doc.page.margins.bottom = 6; doc.page.margins.top = 6;
    if (P.frame) doc.lineWidth(1).strokeColor(P.border).rect(L, M, W, BOT - M).stroke();
  };

  function drawBandHeader() {
    const bandH = 92;
    if (P.rounded) doc.roundedRect(L, M, W, bandH, 8).fill(P.headerBg);
    else doc.rect(L, M, W, bandH).fill(P.headerBg);
    let tx = L + 12;
    if (logoBuf) {
      doc.roundedRect(L + 10, M + 12, 60, 60, 6).fill('#ffffff');
      try { doc.image(logoBuf, L + 13, M + 15, { fit: [54, 54] }); } catch (_) {}
      tx = L + 82;
    }
    doc.fillColor(P.headerFg).font(F.bold).fontSize(19).text(biz.name || '', tx, M + 12, { width: 330 });
    doc.font(F.reg).fontSize(8).fillColor(P.headerFg);
    if (biz.address) doc.text(biz.address, tx, doc.y + 2, { width: 330 });
    const hb = [biz.phone && 'Ph: ' + biz.phone, biz.email].filter(Boolean).join('   ');
    if (hb) doc.text(hb, tx, doc.y + 1, { width: 330 });
    if (biz.gstin) doc.text('GSTIN: ' + biz.gstin, tx, doc.y + 1, { width: 330 });
    const titleSize = (T.title || '').length > 12 ? 15 : 20;
    doc.fillColor(P.headerFg).font(F.bold).fontSize(titleSize).text(T.title, R - 230, M + 14, { width: 218, align: 'right', lineBreak: false });
    doc.font(F.reg).fontSize(8.5).fillColor(P.headerFg).text('# ' + (inv.invoice_no || ''), R - 230, M + 42, { width: 218, align: 'right' });
    doc.text(fmtDate(inv.date), R - 230, doc.y + 1, { width: 218, align: 'right' });
    return M + bandH + 6;
  }

  function drawBoxedHeader() {
    // centered title, then business block, then party/meta boxes
    doc.fillColor(P.headerFg).font(F.bold).fontSize(13).text(T.title, L, M + 6, { width: W, align: 'center' });
    doc.font(F.reg).fontSize(7).fillColor(shade(P.headerFg, 0.3)).text('(ORIGINAL FOR RECIPIENT)', L, M + 22, { width: W, align: 'center' });
    let y = M + 34; doc.moveTo(L, y).lineTo(R, y).strokeColor(P.border).lineWidth(0.8).stroke();
    let sx = L + 8;
    if (logoBuf) { try { doc.image(logoBuf, L + 6, y + 6, { fit: [46, 46] }); sx = L + 58; } catch (_) {} }
    doc.fillColor(P.headerFg).font(F.bold).fontSize(15).text(biz.name || '', sx, y + 6, { width: R - sx - 8 });
    doc.font(F.reg).fontSize(8).fillColor('#333');
    if (biz.address) doc.text(biz.address, sx, doc.y + 1, { width: R - sx - 8 });
    const sbits = [biz.gstin && 'GSTIN/UIN: ' + biz.gstin, biz.state && 'State: ' + biz.state + (biz.state_code ? ' (' + biz.state_code + ')' : '')].filter(Boolean);
    sbits.forEach((b) => doc.text(b, sx, doc.y, { width: R - sx - 8 }));
    if (biz.phone) doc.text('Contact: ' + biz.phone, sx, doc.y);
    return y + 66;
  }

  function drawLineHeader() {
    let tx = L;
    if (logoBuf) { try { doc.image(logoBuf, L, M + 2, { fit: [50, 50] }); tx = L + 60; } catch (_) {} }
    doc.fillColor(P.headerFg).font(F.bold).fontSize(19).text(biz.name || '', tx, M + 2, { width: 340 });
    doc.font(F.reg).fontSize(8).fillColor('#555');
    if (biz.address) doc.text(biz.address, tx, doc.y + 2, { width: 340 });
    const hb = [biz.phone && 'Ph: ' + biz.phone, biz.email, biz.gstin && 'GSTIN: ' + biz.gstin].filter(Boolean).join('   ');
    if (hb) doc.text(hb, tx, doc.y + 1, { width: 360 });
    const titleSize = (T.title || '').length > 12 ? 15 : 22;
    doc.fillColor(P.accent).font(F.bold).fontSize(titleSize).text(T.title, R - 230, M + 6, { width: 230, align: 'right', lineBreak: false });
    doc.font(F.reg).fontSize(8.5).fillColor('#555').text('Invoice #: ' + (inv.invoice_no || ''), R - 230, M + 32, { width: 230, align: 'right' });
    doc.text('Date: ' + fmtDate(inv.date), R - 230, doc.y + 1, { width: 230, align: 'right' });
    const y = M + 62;
    doc.rect(L, y, W, 2.4).fill(P.accent);
    return y + 8;
  }

  // Party + meta band (page 1). Returns y after.
  function drawPartyMeta(topY) {
    const midX = L + W * 0.62;
    const boxH = HEAD_FULL - topY - 4;   // party box ends just above the table header
    const by = topY;
    if (P.frame || P.headerStyle !== 'band') {
      doc.rect(L, by, W, boxH).strokeColor(P.border).lineWidth(0.7).stroke();
      doc.moveTo(midX, by).lineTo(midX, by + boxH).strokeColor(P.border).lineWidth(0.7).stroke();
    } else {
      doc.roundedRect(L, by, midX - L - 6, boxH, 6).fill(P.zebra);
      doc.roundedRect(midX, by, R - midX, boxH, 6).fill(P.zebra);
    }
    doc.fillColor(P.accent).font(F.bold).fontSize(8.5).text(T.billTo.toUpperCase(), L + 8, by + 6);
    doc.fillColor('#111').font(F.bold).fontSize(11).text((inv.party_name || 'Cash Customer'), L + 8, by + 18, { width: midX - L - 16 });
    doc.fillColor('#444').font(F.reg).fontSize(8.5);
    if (inv.party_address) doc.text(inv.party_address, L + 8, doc.y + 1, { width: midX - L - 16 });
    if (inv.party_gstin) doc.text('GSTIN: ' + inv.party_gstin, L + 8, doc.y + 1, { width: midX - L - 16 });
    if (inv.party_state) doc.text('State: ' + inv.party_state, L + 8, doc.y, { width: midX - L - 16 });
    if (inv.party_phone) doc.text('Ph: ' + inv.party_phone, L + 8, doc.y, { width: midX - L - 16 });
    const mrow = (lbl, val, yy) => {
      doc.fillColor('#666').font(F.reg).fontSize(8.5).text(lbl, midX + 8, yy, { width: 92 });
      doc.fillColor('#111').font(F.bold).fontSize(8.5).text(val || '-', midX + 96, yy, { width: R - midX - 104, align: 'right' });
    };
    let my = by + 6;
    mrow('Invoice No.', inv.invoice_no, my); my += 15;
    mrow('Date', fmtDate(inv.date), my); my += 15;
    if (inv.ref_invoice_no) { mrow('Ref No.', inv.ref_invoice_no, my); my += 15; }
    if (inv.po_no) { mrow('PO No.', inv.po_no, my); my += 15; }
    mrow('Balance Due', money(inv.total - inv.paid), my);
  }

  function drawFullHeader() {
    let y;
    if (P.headerStyle === 'band') y = drawBandHeader();
    else if (P.headerStyle === 'boxed') y = drawBoxedHeader();
    else y = drawLineHeader();
    drawPartyMeta(y);
  }

  function drawCompactHeader() {
    let tx = L + 2;
    if (logoBuf) { try { doc.image(logoBuf, L + 2, M + 4, { fit: [30, 30] }); tx = L + 38; } catch (_) {} }
    doc.fillColor(P.headerStyle === 'band' ? P.accent : P.headerFg).font(F.bold).fontSize(14).text(biz.name || '', tx, M + 6, { width: 320, lineBreak: false });
    doc.fillColor(P.accent).font(F.bold).fontSize(12).text(T.title + ' (Contd.)', R - 240, M + 6, { width: 240, align: 'right' });
    doc.fillColor('#555').font(F.reg).fontSize(8).text('Invoice #: ' + (inv.invoice_no || '') + '   Date: ' + fmtDate(inv.date), R - 240, M + 24, { width: 240, align: 'right' });
    doc.moveTo(L, M + 42).lineTo(R, M + 42).strokeColor(P.border).lineWidth(0.6).stroke();
  }

  function drawColHeader(topY) {
    doc.rect(L, topY, W, colHeaderH).fill(P.tableBg);
    doc.fillColor(P.tableFg).font(F.bold).fontSize(7.5);
    cols.forEach((c) => doc.text(c.label, c.x + 3, topY + 5, { width: c.w - 5, align: c.align, lineBreak: false }));
    // column separators for boxed themes
    if (P.frame) { doc.strokeColor(shade(P.tableFg, 0.5)).lineWidth(0.3); }
  }

  function drawSpanRow(topY, label, amount, h) {
    doc.rect(L, topY, W, h).fill(shade(P.accent, 0.82));
    doc.fillColor('#111').font(F.bold).fontSize(8).text(label, L + 6, topY + 4, { width: W - 120 });
    doc.fillColor('#111').font(F.bold).fontSize(8.5).text(money(amount), cols.find((c) => c.k === 'amt').x - 40, topY + 4, { width: R - (cols.find((c) => c.k === 'amt').x - 40) - 4, align: 'right' });
  }

  function drawRow(r, y) {
    const { it, i, desc, rowH } = r;
    if (i % 2 === 1 && HEX(P.zebra) && P.zebra.toLowerCase() !== '#ffffff') doc.rect(L, y, W, rowH).fill(P.zebra);
    // Show the resolved discount AMOUNT (₹) for Trade / CD / SD, not the %.
    const dcell = (pct, amt) => { const a = Number(amt) || 0; return a > 0 ? num2(a) : '-'; };
    const val = {
      sr: String(i + 1), hsn: it.hsn || '-',
      qty: num2(it.qty).replace(/\.00$/, '') + (it.unit ? ' ' + it.unit : ''),
      rate: num2(it.price), trade: dcell(it.disc_trade_pct, it.disc_trade_amt),
      cd: dcell(it.disc_cd_pct, it.disc_cd_amt), sd: dcell(it.disc_sd_pct, it.disc_sd_amt),
      disc: (Number(it.discount) || 0) > 0 ? num2(it.discount).replace(/\.00$/, '') + '%' : '-',
      gst: String(it.gst_rate || 0), amt: num2(r.amt),
    };
    cols.forEach((c) => {
      if (c.k === 'desc') {
        doc.fillColor('#111').font(F.bold).fontSize(8.5).text(it.item_name || '', c.x + 4, y + 3, { width: c.w - 8, align: 'left' });
        if (desc) doc.fillColor('#666').font(F.reg).fontSize(6.8).text(desc, c.x + 4, y + 3 + doc.heightOfString(it.item_name || 'x', { width: c.w - 8 }), { width: c.w - 8 });
      } else {
        doc.fillColor('#222').font(F.reg).fontSize(8).text(val[c.k], c.x + 3, y + 4.5, { width: c.w - 5, align: c.align, lineBreak: false });
      }
    });
    return y + rowH;
  }

  function drawColSeparators(topY, endY) {
    doc.strokeColor(P.border).lineWidth(0.4);
    cols.slice(1).forEach((c) => doc.moveTo(c.x, topY).lineTo(c.x, endY).stroke());
    doc.rect(L, topY, W, endY - topY).strokeColor(P.border).lineWidth(0.6).stroke();
  }

  function drawStrip(p) {
    doc.fillColor('#888').font(F.reg).fontSize(7).text(biz.name || '', L, STRIP_Y, { width: W / 2 });
    doc.fillColor('#888').font(F.reg).fontSize(7).text('Page ' + (p + 1) + ' of ' + totalPages, L + W / 2, STRIP_Y, { width: W / 2, align: 'right' });
  }

  function drawFinalFooter(topY) {
    const rightX2 = R - rightW;
    let y = topY;
    // Terms (left) + Totals (right)
    doc.fillColor(P.accent).font(F.bold).fontSize(9).text(T.termsHeading, L, y);
    let ty = y + 14;
    doc.font(F.reg).fontSize(7.5).fillColor('#444');
    if (terms.length) terms.forEach((t, i) => { doc.text((i + 1) + '. ' + t, L, ty, { width: leftW - 8 }); ty = doc.y + 2; });
    else doc.fillColor('#999').text('—', L, ty);

    // totals table (right)
    let tyR = y;
    const trow = (label, val, opts = {}) => {
      doc.font(opts.bold ? F.bold : F.reg).fontSize(opts.bold ? 9 : 8.5).fillColor(opts.bold ? P.accent : '#444');
      doc.text(label + (opts.pct ? '  ' + opts.pct : ''), rightX2, tyR, { width: rightW - 88, align: 'left' });
      doc.fillColor('#111').font(opts.bold ? F.bold : F.reg).text(money(val), rightX2 + rightW - 88, tyR, { width: 88, align: 'right' });
      tyR += 13;
    };
    totalRows.forEach((r) => trow(r.label, r.val, { pct: r.pct }));
    // grand total highlight box
    tyR += 2;
    doc.rect(rightX2, tyR, rightW, 20).fill(P.totalBg);
    doc.fillColor(P.totalFg).font(F.bold).fontSize(11).text('Grand Total', rightX2 + 6, tyR + 5, { width: 90 });
    doc.fillColor(P.totalFg).font(F.bold).fontSize(11).text(money(inv.total), rightX2 + 6, tyR + 5, { width: rightW - 12, align: 'right' });
    tyR += 24;
    doc.fillColor('#444').font(F.reg).fontSize(8).text('Received: ' + money(inv.paid), rightX2, tyR, { width: rightW, align: 'right' });
    doc.fillColor('#b91c1c').font(F.bold).fontSize(8.5).text('Balance Due: ' + money(inv.total - inv.paid), rightX2, tyR + 12, { width: rightW, align: 'right' });

    y = topY + block1H;
    // In-words band
    doc.rect(L, y, W, wordsH).fill(shade(P.accent, 0.86));
    doc.fillColor('#111').font(F.bold).fontSize(8.5).text('Amount in Words: ', L + 6, y + 6, { continued: true }).font(F.reg).text(amountInWords(inv.total));
    y += wordsH + 4;

    // Bank + QR (left) | signatory (right)
    const bankTop = y;
    doc.fillColor(P.accent).font(F.bold).fontSize(8.5).text('Bank & Payment Details', L, y);
    let byy = y + 13; doc.fillColor('#333').font(F.reg).fontSize(8);
    bankLines.forEach((s) => { doc.text(s, L, byy, { width: leftW - 70 }); byy = doc.y + 1.5; });
    if (qrBuf) { try { doc.image(qrBuf, L + leftW - 60, bankTop + 10, { fit: [56, 56] }); } catch (_) {} }
    // signatory
    doc.fillColor('#111').font(F.bold).fontSize(9).text('For ' + (biz.name || ''), rightX2, bankTop + 2, { width: rightW, align: 'center' });
    if (stampBuf) { try { doc.image(stampBuf, rightX2 + 30, bankTop + 16, { fit: [54, 44] }); } catch (_) {} }
    if (sigBuf) { try { doc.image(sigBuf, rightX2 + (stampBuf ? 96 : 60), bankTop + 18, { fit: [78, 40] }); } catch (_) {} }
    doc.fillColor('#111').font(F.bold).fontSize(9).text(T.signatory, rightX2, bankTop + block3H - 14, { width: rightW, align: 'center' });
    y = bankTop + block3H;

    // declaration + footer note
    if (T.declaration) { doc.fillColor('#666').font(F.reg).fontSize(7.5).text(T.declaration, L, y, { width: W - 12 }); y = doc.y + 3; }
    if (T.footerNote) { doc.fillColor(P.accent).font(F.bold).fontSize(8).text(T.footerNote, L, y, { width: W - 12, align: 'center' }); }
  }

  // ---- render pages ----
  let running = 0;
  pages.forEach((pageRows, p) => {
    if (p > 0) doc.addPage();
    drawFrame();
    if (p === 0) drawFullHeader(); else drawCompactHeader();
    const headTop = headTopFor(p);
    drawColHeader(headTop);
    let y = headTop + colHeaderH;
    if (p > 0) { drawSpanRow(y, 'Brought Forward', running, broughtH); y += broughtH; }
    const tableTop = headTop;
    pageRows.forEach((r) => { y = drawRow(r, y); running += r.amt; });
    const isLast = p === totalPages - 1;
    const fillTo = isLast ? lastMaxY : contMaxY;
    let zi = pageRows.length ? (pageRows[pageRows.length - 1].i + 1) : 0;
    while (y + 16 <= fillTo) {
      if (zi % 2 === 1 && HEX(P.zebra) && P.zebra.toLowerCase() !== '#ffffff') doc.rect(L, y, W, 16).fill(P.zebra);
      y += 16; zi++;
    }
    if (!isLast) { drawSpanRow(y, 'Carried Forward', running, carryH); y += carryH; }
    drawColSeparators(headTop + colHeaderH, y);
    drawStrip(p);
    if (isLast) drawFinalFooter(y + 6);
  });
}

// ---------------------------------------------------------------------------
// E-Way Bill slip (printable summary)
// ---------------------------------------------------------------------------
router.get('/eway/:id', (req, res) => {
  const e = db.prepare('SELECT * FROM eway_bills WHERE id=?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'E-Way Bill not found' });
  const biz = (e.business_id && db.prepare('SELECT * FROM businesses WHERE id=?').get(e.business_id)) || {};
  const accent = '#0d5749';
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const F = setupFonts(doc); RS = F.rupee;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="EWB-${e.doc_no || e.id}.pdf"`);
  doc.pipe(res);

  doc.rect(0, 0, 595, 70).fill(accent);
  doc.fillColor('#fff').font(FB).fontSize(18).text('e-Way Bill', 40, 22);
  doc.font(FR).fontSize(10).fillColor('#e5e7eb').text(biz.name || '', 40, 46, { width: 400 });
  doc.fillColor('#fff').font(FB).fontSize(11).text(e.ewb_no ? 'EWB No: ' + e.ewb_no : 'Draft', 355, 30, { width: 200, align: 'right' });

  let y = 90;
  const box = (title, lines, x, w) => {
    doc.roundedRect(x, y, w, 118, 6).strokeColor('#cbd5e1').lineWidth(0.8).stroke();
    doc.fillColor(accent).font(FB).fontSize(9).text(title, x + 8, y + 8);
    doc.fillColor('#333').font(FR).fontSize(8.5);
    let ly = y + 22;
    lines.forEach((ln) => { if (ln) { doc.text(ln, x + 8, ly, { width: w - 16 }); ly = doc.y + 2; } });
  };
  box('1. E-Way Bill Details', [
    'Date: ' + (e.ewb_date || '-'),
    'Supply Type: ' + (e.supply_type === 'I' ? 'Inward' : 'Outward'),
    'Sub Type: ' + (e.sub_type || '-'),
    'Doc: ' + (e.doc_type || 'INV') + ' ' + (e.doc_no || '') + '  (' + (e.doc_date || '-') + ')',
    'Status: ' + String(e.status || 'draft').toUpperCase(),
  ], 40, 255);
  box('2. Transport Details', [
    'Transporter: ' + (e.transporter_name || '-'),
    'Trans. ID: ' + (e.transporter_id || '-'),
    'Mode: ' + (e.trans_mode || 'road') + '   Distance: ' + (e.trans_distance || 0) + ' km',
    'Vehicle: ' + (e.vehicle_no || '-') + '  (' + (e.vehicle_type === 'O' ? 'ODC' : 'Regular') + ')',
    'Trans Doc: ' + (e.trans_doc_no || '-') + '  ' + (e.trans_doc_date || ''),
  ], 305, 250);

  y += 130;
  box('3. From', [
    e.from_name || '-', 'GSTIN: ' + (e.from_gstin || 'URP'), e.from_addr || '',
    [e.from_place, e.from_pin].filter(Boolean).join(' - '), 'State: ' + (e.from_state || '-'),
  ], 40, 255);
  box('4. To', [
    e.to_name || '-', 'GSTIN: ' + (e.to_gstin || 'URP'), e.to_addr || '',
    [e.to_place, e.to_pin].filter(Boolean).join(' - '), 'State: ' + (e.to_state || '-'),
  ], 305, 250);

  y += 130;
  doc.roundedRect(40, y, 515, 60, 6).fill('#f8fafc');
  doc.fillColor(accent).font(FB).fontSize(9).text('5. Value Details', 48, y + 8);
  doc.fillColor('#333').font(FR).fontSize(9);
  doc.text('Taxable: ' + rupee(e.taxable_value), 48, y + 24);
  doc.text('CGST: ' + rupee(e.cgst), 220, y + 24);
  doc.text('SGST: ' + rupee(e.sgst), 340, y + 24);
  doc.text('IGST: ' + rupee(e.igst), 460, y + 24);
  doc.font(FB).fontSize(11).fillColor(accent).text('Total Invoice Value: ' + rupee(e.total_value), 48, y + 40, { width: 500, align: 'right' });

  doc.font(FR).fontSize(8).fillColor('#888').text('This is a system-generated e-Way Bill slip. Enter the EWB number after generating on the GST portal.', 40, y + 80, { width: 515 });
  doc.end();
});

// Generate an invoice PDF into an in-memory Buffer (used by WhatsApp sending,
// email, etc.). Resolves to { buffer, inv, biz } or null if the invoice is gone.
function invoicePdfBuffer(id, format) {
  const bundle = loadInvoice(id);
  if (!bundle) return Promise.resolve(null);
  const { inv, biz } = bundle;
  return resolveQr(biz, inv).then((qrBuf) => new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 36 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), inv, biz }));
      doc.on('error', reject);
      renderInvoiceDoc(doc, inv, biz, qrBuf, format || biz.bill_format);
      doc.end();
    } catch (e) { reject(e); }
  }));
}

module.exports = router;
module.exports.invoicePdfBuffer = invoicePdfBuffer;
module.exports.loadInvoice = loadInvoice;
module.exports.renderInvoiceDoc = renderInvoiceDoc;
