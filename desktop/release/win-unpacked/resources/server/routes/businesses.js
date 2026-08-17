const express = require('express');
const db = require('../db');
const { listBusinesses, getBusiness } = require('../business');
const router = express.Router();

// List active businesses (with per-business transaction counts, handy for UI).
// Strips the heavy base64 image fields; use GET /:id to fetch those. Adds a
// boolean flag so the UI can still show whether branding images exist.
router.get('/', (req, res) => {
  const rows = listBusinesses(req.query.all === '1');
  const out = rows.map((b) => {
    const { logo, signature, stamp, qr_image, ...rest } = b;
    rest.has_logo = !!logo;
    rest.has_signature = !!signature;
    rest.has_stamp = !!stamp;
    rest.has_qr = !!qr_image;
    rest.invoice_count = db.prepare('SELECT COUNT(*) c FROM invoices WHERE business_id=?').get(b.id).c;
    return rest;
  });
  res.json(out);
});

router.get('/:id', (req, res) => {
  const b = getBusiness(req.params.id);
  if (!b) return res.status(404).json({ error: 'Business not found' });
  res.json(b);
});

// Accept only image data URIs (png/jpeg/webp) up to ~2MB; anything else → ''.
function cleanImage(v, current) {
  if (v === undefined) return current ?? '';
  if (v === null || v === '') return '';
  const s = String(v);
  if (/^data:image\/(png|jpe?g|webp);base64,/.test(s) && s.length < 2_800_000) return s;
  return current ?? '';
}

const FORMATS = ['format1', 'format2', 'format3', 'format4', 'format5', 'format6',
  // Legacy aliases kept so old saved values still resolve.
  'classic', 'modern', 'compact', 'tally', 'vyapar', 'marg'];

