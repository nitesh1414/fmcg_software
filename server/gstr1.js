// Builds GST portal–compatible GSTR-1 JSON + HSN summary from sales invoices.
// Format follows the GSTN offline-utility schema (b2b, b2cl, b2cs, hsn sections).
const db = require('./db');
const { toUQC } = require('./uqc');

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Configurable threshold (₹) for B2CL — read from company features (default 2.5L).
function getB2clThreshold() {
  try {
    const row = db.prepare('SELECT features FROM company WHERE id=1').get();
    const f = JSON.parse((row && row.features) || '{}');
    const t = Number(f.b2clThreshold);
    return t > 0 ? t : 250000;
  } catch (_) { return 250000; }
}

// State name -> GST state code (TIN). Used to derive POS when only name is stored.
const STATE_CODES = {
  'jammu and kashmir': '01', 'himachal pradesh': '02', 'punjab': '03', 'chandigarh': '04',
  'uttarakhand': '05', 'haryana': '06', 'delhi': '07', 'rajasthan': '08', 'uttar pradesh': '09',
  'bihar': '10', 'sikkim': '11', 'arunachal pradesh': '12', 'nagaland': '13', 'manipur': '14',
  'mizoram': '15', 'tripura': '16', 'meghalaya': '17', 'assam': '18', 'west bengal': '19',
  'jharkhand': '20', 'odisha': '21', 'chhattisgarh': '22', 'madhya pradesh': '23', 'gujarat': '24',
  'daman and diu': '25', 'dadra and nagar haveli': '26', 'maharashtra': '27', 'karnataka': '29',
  'goa': '30', 'lakshadweep': '31', 'kerala': '32', 'tamil nadu': '33', 'puducherry': '34',
  'andaman and nicobar islands': '35', 'telangana': '36', 'andhra pradesh': '37', 'ladakh': '38',
  'other territory': '97',
};

function stateCode(stateName, gstin) {
  if (gstin && /^\d{2}/.test(gstin)) return gstin.slice(0, 2);
  const key = (stateName || '').trim().toLowerCase();
  return STATE_CODES[key] || '';
}

// Convert a YYYY-MM (or YYYY-MM-DD) to GSTR filing period MMYYYY
function toFilingPeriod(ym) {
  const m = String(ym).match(/^(\d{4})-(\d{2})/);
  if (!m) return '';
  return m[2] + m[1];
}

// Date dd-mm-yyyy for GSTR JSON
function toGstDate(iso) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

/**
 * Gather sales data for a month (YYYY-MM) and build:
 *  - b2b: registered customers (have GSTIN), per invoice, per tax-rate item group
 *  - b2cs: consolidated B2C, rate + POS wise
 *  - hsn: HSN-wise summary
 * Returns { json, hsn, summary } where json is the uploadable GSTR-1 object.
 */
