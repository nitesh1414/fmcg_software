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

// Document kinds a sale can be printed as. Each keeps the SAME data but changes
// the title and whether it's a tax document. Passed via ?doc=<kind>.
const DOC_KINDS = {
  tax: { title: null, tax: true, copies: true },             // Tax Invoice (default; title from settings)
  challan: { title: 'DELIVERY CHALLAN', tax: false, copies: true },
  memo: { title: 'DELIVERY MEMO', tax: false, copies: true },
  proforma: { title: 'PROFORMA INVOICE', tax: true, copies: false }, // proforma isn't a legal tax doc; single copy
};

// The three statutory copies of a GST tax invoice (Rule 48).
const COPY_LABELS = ['ORIGINAL FOR RECIPIENT', 'DUPLICATE FOR TRANSPORTER', 'TRIPLICATE FOR SUPPLIER'];

function renderInvoiceDoc(doc, inv, biz, qrBuf, format, opts = {}) {
  const F = setupFonts(doc);
  RS = F.rupee;
  const fmt = resolveFormat(format, biz);
  const feat = companyFeatures();
  const dk = DOC_KINDS[opts.docKind] || DOC_KINDS.tax;
  // Triplicate only for real tax documents (challan/memo too), when enabled via
  // the F12 → Bill Format "Print 3 copies" toggle, and only for SALE invoices.
  // Config-driven & non-mandatory: default on, turn off to print a single copy.
  const wantCopies = dk.copies && (feat.billTriplicate !== false) && inv.type === 'sale';
  const copies = wantCopies ? COPY_LABELS : [dk.copies ? COPY_LABELS[0] : null];

  copies.forEach((copyLabel, i) => {
    if (i > 0) doc.addPage();
    // ALL formats now use the rich Tally-style boxed layout; the chosen format
    // only supplies the colour theme (header/table/total colours + border).
    renderTallyInvoice({ doc, inv, biz, qrBuf, F, fmt, copyLabel, docKind: dk });
  });
}


