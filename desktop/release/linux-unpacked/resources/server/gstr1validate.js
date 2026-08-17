// Lightweight GSTR-1 JSON validator. Checks the GSTN offline-utility schema
// rules that commonly cause portal upload rejections, returning errors/warnings.
const { isValidUQC } = require('./uqc');

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const DATE_RE = /^\d{2}-\d{2}-\d{4}$/;
const FP_RE = /^\d{6}$/;
const VALID_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28];

function validateGstr1(json) {
  const errors = [];
  const warnings = [];
  const E = (m) => errors.push(m);
  const W = (m) => warnings.push(m);

  if (!json || typeof json !== 'object') { return { ok: false, errors: ['Empty JSON'], warnings: [] }; }

  if (!GSTIN_RE.test(json.gstin || '')) E(`Invalid supplier GSTIN "${json.gstin || ''}" (must be 15-char GSTIN).`);
  if (!FP_RE.test(json.fp || '')) E(`Invalid filing period fp "${json.fp || ''}" (must be MMYYYY).`);
  if (!json.version) W('Missing "version" field.');

  const checkRate = (rt, ctx) => {
    if (!VALID_RATES.includes(Number(rt))) W(`${ctx}: unusual GST rate ${rt}% (not a standard slab).`);
  };

  // B2B
  (json.b2b || []).forEach((g, gi) => {
    if (!GSTIN_RE.test(g.ctin || '')) E(`b2b[${gi}]: invalid customer GSTIN "${g.ctin || ''}".`);
    (g.inv || []).forEach((inv, ii) => {
      const ctx = `b2b[${gi}].inv[${ii}] (${inv.inum || '?'})`;
      if (!inv.inum) E(`${ctx}: missing invoice number.`);
      if (!DATE_RE.test(inv.idt || '')) E(`${ctx}: invalid date "${inv.idt}" (dd-mm-yyyy).`);
      if (!(Number(inv.val) >= 0)) E(`${ctx}: invalid invoice value.`);
      if (!/^\d{2}$/.test(String(inv.pos || ''))) E(`${ctx}: invalid POS state code "${inv.pos}".`);
      if (!Array.isArray(inv.itms) || inv.itms.length === 0) E(`${ctx}: no line items.`);
      (inv.itms || []).forEach((it) => {
        const d = it.itm_det || {};
        checkRate(d.rt, ctx);
        const hasIgst = d.iamt != null;
        const hasCS = d.camt != null || d.samt != null;
        if (hasIgst && hasCS) E(`${ctx}: both IGST and CGST/SGST present (must be one).`);
        if (!hasIgst && !hasCS) E(`${ctx}: no tax amounts present.`);
      });
    });
  });

  // B2CL (large inter-state, invoice-wise)
  (json.b2cl || []).forEach((g, gi) => {
    if (!/^\d{2}$/.test(String(g.pos || ''))) E(`b2cl[${gi}]: invalid POS "${g.pos}".`);
    (g.inv || []).forEach((inv, ii) => {
      const ctx = `b2cl[${gi}].inv[${ii}] (${inv.inum || '?'})`;
      if (!inv.inum) E(`${ctx}: missing invoice number.`);
      if (!DATE_RE.test(inv.idt || '')) E(`${ctx}: invalid date.`);
      if (!(Number(inv.val) > 250000)) W(`${ctx}: B2CL value ${inv.val} should be > ₹2,50,000.`);
      (inv.itms || []).forEach((it) => {
        const d = it.itm_det || {};
        checkRate(d.rt, ctx);
        if (d.iamt == null) E(`${ctx}: B2CL is inter-state, IGST required.`);
      });
    });
  });

  // B2CS
  (json.b2cs || []).forEach((b, i) => {
    const ctx = `b2cs[${i}]`;
    if (!['INTER', 'INTRA'].includes(b.sply_ty)) E(`${ctx}: invalid sply_ty "${b.sply_ty}".`);
    if (!/^\d{2}$/.test(String(b.pos || ''))) E(`${ctx}: invalid POS "${b.pos}".`);
    checkRate(b.rt, ctx);
    if (b.sply_ty === 'INTER' && b.iamt == null) E(`${ctx}: inter-state needs IGST.`);
    if (b.sply_ty === 'INTRA' && (b.camt == null || b.samt == null)) E(`${ctx}: intra-state needs CGST & SGST.`);
  });

  // CDNR — credit/debit notes to registered parties
  (json.cdnr || []).forEach((g, gi) => {
    if (!GSTIN_RE.test(g.ctin || '')) E(`cdnr[${gi}]: invalid GSTIN "${g.ctin || ''}".`);
    (g.nt || []).forEach((nt, ni) => {
      const ctx = `cdnr[${gi}].nt[${ni}] (${nt.nt_num || '?'})`;
      if (!nt.nt_num) E(`${ctx}: missing note number.`);
      if (!DATE_RE.test(nt.nt_dt || '')) E(`${ctx}: invalid note date.`);
      if (!['C', 'D'].includes(nt.ntty)) E(`${ctx}: ntty must be C or D.`);
      if (!/^\d{2}$/.test(String(nt.pos || ''))) E(`${ctx}: invalid POS.`);
      if (!Array.isArray(nt.itms) || !nt.itms.length) E(`${ctx}: no items.`);
    });
  });

  // CDNUR — notes to unregistered (large inter-state)
  (json.cdnur || []).forEach((nt, i) => {
    const ctx = `cdnur[${i}] (${nt.nt_num || '?'})`;
    if (!nt.nt_num) E(`${ctx}: missing note number.`);
    if (!DATE_RE.test(nt.nt_dt || '')) E(`${ctx}: invalid note date.`);
    if (!['C', 'D'].includes(nt.ntty)) E(`${ctx}: ntty must be C or D.`);
    if (nt.typ !== 'B2CL') W(`${ctx}: CDNUR typ usually "B2CL".`);
    if (!/^\d{2}$/.test(String(nt.pos || ''))) E(`${ctx}: invalid POS.`);
  });

  // NIL / exempt / non-GST (Table 8)
  ((json.nil && json.nil.inv) || []).forEach((n, i) => {
    const ctx = `nil.inv[${i}]`;
    if (!['INTRB2B', 'INTRB2C', 'INTRAB2B', 'INTRAB2C'].includes(n.sply_ty)) E(`${ctx}: invalid sply_ty "${n.sply_ty}".`);
    const sum = (Number(n.expt_amt) || 0) + (Number(n.nil_amt) || 0) + (Number(n.ngsup_amt) || 0);
    if (sum <= 0) W(`${ctx}: all nil/exempt/non-gst amounts are zero.`);
  });

  // HSN
  const hsnData = (json.hsn && json.hsn.data) || [];
  hsnData.forEach((h, i) => {
    const ctx = `hsn[${i}] (${h.hsn_sc || '?'})`;
    if (!h.hsn_sc) W(`${ctx}: missing HSN code.`);
    else if (!/^\d{4,8}$/.test(String(h.hsn_sc))) W(`${ctx}: HSN "${h.hsn_sc}" should be 4–8 digits.`);
    if (!isValidUQC(h.uqc)) E(`${ctx}: invalid UQC "${h.uqc}".`);
    if (typeof h.txval !== 'number' || Number.isNaN(h.txval)) E(`${ctx}: invalid taxable value.`);
    // Net taxable can be negative in a period where credit notes exceed sales.
    else if (Number(h.txval) < 0) W(`${ctx}: negative net taxable (credit notes exceed sales this period).`);
  });
  if (hsnData.length === 0) W('HSN summary (Table 12) is empty.');

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    counts: {
      b2b: (json.b2b || []).reduce((a, g) => a + (g.inv || []).length, 0),
      b2cl: (json.b2cl || []).reduce((a, g) => a + (g.inv || []).length, 0),
      b2cs: (json.b2cs || []).length,
      cdnr: (json.cdnr || []).reduce((a, g) => a + (g.nt || []).length, 0),
      cdnur: (json.cdnur || []).length,
      nil: ((json.nil && json.nil.inv) || []).length,
      hsn: hsnData.length,
    },
  };
}

module.exports = { validateGstr1 };