function buildGstr1(month, businessId) {
  const company = (businessId
    ? db.prepare('SELECT gstin, state, state_code FROM businesses WHERE id=?').get(businessId)
    : db.prepare('SELECT gstin, state, state_code FROM businesses WHERE is_default=1').get()) || {};
  const homeCode = company.state_code || stateCode(company.state, company.gstin) || '';
  const B2CL_THRESHOLD = getB2clThreshold();
  const from = `${month}-01`;
  const [y, mo] = month.split('-').map(Number);
  const lastDay = new Date(y, mo, 0).getDate();
  const to = `${month}-${String(lastDay).padStart(2, '0')}`;

  const bizFilter = businessId ? ' AND inv.business_id=@bid' : '';
  const invoices = db.prepare(
    `SELECT inv.id, inv.invoice_no, inv.date, inv.total, inv.note_kind, inv.ref_invoice_no, inv.ref_invoice_date,
            p.name AS party_name, p.gstin AS party_gstin, p.state AS party_state
     FROM invoices inv LEFT JOIN parties p ON p.id=inv.party_id
     WHERE inv.type='sale' AND inv.date>=@from AND inv.date<=@to${bizFilter}
     ORDER BY inv.date, inv.id`
  ).all({ from, to, bid: businessId });

  // Join items so each line carries its unit (for UQC mapping)
  const itemsStmt = db.prepare(
    `SELECT ii.*, i.unit AS item_unit
     FROM invoice_items ii LEFT JOIN items i ON i.id = ii.item_id
     WHERE ii.invoice_id = ?`
  );

  const b2bByCtin = {};   // gstin -> array of inv objects
  const b2clByPos = {};   // pos -> array of inv objects (large inter-state B2C)
  const b2csMap = {};     // key rt|pos|sply -> aggregate
  const hsnMap = {};      // hsn|rt|uqc -> aggregate
  const cdnrByCtin = {};  // gstin -> array of note objects (registered)
  const cdnurList = [];   // unregistered large notes (inter-state)
  const nilAgg = { inter_gt: 0, intra_gt: 0, inter_nil: 0, intra_nil: 0 }; // nil/exempt/non-gst

  for (const inv of invoices) {
    const items = itemsStmt.all(inv.id);
    const pos = stateCode(inv.party_state, inv.party_gstin) || homeCode;
    const interState = pos && homeCode && pos !== homeCode;
    const isNote = inv.note_kind === 'credit' || inv.note_kind === 'debit';

    // group invoice items by gst rate; track nil/exempt amounts (rate 0)
    const rateGroups = {};
    for (const it of items) {
      const rt = Number(it.gst_rate) || 0;
      if (!rateGroups[rt]) rateGroups[rt] = { txval: 0, tax: 0 };
      rateGroups[rt].txval += it.taxable;
      rateGroups[rt].tax += it.tax_amount;

      // NIL/Exempt accumulation (0% lines) — notes excluded from Table 8
      if (rt === 0 && !isNote) {
        if (interState) nilAgg.inter_nil += it.taxable;
        else nilAgg.intra_nil += it.taxable;
      }

      // HSN summary accumulation (UQC from item unit). Notes reduce HSN totals.
      const sign = isNote && inv.note_kind === 'credit' ? -1 : 1;
      const uqc = toUQC(it.item_unit);
      const hsnKey = (it.hsn || 'NA') + '|' + rt + '|' + uqc;
      if (!hsnMap[hsnKey]) hsnMap[hsnKey] = { hsn_sc: it.hsn || '', desc: it.item_name, uqc, rt, qty: 0, txval: 0, iamt: 0, camt: 0, samt: 0 };
      const h = hsnMap[hsnKey];
      h.qty += (Number(it.qty) || 0) * sign;
      h.txval += it.taxable * sign;
      if (interState) h.iamt += it.tax_amount * sign;
      else { h.camt += (it.tax_amount / 2) * sign; h.samt += (it.tax_amount / 2) * sign; }
    }

    // Build rate-wise item details (shared by B2B / B2CL / CDNR)
    const buildItms = () => Object.entries(rateGroups).map(([rt, g], i) => {
      const rate = Number(rt);
      const det = { txval: r2(g.txval), rt: rate, csamt: 0 };
      if (interState) det.iamt = r2(g.tax);
      else { det.camt = r2(g.tax / 2); det.samt = r2(g.tax / 2); }
      return { num: i + 1, itm_det: det };
    });

    if (isNote) {
      // ---- Credit/Debit notes (Table 9) ----
      const ntty = inv.note_kind === 'credit' ? 'C' : 'D';
      const noteObj = {
        nt_num: inv.invoice_no,
        nt_dt: toGstDate(inv.date),
        ntty,
        val: r2(inv.total),
        itms: buildItms(),
      };
      if (inv.party_gstin) {
        // CDNR — note against a registered party
        noteObj.pos = pos;
        noteObj.rchrg = 'N';
        noteObj.inv_typ = 'R';
        if (inv.ref_invoice_no) { noteObj.oinum = inv.ref_invoice_no; noteObj.oidt = toGstDate(inv.ref_invoice_date || inv.date); }
        if (!cdnrByCtin[inv.party_gstin]) cdnrByCtin[inv.party_gstin] = [];
        cdnrByCtin[inv.party_gstin].push(noteObj);
      } else if (interState && r2(inv.total) > B2CL_THRESHOLD) {
        // CDNUR — note against unregistered (large inter-state)
        cdnurList.push({
          typ: 'B2CL',
          nt_num: inv.invoice_no,
          nt_dt: toGstDate(inv.date),
          ntty,
          val: r2(inv.total),
          pos,
          itms: buildItms(),
          ...(inv.ref_invoice_no ? { oinum: inv.ref_invoice_no, oidt: toGstDate(inv.ref_invoice_date || inv.date) } : {}),
        });
      }
      // small unregistered notes are netted into B2CS via HSN/again below — skip explicit section
      continue;
    }

    if (inv.party_gstin) {
      // B2B (registered customer)
      const invObj = {
        inum: inv.invoice_no,
        idt: toGstDate(inv.date),
        val: r2(inv.total),
        pos,
        rchrg: 'N',
        inv_typ: 'R',
        itms: buildItms(),
      };
      if (!b2bByCtin[inv.party_gstin]) b2bByCtin[inv.party_gstin] = [];
      b2bByCtin[inv.party_gstin].push(invObj);
    } else if (interState && r2(inv.total) > B2CL_THRESHOLD) {
      // B2CL — large inter-state B2C, reported invoice-wise
      const invObj = {
        inum: inv.invoice_no,
        idt: toGstDate(inv.date),
        val: r2(inv.total),
        itms: buildItms(),
      };
      if (!b2clByPos[pos]) b2clByPos[pos] = [];
      b2clByPos[pos].push(invObj);
    } else {
      // B2C (small) — consolidated rate + pos wise (only taxable rates)
      for (const [rt, g] of Object.entries(rateGroups)) {
        const rate = Number(rt);
        if (rate === 0) continue; // 0% handled in NIL section
        const key = `${rate}|${pos}|${interState ? 'INTER' : 'INTRA'}`;
        if (!b2csMap[key]) b2csMap[key] = { sply_ty: interState ? 'INTER' : 'INTRA', rt: rate, pos, typ: 'OE', txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 };
        const b = b2csMap[key];
        b.txval += g.txval;
        if (interState) b.iamt += g.tax;
        else { b.camt += g.tax / 2; b.samt += g.tax / 2; }
      }
    }
  }

  // Assemble JSON sections
  const b2b = Object.entries(b2bByCtin).map(([ctin, inv]) => ({ ctin, inv }));
  const b2cl = Object.entries(b2clByPos).map(([pos, inv]) => ({ pos, inv }));
  const b2cs = Object.values(b2csMap).map((b) => {
    const o = { sply_ty: b.sply_ty, rt: b.rt, typ: b.typ, pos: b.pos, txval: r2(b.txval) };
    if (b.sply_ty === 'INTER') o.iamt = r2(b.iamt);
    else { o.camt = r2(b.camt); o.samt = r2(b.samt); }
    o.csamt = 0;
    return o;
  });
  const cdnr = Object.entries(cdnrByCtin).map(([ctin, nt]) => ({ ctin, nt }));

  // NIL / Exempt / Non-GST (Table 8) — single inv array per GSTN schema
  const nilInv = [];
  if (nilAgg.inter_nil > 0) nilInv.push({ sply_ty: 'INTRB2C', expt_amt: r2(nilAgg.inter_nil), nil_amt: 0, ngsup_amt: 0 });
  if (nilAgg.intra_nil > 0) nilInv.push({ sply_ty: 'INTRAB2C', expt_amt: r2(nilAgg.intra_nil), nil_amt: 0, ngsup_amt: 0 });

  const hsnData = Object.values(hsnMap)
    .filter((h) => Math.abs(h.txval) > 0.001 || Math.abs(h.qty) > 0.001)
    .map((h, i) => ({
      num: i + 1,
      hsn_sc: h.hsn_sc,
      desc: (h.desc || '').slice(0, 30),
      uqc: h.uqc || 'OTH',
      qty: r2(h.qty),
      txval: r2(h.txval),
      iamt: r2(h.iamt),
      camt: r2(h.camt),
      samt: r2(h.samt),
      csamt: 0,
      rt: h.rt,
    }));

  const json = {
    gstin: company.gstin || '',
    fp: toFilingPeriod(month),
    version: 'GST3.1.6',
    hash: 'hash',
    b2b,
    b2cl,
    b2cs,
    cdnr,
    cdnur: cdnurList,
    nil: { inv: nilInv },
    hsn: { data: hsnData },
  };

  const summary = {
    period: month,
    fp: toFilingPeriod(month),
    invoiceCount: invoices.length,
    b2bCount: b2b.reduce((a, c) => a + c.inv.length, 0),
    b2clCount: b2cl.reduce((a, c) => a + c.inv.length, 0),
    b2csCount: b2cs.length,
    cdnrCount: cdnr.reduce((a, c) => a + c.nt.length, 0),
    cdnurCount: cdnurList.length,
    nilCount: nilInv.length,
    hsnCount: hsnData.length,
    b2clThreshold: B2CL_THRESHOLD,
    gstinPresent: !!company.gstin,
  };

  return { json, hsn: hsnData, summary };
}

module.exports = { buildGstr1, stateCode, toFilingPeriod };