// ===========================================================================
// format4 — Tally-style e-Invoice (faithful boxed GST invoice)
// Replicates the classic Tally "Tax Invoice" layout: title bar, e-Invoice
// IRN/Ack + QR, boxed seller/consignee/buyer + meta grid, itemised table with
// tax lines, HSN/SAC tax-summary grid, amount-in-words, bank + declaration and
// signatory footer. Every content block is gated by an F12 → Bill Format flag.
// ===========================================================================
function renderTallyInvoice({ doc, inv, biz, qrBuf, F, fmt, copyLabel, docKind }) {
  F = F || setupFonts(doc); RS = F.rupee;
  const feat = companyFeatures();
  const on = (k, def = true) => (feat[k] === undefined ? def : !!feat[k]);
  const T = invoiceTexts(biz, inv);
  const terms = termsArray(biz);
  const dk = docKind || DOC_KINDS.tax;
  const showTax = dk.tax !== false;
  const inter = interState(biz, inv);
  const money = (n) => num2(n);
  const RUP = (n) => 'Rs. ' + num2(n);

  // Colour theme for the chosen format (header/table/total tints + border).
  const theme = THEMES[fmt] || THEMES.format4;
  const P = palette(biz, theme);
  const ink = '#000';
  const line = HEX(P.border) || '#000';
  const headBg = P.headerBg, headFg = P.headerFg;
  const tblBg = P.tableBg, tblFg = P.tableFg;
  const totBg = P.totalBg, totFg = P.totalFg;
  const accent = P.accent;
  const logoBuf = imageBuffer(biz.logo);
  const sigBuf = imageBuffer(biz.signature);
  const stampBuf = imageBuffer(biz.stamp);

  const M = 22, L = M, R = 595 - M, W = R - L;
  const PAGE_H = 842, BOT = PAGE_H - 24;
  doc.page.margins = { top: M, bottom: M, left: M, right: M };

  // thin box + line helpers
  const box = (x, y, w, h) => doc.rect(x, y, w, h).lineWidth(0.7).strokeColor(line).stroke();
  const hline = (x1, y, x2, lw = 0.7) => doc.moveTo(x1, y).lineTo(x2, y).lineWidth(lw).strokeColor(line).stroke();
  const vline = (x, y1, y2, lw = 0.7) => doc.moveTo(x, y1).lineTo(x, y2).lineWidth(lw).strokeColor(line).stroke();
  const fillRect = (x, y, w, h, col) => { if (col && col.toLowerCase() !== '#ffffff') doc.rect(x, y, w, h).fill(col); };
  const txt = (s, x, y, opts = {}) => { doc.fillColor(opts.color || ink).font(opts.bold ? F.bold : F.reg).fontSize(opts.size || 8).text(s == null ? '' : String(s), x, y, { lineBreak: false, ...opts }); };

  // amount shown per line = taxable value (pre-tax)
  const lineAmt = (it) => Number(it.taxable != null ? it.taxable : Number(it.qty) * Number(it.price)) || 0;
  // e-Invoice IRN band is only for actual IRN/Ack data. A payment/UPI QR must
  // not open this block (it is drawn in the bank/signatory footer instead).
  const eInvoice = showTax && on('billEInvoice') && !!(inv.irn || inv.ack_no);
  // The invoice title: doc-kind override wins (Challan/Memo/Proforma), else settings.
  const docTitle = dk.title || T.title || 'Tax Invoice';

  // ---------- TITLE BAR (themed band) ----------
  let y = M;
  const titleH = 22;
  fillRect(L, y, W, titleH, headBg);
  const titleColor = (headBg && headBg.toLowerCase() !== '#ffffff') ? headFg : accent;
  txt(docTitle, L, y + 5, { size: 13, bold: true, width: W, align: 'center', color: titleColor });
  if (eInvoice) txt('e-Invoice', R - 118, y + 6, { size: 9, bold: true, width: 112, align: 'right', color: titleColor });
  // copy label (Original / Duplicate / Triplicate) top-left inside the band
  if (copyLabel) txt('(' + copyLabel + ')', L + 6, y + 7, { size: 7, color: titleColor });
  box(L, y, W, titleH);
  y += titleH + 4;

  // ---------- e-Invoice IRN / Ack + QR (optional) ----------
  if (eInvoice) {
    const qrSz = 74;
    const boxTop = y;
    const rowH = 12;
    const labelX = L, valX = L + 62;
    txt('IRN', labelX, y, { size: 7.5 }); txt(': ' + (inv.irn || '—'), valX, y, { size: 7.5, bold: true, width: W - qrSz - 80 });
    y += (inv.irn && inv.irn.length > 40 ? rowH * 2 : rowH);
    txt('Ack No.', labelX, y, { size: 7.5 }); txt(': ' + (inv.ack_no || '—'), valX, y, { size: 7.5, bold: true }); y += rowH;
    txt('Ack Date', labelX, y, { size: 7.5 }); txt(': ' + (inv.ack_date ? fmtDate(inv.ack_date) : '—'), valX, y, { size: 7.5, bold: true }); y += rowH;
    if (qrBuf) {
      try {
        doc.rect(R - qrSz, boxTop, qrSz, qrSz).lineWidth(0.4).strokeColor(line).stroke();
        doc.image(qrBuf, R - qrSz + 2, boxTop + 2, { fit: [qrSz - 4, qrSz - 4], align: 'center', valign: 'center' });
      } catch (_) {}
    }
    y = Math.max(y, boxTop + qrSz) + 4;
  }

  // ---------- HEADER GRID: seller (left) | invoice meta (right) ----------
  const midX = L + Math.round(W * 0.52);
  const gridTop = y;
  // Seller block (left): logo sits in a fixed square; company name + address
  // share the remaining column so they never overlap the logo.
  const logoSize = 52, logoPad = 7;
  const sx = L + 6, sy = gridTop + 5;
  const textX = logoBuf ? (sx + logoSize + logoPad) : sx;
  const textW = Math.max(80, midX - textX - 6);
  if (logoBuf) { try { doc.image(logoBuf, sx, sy, { fit: [logoSize, logoSize], align: 'center', valign: 'center' }); } catch (_) {} }
  doc.fillColor(accent).font(F.bold).fontSize(11)
    .text(biz.name || 'My Company', textX, sy, { width: textW });
  let byy = doc.y + 1;
  doc.font(F.reg).fontSize(7.5);
  const sellerLines = [];
  if (biz.address) sellerLines.push(biz.address);
  if (on('billUdyam') && biz.udyam) sellerLines.push('UDYAM : ' + biz.udyam);
  if (on('billCIN') && biz.cin) sellerLines.push('CIN : ' + biz.cin);
  if (biz.gstin) sellerLines.push('GSTIN/UIN: ' + biz.gstin);
  if (biz.state) sellerLines.push('State Name : ' + biz.state + (biz.state_code ? ', Code : ' + biz.state_code : ''));
  if (biz.phone) sellerLines.push('Contact : ' + biz.phone);
  if (biz.email) sellerLines.push('E-Mail : ' + biz.email);
  sellerLines.forEach((s) => { doc.fillColor(ink).text(s, textX, byy, { width: textW }); byy = doc.y + 1; });
  byy = Math.max(byy, logoBuf ? sy + logoSize + 4 : byy);

  // Invoice meta (right) — 2-col mini grid of labeled cells
  const metaCells = [
    ['Invoice No.', inv.invoice_no, 'Dated', fmtDate(inv.date)],
  ];
  if (on('billEwayNo')) metaCells.push(['e-Way Bill No.', inv.eway_no || '', 'Mode/Terms of Payment', inv.pay_terms || '']);
  else metaCells.push(['Mode/Terms of Payment', inv.pay_terms || '', '', '']);
  if (on('billOrderRef')) {
    metaCells.push(["Buyer's Order No.", inv.po_no || inv.ref_invoice_no || '', 'Dated', inv.po_date || '']);
    metaCells.push(['Reference No. & Date', inv.ref_invoice_no || '', 'Other References', inv.other_ref || '']);
  }
  if (on('billDispatch')) {
    metaCells.push(['Delivery Note', inv.delivery_note || '', 'Delivery Note Date', inv.delivery_note_date ? fmtDate(inv.delivery_note_date) : '']);
    metaCells.push(['Dispatch Doc No.', inv.dispatch_doc || '', 'Dispatched through', inv.dispatched_through || '']);
    metaCells.push(['Destination', inv.destination || '', 'Terms of Delivery', inv.terms_delivery || '']);
  }
  const metaRowH = 22;
  let my = gridTop;
  const q1 = midX, q2 = midX + Math.round((R - midX) / 2);
  metaCells.forEach((cell) => {
    const [l1, v1, l2, v2] = cell;
    txt(l1, q1 + 4, my + 2, { size: 6.8, color: '#333' });
    txt(v1, q1 + 4, my + 10, { size: 8.5, bold: true, width: q2 - q1 - 6 });
    if (l2) {
      txt(l2, q2 + 4, my + 2, { size: 6.8, color: '#333' });
      txt(v2, q2 + 4, my + 10, { size: 8.5, bold: true, width: R - q2 - 6 });
      vline(q2, my, my + metaRowH, 0.4);
    }
    my += metaRowH;
    hline(midX, my, R, 0.4);
  });
  const metaBottom = my;

  // Consignee (Ship to) + Buyer (Bill to) stacked in the left column
  let cy = byy + 2;
  const drawParty = (label, name, addr, gstin, state, stateCode) => {
    hline(L, cy, midX, 0.4);
    txt(label, L + 6, cy + 2, { size: 7, color: '#333' });
    cy += 12;
    txt(name || 'Cash Sale', L + 6, cy, { size: 10, bold: true, width: midX - L - 12 });
    cy = doc.y + 1;
    doc.font(F.reg).fontSize(7.5).fillColor(ink);
    if (addr) { doc.text(addr, L + 6, cy, { width: midX - L - 12 }); cy = doc.y + 1; }
    if (gstin) { doc.text('GSTIN/UIN : ' + gstin, L + 6, cy, { width: midX - L - 12 }); cy = doc.y + 1; }
    if (state) { doc.text('State Name : ' + state + (stateCode ? ', Code : ' + stateCode : ''), L + 6, cy, { width: midX - L - 12 }); cy = doc.y + 1; }
    cy += 3;
  };
  const partyState = inv.party_state || '';
  const stCode = partyState ? gstStateCode(inv.party_gstin) : '';
  // Consignee = an explicit Ship-to when supplied on the voucher, else the buyer.
  if (on('billConsignee')) {
    const cName = inv.consignee_name || inv.party_name;
    const cAddr = inv.consignee_address || inv.party_address;
    const cGstin = inv.consignee_gstin || inv.party_gstin;
    const cState = inv.consignee_state || partyState;
    drawParty('Consignee (Ship to)', cName, cAddr, cGstin, cState, gstStateCode(cGstin));
  }
  drawParty('Buyer (Bill to)', inv.party_name, inv.party_address, inv.party_gstin, partyState, stCode);
  const pos = inv.place_of_supply || partyState;
  if (on('billPlaceOfSupply') && pos) { txt('Place of Supply : ' + pos, L + 6, cy, { size: 8, bold: true }); cy += 12; }

  const headBottom = Math.max(cy, metaBottom) + 2;
  // Frame the header grid
  box(L, gridTop, W, headBottom - gridTop);
  vline(midX, gridTop, headBottom);
  y = headBottom;

  // ---------- ITEMS TABLE ----------
  const dMode = discountMode(inv);
  const cols = [
    { k: 'sr', label: 'Sl\nNo.', w: 26, align: 'center' },
    { k: 'desc', label: 'Description of Goods', w: 0, align: 'left' },
    { k: 'hsn', label: 'HSN/SAC', w: 58, align: 'center' },
    { k: 'qty', label: 'Quantity', w: 58, align: 'right' },
    { k: 'rate', label: 'Rate', w: 54, align: 'right' },
    { k: 'per', label: 'per', w: 30, align: 'center' },
  ];
  if (dMode !== 'none') cols.push({ k: 'disc', label: 'Disc. %', w: 42, align: 'right' });
  cols.push({ k: 'amt', label: 'Amount', w: 74, align: 'right' });
  const fixedW = cols.filter((c) => c.k !== 'desc').reduce((a, c) => a + c.w, 0);
  cols.find((c) => c.k === 'desc').w = W - fixedW;
  let cx = L; cols.forEach((c) => { c.x = cx; cx += c.w; });
  const descW = cols.find((c) => c.k === 'desc').w - 8;

  const headH = 20;
  const drawColHead = (topY) => {
    fillRect(L, topY, W, headH, tblBg);
    const hfg = (tblBg && tblBg.toLowerCase() !== '#ffffff') ? tblFg : ink;
    cols.forEach((c) => { doc.fillColor(hfg).font(F.bold).fontSize(7.5).text(c.label, c.x + 3, topY + 4, { width: c.w - 6, align: c.align, lineBreak: true }); });
    hline(L, topY, R); hline(L, topY + headH, R);
    cols.forEach((c, i) => { if (i > 0) vline(c.x, topY, topY + headH); });
  };
  let tableTop = y;
  vline(L, tableTop, tableTop); // ensure colour
  box(L, tableTop, W, headH);
  drawColHead(tableTop);
  y = tableTop + headH;

  // Reserve space for the summary blocks so the table body has a min height.
  const rows = inv.items || [];
  const discCell = (it) => {
    const d = (Number(it.disc_trade_amt) || 0) + (Number(it.disc_cd_amt) || 0) + (Number(it.disc_sd_amt) || 0);
    if (dMode === 'pct') return (Number(it.discount) || 0) ? num2(it.discount) + '%' : '';
    if (d > 0 && lineAmt(it) + d > 0) return num2((d / (lineAmt(it) + d)) * 100) + '%';
    return '';
  };
  // ---- measure the T&C → bottom stack so the items table can grow into
  // leftover space (Tally style) instead of stretching an empty footer box.
  const measure = (font, size, text, width) => {
    if (!text) return 0;
    doc.font(font).fontSize(size);
    return doc.heightOfString(String(text), { width: Math.max(24, width) });
  };
  const grand = showTax ? inv.total : inv.subtotal;
  const showWords = on('billAmountWords');
  const showHsn = showTax && on('billHsnSummary');
  const showTaxWords = showHsn && on('billTaxWords');
  const hsnRows = showHsn ? hsnSummary(inv) : [];
  const wordsStr = amountInWords(grand);
  const wordsTextH = showWords ? Math.max(11, measure(F.bold, 8.5, wordsStr, W - 10)) : 0;
  const wordsBlockH = showWords ? (11 + wordsTextH + 5) : 0;
  const hsnHeadH = showHsn ? (inter ? 16 : 22) : 0;
  const hsnBlockH = showHsn ? (hsnHeadH + hsnRows.length * 13 + 14) : 0;
  const taxWordsStr = showTaxWords ? amountInWords(inv.tax_total) : '';
  const taxWordsTextH = showTaxWords ? Math.max(10, measure(F.bold, 8, taxWordsStr, W - 136)) : 0;
  const taxWordsBlockH = showTaxWords ? (Math.max(16, taxWordsTextH + 6)) : 0;

  const fMid = L + Math.round(W * 0.47);
  const leftInnerW = fMid - L - 10;
  const SIG_H = 68;
  const qrSize = 44;
  const showBank = on('billBankDetails') && !!(biz.bank_name || biz.bank_account || biz.upi_id || biz.account_holder);
  const showPayQr = !!qrBuf && (showBank || on('billBankDetails'));
  const qrReserve = showPayQr ? (qrSize + 14) : 0;
  const bankLabW = 72;
  const bankValX = fMid + 8 + bankLabW;
  const bankValW = Math.max(70, R - bankValX - 8 - qrReserve);
  const declaration = on('billDeclaration') ? (T.declaration || '') : '';
  const showPan = on('billPan') && !!biz.pan;
  const footerNote = T.footerNote || '';

  const bankRows = [];
  if (showBank) {
    if (biz.account_holder || biz.name) bankRows.push(['A/c Holder', biz.account_holder || biz.name]);
    if (biz.bank_name) bankRows.push(['Bank Name', biz.bank_name]);
    if (biz.bank_account) bankRows.push(['A/c No.', biz.bank_account]);
    if (biz.bank_branch) bankRows.push(['Branch', biz.bank_branch]);
    if (biz.bank_ifsc) bankRows.push(['IFSC', biz.bank_ifsc]);
    if (biz.upi_id) bankRows.push(['UPI', biz.upi_id]);
  }

  let leftNeed = 7;
  if (showPan) leftNeed += 12;
  if (declaration) leftNeed += 11 + measure(F.reg, 6.8, declaration, leftInnerW) + 3;
  if (terms.length) {
    leftNeed += 11;
    terms.forEach((t, i) => { leftNeed += measure(F.reg, 6.6, (i + 1) + '. ' + t, leftInnerW) + 1.4; });
  }
  leftNeed += 4;
  let rightNeed = 7;
  if (showBank) rightNeed += 12 + bankRows.length * 11;
  if (showPayQr) rightNeed = Math.max(rightNeed, 10 + qrSize + 14);
  rightNeed += 4;
  const contentH = Math.max(leftNeed, rightNeed, 40);
  const footerH = contentH + SIG_H;
  const cgH = on('billComputerGenerated') ? 12 : 0;
  const noteH = footerNote ? 12 : 0;
  const afterTableH = wordsBlockH + hsnBlockH + taxWordsBlockH + footerH + cgH + noteH + 2;

  const roundOff = Math.round(inv.total) - inv.total;
  const showRound = showTax && on('billRoundOff') && Math.abs(roundOff) >= 0.01;
  const taxLineCount = showTax ? ((inter ? 1 : 2) + (showRound ? 1 : 0)) : 0;
  const tableTailH = 4 + 14 + taxLineCount * 13 + 2 + 18;
  const minBottom = tableTailH + afterTableH;

  const startNewItemPage = () => {
    if (y > tableTop + headH) {
      cols.forEach((c, i) => { if (i > 0) vline(c.x, tableTop, y); });
      box(L, tableTop, W, y - tableTop);
    }
    doc.addPage();
    y = M;
    tableTop = y;
    box(L, y, W, headH);
    drawColHead(y);
    y += headH;
  };

  rows.forEach((r, i) => {
    const it = r;
    const desc = it._descText || '';
    doc.font(F.bold).fontSize(8.5);
    const nameH = doc.heightOfString(it.item_name || '', { width: descW });
    let dh = 0;
    if (desc) { doc.font(F.reg).fontSize(7); dh = doc.heightOfString(desc, { width: descW }); }
    const rowH = Math.max(15, nameH + dh + 6);
    const reservedLimit = BOT - minBottom;
    const itemsMaxY = (y < reservedLimit - 8) ? reservedLimit : (BOT - 28);
    if (y + rowH > itemsMaxY) startNewItemPage();
    txt(String(i + 1), cols[0].x, y + 3, { size: 8.5, width: cols[0].w, align: 'center' });
    doc.fillColor(ink).font(F.bold).fontSize(8.5).text(it.item_name || '', cols[1].x + 4, y + 3, { width: descW });
    if (desc) doc.font(F.reg).fontSize(7).fillColor('#333').text(desc, cols[1].x + 4, doc.y, { width: descW });
    txt(it.hsn || '', cols[2].x, y + 3, { size: 8, width: cols[2].w, align: 'center' });
    txt(num2(it.qty).replace(/\.00$/, '') + ' ' + (it.unit || ''), cols[3].x - 3, y + 3, { size: 8.5, bold: true, width: cols[3].w, align: 'right' });
    txt(num2(it.price), cols[4].x - 3, y + 3, { size: 8.5, width: cols[4].w, align: 'right' });
    txt(it.unit || '', cols[5].x, y + 3, { size: 8, width: cols[5].w, align: 'center' });
    const dcol = cols.find((c) => c.k === 'disc');
    if (dcol) txt(discCell(it), dcol.x - 3, y + 3, { size: 8, width: dcol.w, align: 'right' });
    const acol = cols.find((c) => c.k === 'amt');
    txt(num2(lineAmt(it)), acol.x - 3, y + 3, { size: 8.5, bold: true, width: acol.w, align: 'right' });
    y += rowH;
  });

  const acol = cols.find((c) => c.k === 'amt');
  const qtyCol = cols.find((c) => c.k === 'qty');
  const taxLabelX = cols[1].x + 4;
  const rate = inv.subtotal > 0 ? (inv.tax_total / inv.subtotal) * 100 : 0;
  const totRowH = 18;

  const drawTableTail = () => {
    y += 4;
    txt(num2(inv.subtotal), acol.x - 3, y, { size: 8.5, bold: true, width: acol.w, align: 'right' });
    y += 14;
    if (showTax) {
      if (inter) {
        doc.font(F.reg).fontSize(8.5).fillColor(ink).text('Output - IGST @ ' + num2(rate).replace(/\.00$/, '') + '%', taxLabelX, y, { width: descW, oblique: true });
        txt(num2(rate).replace(/\.00$/, '') + ' %', cols[5].x - 30, y, { size: 8, width: 60, align: 'right' });
        txt(num2(inv.tax_total), acol.x - 3, y, { size: 8.5, bold: true, width: acol.w, align: 'right' }); y += 13;
      } else {
        doc.font(F.reg).fontSize(8.5).fillColor(ink).text('Output - CGST @ ' + num2(rate / 2).replace(/\.00$/, '') + '%', taxLabelX, y, { width: descW });
        txt(num2(inv.tax_total / 2), acol.x - 3, y, { size: 8.5, bold: true, width: acol.w, align: 'right' }); y += 13;
        doc.font(F.reg).fontSize(8.5).fillColor(ink).text('Output - SGST @ ' + num2(rate / 2).replace(/\.00$/, '') + '%', taxLabelX, y, { width: descW });
        txt(num2(inv.tax_total / 2), acol.x - 3, y, { size: 8.5, bold: true, width: acol.w, align: 'right' }); y += 13;
      }
    }
    if (showRound) {
      doc.font(F.reg).fontSize(8.5).fillColor(ink).text('Round Off', taxLabelX, y, { width: descW });
      txt((roundOff > 0 ? '' : '(-)') + num2(Math.abs(roundOff)), acol.x - 3, y, { size: 8.5, width: acol.w, align: 'right' }); y += 13;
    }
    y += 2;
    hline(L, y, R);
    fillRect(L, y, W, totRowH, totBg);
    const tfg = (totBg && totBg.toLowerCase() !== '#ffffff') ? totFg : ink;
    const totQty = rows.reduce((s, it) => s + (Number(it.base_qty) || Number(it.qty) || 0), 0);
    txt('Total', cols[1].x + 4, y + 4, { size: 9, bold: true, color: tfg });
    txt(num2(totQty).replace(/\.00$/, '') + ' ' + (rows[0] ? (rows[0].unit || '') : ''), qtyCol.x - 3, y + 4, { size: 8.5, bold: true, width: qtyCol.w, align: 'right', color: tfg });
    txt(RUP(grand), acol.x - 40, y + 4, { size: 9.5, bold: true, width: acol.w + 40, align: 'right', color: tfg });
    y += totRowH;
    hline(L, y, R);
    cols.forEach((c, i) => { if (i > 0) vline(c.x, tableTop, y); });
    box(L, tableTop, W, y - tableTop);
  };

  // Grow the items table into leftover space so the T&C footer keeps a
  // content-sized height and sits at the bottom of the page.
  if (y + tableTailH + afterTableH <= BOT) {
    y += (BOT - tableTailH - afterTableH - y);
    drawTableTail();
  } else if (y + tableTailH <= BOT) {
    drawTableTail();
    doc.addPage();
    y = M;
  } else {
    startNewItemPage();
    if (y + tableTailH + afterTableH <= BOT) y += (BOT - tableTailH - afterTableH - y);
    drawTableTail();
  }

  // ---------- Amount chargeable in words ----------
  if (showWords) {
    txt('Amount Chargeable (in words)', L + 4, y + 3, { size: 7.5 });
    txt('E. & O.E', R - 60, y + 3, { size: 7.5, width: 56, align: 'right' });
    y += 12;
    doc.fillColor(ink).font(F.bold).fontSize(8.5).text(wordsStr, L + 4, y, { width: W - 8 });
    y += wordsTextH + 4;
    hline(L, y, R);
  }

  // ---------- HSN/SAC tax summary (tax documents only) ----------
  if (showHsn) {
    const hCols = inter
      ? [{ l: 'HSN/SAC', w: W - 300, a: 'left' }, { l: 'Taxable Value', w: 90, a: 'right' }, { l: 'Rate', w: 44, a: 'center' }, { l: 'IGST Amount', w: 82, a: 'right' }, { l: 'Total Tax', w: 84, a: 'right' }]
      : [{ l: 'HSN/SAC', w: W - 300, a: 'left' }, { l: 'Taxable Value', w: 78, a: 'right' }, { l: 'CGST', w: 78, a: 'right' }, { l: 'SGST', w: 78, a: 'right' }, { l: 'Total Tax', w: 68, a: 'right' }];
    let hx = L; hCols.forEach((c) => { c.x = hx; hx += c.w; });
    const hTop = y;
    hCols.forEach((c) => txt(c.l, c.x + 3, hTop + 3, { size: 7, bold: true, width: c.w - 6, align: c.a === 'left' ? 'left' : 'center' }));
    if (!inter) {
      txt('Rate  Amount', hCols[2].x + 3, hTop + 12, { size: 6, width: hCols[2].w - 6, align: 'center' });
      txt('Rate  Amount', hCols[3].x + 3, hTop + 12, { size: 6, width: hCols[3].w - 6, align: 'center' });
    }
    let hy = hTop + hsnHeadH; hline(L, hy, R, 0.4);
    hsnRows.forEach((h) => {
      txt(h.hsn, hCols[0].x + 3, hy + 2, { size: 7.5, width: hCols[0].w - 6 });
      txt(num2(h.taxable), hCols[1].x - 3, hy + 2, { size: 7.5, width: hCols[1].w, align: 'right' });
      if (inter) {
        txt(num2(h.rate).replace(/\.00$/, '') + '%', hCols[2].x, hy + 2, { size: 7.5, width: hCols[2].w, align: 'center' });
        txt(num2(h.tax), hCols[3].x - 3, hy + 2, { size: 7.5, width: hCols[3].w, align: 'right' });
        txt(num2(h.tax), hCols[4].x - 3, hy + 2, { size: 7.5, width: hCols[4].w, align: 'right' });
      } else {
        txt(num2(h.rate / 2).replace(/\.00$/, '') + '% ' + num2(h.tax / 2), hCols[2].x + 2, hy + 2, { size: 6.8, width: hCols[2].w - 4, align: 'right' });
        txt(num2(h.rate / 2).replace(/\.00$/, '') + '% ' + num2(h.tax / 2), hCols[3].x + 2, hy + 2, { size: 6.8, width: hCols[3].w - 4, align: 'right' });
        txt(num2(h.tax), hCols[4].x - 3, hy + 2, { size: 7.5, width: hCols[4].w, align: 'right' });
      }
      hy += 13;
    });
    hline(L, hy, R, 0.4);
    txt('Total', hCols[0].x + 3, hy + 2, { size: 7.5, bold: true });
    txt(num2(inv.subtotal), hCols[1].x - 3, hy + 2, { size: 7.5, bold: true, width: hCols[1].w, align: 'right' });
    txt(num2(inv.tax_total), hCols[hCols.length - 1].x - 3, hy + 2, { size: 7.5, bold: true, width: hCols[hCols.length - 1].w, align: 'right' });
    hy += 14;
    box(L, hTop, W, hy - hTop);
    hCols.forEach((c, i) => { if (i > 0) vline(c.x, hTop, hy); });
    y = hy;
    if (showTaxWords) {
      txt('Tax Amount (in words) : ', L + 4, y + 3, { size: 7.5 });
      doc.fillColor(ink).font(F.bold).fontSize(8).text(taxWordsStr, L + 128, y + 3, { width: W - 132 });
      y += taxWordsBlockH;
      hline(L, y, R);
    }
  }

  // ---------- Footer: PAN + declaration + terms | bank + QR, then signatory ----------
  // Content-sized (never stretched). Terms / bank / QR stay above the seal row.
  if (y + footerH + cgH + noteH > BOT + 0.5) { doc.addPage(); y = M; }
  const footTop = y;
  const footBottom = footTop + footerH;
  const sigTop = footBottom - SIG_H;
  const leftLimit = sigTop - 3;

  let fLy = footTop + 6;
  if (showPan) {
    txt("Company's PAN", L + 5, fLy, { size: 7.2, color: '#333' });
    txt(':  ' + biz.pan, L + 78, fLy, { size: 8, bold: true });
    fLy += 12;
  }
  if (declaration && fLy + 16 < leftLimit) {
    txt('Declaration', L + 5, fLy, { size: 7.4, bold: true });
    fLy += 10;
    const dH = measure(F.reg, 6.8, declaration, leftInnerW);
    if (fLy + dH <= leftLimit) {
      doc.font(F.reg).fontSize(6.8).fillColor(ink).text(declaration, L + 5, fLy, { width: leftInnerW });
      fLy = doc.y + 3;
    }
  }
  if (terms.length && fLy + 16 < leftLimit) {
    txt(T.termsHeading || 'Terms & Conditions', L + 5, fLy, { size: 7.4, bold: true });
    fLy += 10;
    doc.font(F.reg).fontSize(6.6).fillColor(ink);
    for (let i = 0; i < terms.length; i++) {
      const line = (i + 1) + '. ' + terms[i];
      const tH = measure(F.reg, 6.6, line, leftInnerW);
      if (fLy + tH > leftLimit) {
        if (fLy + 9 <= leftLimit) doc.font(F.reg).fontSize(6.6).fillColor('#555').text('…', L + 5, fLy, { width: leftInnerW });
        break;
      }
      doc.font(F.reg).fontSize(6.6).fillColor(ink).text(line, L + 5, fLy, { width: leftInnerW });
      fLy = doc.y + 1.4;
    }
  }

  let fRy = footTop + 6;
  if (showBank) {
    txt("Company's Bank Details", fMid + 6, fRy, { size: 7.4, bold: true });
    fRy += 12;
    bankRows.forEach(([lab, val]) => {
      if (fRy + 10 > leftLimit) return;
      txt(lab, fMid + 6, fRy, { size: 7.2, color: '#333', width: bankLabW });
      doc.fillColor(ink).font(F.bold).fontSize(7.3).text(':  ' + val, bankValX, fRy, { width: bankValW, lineBreak: false });
      fRy += 11;
    });
  }
  if (showPayQr) {
    try {
      const qrX = R - qrSize - 6;
      const qrY = footTop + 8;
      doc.roundedRect(qrX - 2, qrY - 2, qrSize + 4, qrSize + 4, 3).fill('#ffffff');
      doc.roundedRect(qrX - 2, qrY - 2, qrSize + 4, qrSize + 4, 3).lineWidth(0.45).strokeColor(line).stroke();
      doc.image(qrBuf, qrX, qrY, { fit: [qrSize, qrSize], align: 'center', valign: 'center' });
      txt('Scan to Pay', qrX - 2, qrY + qrSize + 2, { size: 6.4, width: qrSize + 4, align: 'center', color: '#555' });
    } catch (_) {}
  }

  // Signatory row — fixed height, never overlapped by terms / bank / QR.
  fillRect(L, sigTop, W, SIG_H, shade(accent, 0.94));
  hline(L, sigTop, R, 0.5);
  if (on('billCustomerSeal')) txt("Customer's Seal and Signature", L + 5, sigTop + 6, { size: 7.4 });
  const sigBoxX = fMid + 6, sigBoxW = R - fMid - 12;
  txt('for ' + (biz.name || ''), sigBoxX, sigTop + 5, { size: 8, bold: true, width: sigBoxW, align: 'right', color: accent });
  const hasStamp = !!stampBuf, hasSig = !!sigBuf;
  const imgTop = sigTop + 18, imgH = 34;
  const placeImg = (buf, x, w) => { try { doc.image(buf, x, imgTop, { fit: [w, imgH], align: 'center', valign: 'center' }); } catch (_) {} };
  if (hasStamp && hasSig) {
    const stampW = 48, sigW = 76, gap = 10;
    const startX = sigBoxX + Math.max(0, (sigBoxW - (stampW + gap + sigW)) / 2);
    placeImg(stampBuf, startX, stampW);
    placeImg(sigBuf, startX + stampW + gap, sigW);
  } else if (hasStamp) {
    const w = 54;
    placeImg(stampBuf, sigBoxX + (sigBoxW - w) / 2, w);
  } else if (hasSig) {
    const w = 88;
    placeImg(sigBuf, sigBoxX + (sigBoxW - w) / 2, w);
  }
  txt(T.signatory || 'Authorised Signatory', sigBoxX, sigTop + SIG_H - 13, { size: 7.6, width: sigBoxW, align: 'right' });

  box(L, footTop, W, footerH);
  vline(fMid, footTop, footBottom);
  y = footBottom;

  if (on('billComputerGenerated')) {
    txt('This is a Computer Generated Invoice', L, y + 3, { size: 7.2, width: W, align: 'center', color: '#555' });
    y += cgH;
  }
  if (footerNote) {
    txt(footerNote, L, y + 1, { size: 7.4, bold: true, width: W, align: 'center', color: accent });
  }
}