const OPT_COLOR = (v, cur) => (/^#[0-9a-fA-F]{6}$/.test(v || '') ? v : (v === '' ? '' : (cur ?? '')));

// Normalise a terms list: accepts an array or a newline string → JSON array.
function cleanTermsList(v, current) {
  if (v === undefined) return current ?? '';
  let arr = [];
  if (Array.isArray(v)) arr = v;
  else if (typeof v === 'string' && v.trim()) {
    try { const p = JSON.parse(v); if (Array.isArray(p)) arr = p; else arr = v.split('\n'); }
    catch (_) { arr = v.split('\n'); }
  }
  arr = arr.map((s) => String(s).trim()).filter(Boolean).slice(0, 30);
  return JSON.stringify(arr);
}

function sanitize(b, current = {}) {
  const pick = (k, def = '') => (b[k] ?? current[k] ?? def);
  const pickColor = (k) => (b[k] !== undefined ? OPT_COLOR(b[k], current[k]) : (current[k] ?? ''));
  const txt = (k) => (b[k] !== undefined ? String(b[k]) : (current[k] ?? ''));
  return {
    name: (b.name ?? current.name ?? '').trim() || 'My Business',
    gstin: pick('gstin'),
    phone: pick('phone'),
    email: pick('email'),
    address: pick('address'),
    state: pick('state'),
    state_code: pick('state_code'),
    invoice_prefix: (b.invoice_prefix ?? current.invoice_prefix ?? 'INV') || 'INV',
    terms: b.terms ?? current.terms ?? 'Goods once sold will not be taken back.',
    fy_start_month: Number(b.fy_start_month) || current.fy_start_month || 4,
    logo: cleanImage(b.logo, current.logo),
    signature: cleanImage(b.signature, current.signature),
    stamp: cleanImage(b.stamp, current.stamp),
    // Bank / payment
    bank_name: pick('bank_name'),
    bank_account: pick('bank_account'),
    bank_ifsc: pick('bank_ifsc'),
    bank_branch: pick('bank_branch'),
    account_holder: pick('account_holder'),
    upi_id: pick('upi_id'),
    qr_image: cleanImage(b.qr_image, current.qr_image),
    bill_terms: pick('bill_terms'),
    bill_format: FORMATS.includes(b.bill_format) ? b.bill_format : (current.bill_format || 'format1'),
    bill_color: /^#[0-9a-fA-F]{6}$/.test(b.bill_color || '') ? b.bill_color : (current.bill_color || '#1e40af'),
    // Full colour palette (optional; '' = derive from bill_color).
    bill_header_bg: pickColor('bill_header_bg'),
    bill_header_fg: pickColor('bill_header_fg'),
    bill_table_bg: pickColor('bill_table_bg'),
    bill_table_fg: pickColor('bill_table_fg'),
    bill_total_bg: pickColor('bill_total_bg'),
    bill_total_fg: pickColor('bill_total_fg'),
    // Editable text labels.
    bill_title: txt('bill_title'),
    bill_signatory: txt('bill_signatory'),
    bill_billto_label: txt('bill_billto_label'),
    bill_terms_heading: txt('bill_terms_heading'),
    bill_declaration: txt('bill_declaration'),
    bill_footer_note: txt('bill_footer_note'),
    bill_terms_list: cleanTermsList(b.bill_terms_list, current.bill_terms_list),
  };
}

router.post('/', (req, res) => {
  const b = req.body || {};
  const s = sanitize(b);
  const makeDefault = b.is_default ? 1 : 0;
  const tx = db.transaction(() => {
    if (makeDefault) db.prepare('UPDATE businesses SET is_default=0').run();
    const info = db.prepare(
      `INSERT INTO businesses (name, gstin, phone, email, address, state, state_code, invoice_prefix, terms, fy_start_month,
        logo, signature, stamp, bank_name, bank_account, bank_ifsc, bank_branch, account_holder, upi_id, qr_image,
        bill_terms, bill_format, bill_color,
        bill_header_bg, bill_header_fg, bill_table_bg, bill_table_fg, bill_total_bg, bill_total_fg,
        bill_title, bill_signatory, bill_billto_label, bill_terms_heading, bill_declaration, bill_footer_note, bill_terms_list,
        is_default, active)
       VALUES (@name,@gstin,@phone,@email,@address,@state,@state_code,@invoice_prefix,@terms,@fy_start_month,
        @logo,@signature,@stamp,@bank_name,@bank_account,@bank_ifsc,@bank_branch,@account_holder,@upi_id,@qr_image,
        @bill_terms,@bill_format,@bill_color,
        @bill_header_bg,@bill_header_fg,@bill_table_bg,@bill_table_fg,@bill_total_bg,@bill_total_fg,
        @bill_title,@bill_signatory,@bill_billto_label,@bill_terms_heading,@bill_declaration,@bill_footer_note,@bill_terms_list,
        @is_default,1)`
    ).run({ ...s, is_default: makeDefault });
    return info.lastInsertRowid;
  });
  const id = tx();
  // Guarantee one default exists.
  ensureDefault();
  res.json(getBusiness(id));
});

router.put('/:id', (req, res) => {
  const current = getBusiness(req.params.id);
  if (!current) return res.status(404).json({ error: 'Business not found' });
  const b = req.body || {};
  const s = sanitize(b, current);
  const tx = db.transaction(() => {
    if (b.is_default) db.prepare('UPDATE businesses SET is_default=0').run();
    db.prepare(
      `UPDATE businesses SET name=@name, gstin=@gstin, phone=@phone, email=@email, address=@address,
        state=@state, state_code=@state_code, invoice_prefix=@invoice_prefix, terms=@terms,
        fy_start_month=@fy_start_month, logo=@logo, signature=@signature, stamp=@stamp,
        bank_name=@bank_name, bank_account=@bank_account, bank_ifsc=@bank_ifsc, bank_branch=@bank_branch,
        account_holder=@account_holder, upi_id=@upi_id, qr_image=@qr_image, bill_terms=@bill_terms,
        bill_format=@bill_format, bill_color=@bill_color,
        bill_header_bg=@bill_header_bg, bill_header_fg=@bill_header_fg, bill_table_bg=@bill_table_bg,
        bill_table_fg=@bill_table_fg, bill_total_bg=@bill_total_bg, bill_total_fg=@bill_total_fg,
        bill_title=@bill_title, bill_signatory=@bill_signatory, bill_billto_label=@bill_billto_label,
        bill_terms_heading=@bill_terms_heading, bill_declaration=@bill_declaration, bill_footer_note=@bill_footer_note,
        bill_terms_list=@bill_terms_list
        ${b.is_default ? ', is_default=1' : ''} WHERE id=@id`
    ).run({ ...s, id: req.params.id });
    // Allow (re)activating / deactivating via PUT too.
    if (b.active !== undefined) {
      db.prepare('UPDATE businesses SET active=? WHERE id=?').run(b.active ? 1 : 0, req.params.id);
    }
  });
  tx();
  ensureDefault();
  res.json(getBusiness(req.params.id));
});

// Set a business as the default.
router.post('/:id/default', (req, res) => {
  const b = getBusiness(req.params.id);
  if (!b || !b.active) return res.status(404).json({ error: 'Business not found' });
  const tx = db.transaction(() => {
    db.prepare('UPDATE businesses SET is_default=0').run();
    db.prepare('UPDATE businesses SET is_default=1 WHERE id=?').run(req.params.id);
  });
  tx();
  res.json(getBusiness(req.params.id));
});

// Soft-delete (deactivate). Refuses to remove the last active business.
router.delete('/:id', (req, res) => {
  const b = getBusiness(req.params.id);
  if (!b) return res.status(404).json({ error: 'Business not found' });
  const activeCount = db.prepare('SELECT COUNT(*) c FROM businesses WHERE active=1').get().c;
  if (activeCount <= 1) return res.status(400).json({ error: 'Cannot delete the only business. Create another first.' });
  db.prepare('UPDATE businesses SET active=0, is_default=0 WHERE id=?').run(req.params.id);
  ensureDefault();
  res.json({ ok: true });
});

function ensureDefault() {
  const has = db.prepare('SELECT 1 FROM businesses WHERE is_default=1 AND active=1').get();
  if (!has) {
    const first = db.prepare('SELECT id FROM businesses WHERE active=1 ORDER BY id LIMIT 1').get();
    if (first) db.prepare('UPDATE businesses SET is_default=1 WHERE id=?').run(first.id);
  }
}

module.exports = router;