// Extract the 2-digit GST state code from a GSTIN (first two chars), else ''.
function gstStateCode(gstin) {
  const s = String(gstin || '').trim();
  return /^\d{2}/.test(s) ? s.slice(0, 2) : '';
}

router.get('/invoice/:id', async (req, res) => {
  const bundle = loadInvoice(req.params.id);
  if (!bundle) return res.status(404).json({ error: 'Invoice not found' });
  const { inv, biz } = bundle;
  const qrBuf = await resolveQr(biz, inv);

  const docKind = DOC_KINDS[req.query.doc] ? req.query.doc : 'tax';
  const suffix = docKind === 'challan' ? '-Challan' : docKind === 'memo' ? '-Memo' : docKind === 'proforma' ? '-Proforma' : '';
  const doc = new PDFDocument({ size: 'A4', margin: 36 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${inv.invoice_no}${suffix}.pdf"`);
  doc.pipe(res);
  renderInvoiceDoc(doc, inv, biz, qrBuf, req.query.format, { docKind });
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
  // Preview shows a single copy (no triplicate) using the selected theme.
  const F = setupFonts(doc); RS = F.rupee;
  const fmt = resolveFormat(req.query.format || biz.bill_format, biz);
  renderTallyInvoice({ doc, inv, biz, qrBuf, F, fmt, copyLabel: COPY_LABELS[0], docKind: DOC_KINDS.tax });
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
    : inv.type === 'quotation' ? 'QUOTATION'
    : (inv.type === 'purchase' ? 'PURCHASE BILL' : 'TAX INVOICE');
  const title = (inv.note_kind || inv.type === 'purchase' || inv.type === 'quotation') ? auto : ((biz.bill_title || '').trim() || 'TAX INVOICE');
  return {
    title,
    isQuote: inv.type === 'quotation',
    signatory: (biz.bill_signatory || '').trim() || 'Authorised Signatory',
    billTo: (biz.bill_billto_label || '').trim() || (inv.type === 'quotation' ? 'Quotation For' : inv.type === 'purchase' ? 'Supplier' : 'Bill To'),
    termsHeading: (biz.bill_terms_heading || '').trim() || 'Terms & Conditions',
    declaration: (biz.bill_declaration || '').trim() || 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
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
      doc.roundedRect(L + 10, M + 16, 56, 56, 6).fill('#ffffff');
      try { doc.image(logoBuf, L + 12, M + 18, { fit: [52, 52], align: 'center', valign: 'center' }); } catch (_) {}
      tx = L + 76;
    }
    doc.fillColor(P.headerFg).font(F.bold).fontSize(18).text(biz.name || '', tx, M + 16, { width: Math.max(160, W - 250 - (tx - L)) });
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
    if (logoBuf) { try { doc.image(logoBuf, L + 6, y + 6, { fit: [46, 46], align: 'center', valign: 'center' }); sx = L + 58; } catch (_) {} }
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
    if (logoBuf) { try { doc.image(logoBuf, L, M + 4, { fit: [48, 48], align: 'center', valign: 'center' }); tx = L + 58; } catch (_) {} }
    doc.fillColor(P.headerFg).font(F.bold).fontSize(18).text(biz.name || '', tx, M + 4, { width: 330 });
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
    mrow(T.isQuote ? 'Quotation No.' : 'Invoice No.', inv.invoice_no, my); my += 15;
    mrow('Date', fmtDate(inv.date), my); my += 15;
    if (inv.ref_invoice_no) { mrow('Ref No.', inv.ref_invoice_no, my); my += 15; }
    if (inv.po_no) { mrow('PO No.', inv.po_no, my); my += 15; }
    if (T.isQuote) mrow('Valid Until', inv.valid_until ? fmtDate(inv.valid_until) : '—', my);
    else mrow('Balance Due', money(inv.total - inv.paid), my);
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
    if (T.isQuote) {
      // Quotations don't carry payments; show validity instead.
      if (inv.valid_until) doc.fillColor('#444').font(F.reg).fontSize(8).text('Valid Until: ' + fmtDate(inv.valid_until), rightX2, tyR, { width: rightW, align: 'right' });
      doc.fillColor('#b45309').font(F.reg).fontSize(7.5).text('This is a quotation, not a tax invoice.', rightX2, tyR + 12, { width: rightW, align: 'right' });
    } else {
      doc.fillColor('#444').font(F.reg).fontSize(8).text('Received: ' + money(inv.paid), rightX2, tyR, { width: rightW, align: 'right' });
      doc.fillColor('#b91c1c').font(F.bold).fontSize(8.5).text('Balance Due: ' + money(inv.total - inv.paid), rightX2, tyR + 12, { width: rightW, align: 'right' });
    }

    y = topY + block1H;
    // In-words band
    doc.rect(L, y, W, wordsH).fill(shade(P.accent, 0.86));
    doc.fillColor('#111').font(F.bold).fontSize(8.5).text('Amount in Words: ', L + 6, y + 6, { continued: true }).font(F.reg).text(amountInWords(inv.total));
    y += wordsH + 4;

    // Bank + QR (left) | signatory (right)
    const bankTop = y;
    doc.fillColor(P.accent).font(F.bold).fontSize(8.5).text('Bank & Payment Details', L, y);
    const taxQr = qrBuf ? 62 : 0;
    let byy = y + 13; doc.fillColor('#333').font(F.reg).fontSize(8);
    bankLines.forEach((s) => { doc.text(s, L, byy, { width: leftW - taxQr - 10 }); byy = doc.y + 1.5; });
    if (qrBuf) {
      try {
        const qx = L + leftW - 58;
        doc.roundedRect(qx - 2, bankTop + 12, 56, 56, 3).lineWidth(0.4).strokeColor(P.border).stroke();
        doc.image(qrBuf, qx, bankTop + 14, { fit: [52, 52], align: 'center', valign: 'center' });
      } catch (_) {}
    }
    // signatory: company name on top, stamp+sig centred, label on the bottom
    doc.fillColor('#111').font(F.bold).fontSize(9).text('For ' + (biz.name || ''), rightX2, bankTop + 2, { width: rightW, align: 'center' });
    const tImgTop = bankTop + 18, tImgH = 38;
    if (stampBuf && sigBuf) {
      const sw = 50, gw = 10, sgw = 76;
      const sx0 = rightX2 + Math.max(0, (rightW - (sw + gw + sgw)) / 2);
      try { doc.image(stampBuf, sx0, tImgTop, { fit: [sw, tImgH], align: 'center', valign: 'center' }); } catch (_) {}
      try { doc.image(sigBuf, sx0 + sw + gw, tImgTop, { fit: [sgw, tImgH], align: 'center', valign: 'center' }); } catch (_) {}
    } else if (stampBuf) {
      try { doc.image(stampBuf, rightX2 + (rightW - 56) / 2, tImgTop, { fit: [56, tImgH], align: 'center', valign: 'center' }); } catch (_) {}
    } else if (sigBuf) {
      try { doc.image(sigBuf, rightX2 + (rightW - 88) / 2, tImgTop, { fit: [88, tImgH], align: 'center', valign: 'center' }); } catch (_) {}
    }
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
function invoicePdfBuffer(id, format, opts = {}) {
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
      renderInvoiceDoc(doc, inv, biz, qrBuf, format || biz.bill_format, opts);
      doc.end();
    } catch (e) { reject(e); }
  }));
}

module.exports = router;
module.exports.invoicePdfBuffer = invoicePdfBuffer;
module.exports.loadInvoice = loadInvoice;
module.exports.renderInvoiceDoc = renderInvoiceDoc;
module.exports.renderTallyInvoice = renderTallyInvoice;
module.exports.setupFonts = setupFonts;
module.exports.resolveFormat = resolveFormat;
module.exports.COPY_LABELS = COPY_LABELS;
module.exports.DOC_KINDS = DOC_KINDS;
