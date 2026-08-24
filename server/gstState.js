// GST state-code resolution + inter/intra-state (CGST/SGST vs IGST) detection.
// Shared by the PDF bill printer, reports and e-Way bill slip so every surface
// agrees on whether a supply is intra-state (CGST + SGST) or inter-state (IGST).
//
// A supply's nature is decided by the SUPPLIER's (business) state vs the PLACE
// OF SUPPLY (recipient's state). The authoritative source is the 2-digit GST
// state code embedded in a GSTIN (its first two characters); when a GSTIN isn't
// available we fall back to the state name → code map below.

// State name -> GST state code (TIN). Mirrors gstr1.STATE_CODES.
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

// Resolve the 2-digit GST state code from a GSTIN (first two digits) or, failing
// that, from a state name (handles "Maharashtra", "27-Maharashtra", "(27)" etc).
function stateCode(stateName, gstin) {
  const g = String(gstin || '').trim();
  if (/^\d{2}/.test(g)) return g.slice(0, 2);
  const raw = String(stateName || '').trim();
  if (!raw) return '';
  const low = raw.toLowerCase();
  if (STATE_CODES[low]) return STATE_CODES[low];
  // "27-Maharashtra", "Maharashtra-27", "Maharashtra (27)" style entries.
  const m = raw.match(/\b(0[1-9]|1[0-9]|2[0-9]|3[0-8]|97)\b/);
  return m ? m[1] : '';
}

// The home (supplier/business) state code.
function homeStateCode(biz) {
  if (!biz) return '';
  return stateCode(biz.state, biz.gstin) || (String(biz.state_code || '').trim());
}

// The place-of-supply state for an invoice:
//   explicit place_of_supply  →  consignee (ship-to)  →  buyer (party)
function posInfo(inv) {
  if (!inv) return { state: '', gstin: '' };
  const pos = String(inv.place_of_supply || '').trim();
  if (pos) return { state: pos, gstin: '' };
  const con = String(inv.consignee_state || '').trim();
  if (con) return { state: con, gstin: inv.consignee_gstin || '' };
  return { state: inv.party_state || '', gstin: inv.party_gstin || '' };
}

// The place-of-supply state code for an invoice.
function posStateCode(inv) {
  const p = posInfo(inv);
  return stateCode(p.state, p.gstin);
}

// TRUE = inter-state supply → IGST applies. FALSE = intra-state → CGST + SGST.
function interState(biz, inv) {
  const home = homeStateCode(biz);
  const other = posStateCode(inv);
  if (home && other) return home !== other;
  // Fallback: plain state-name comparison when codes can't be resolved.
  const h = String((biz && biz.state) || '').trim().toLowerCase();
  const p = posInfo(inv);
  const o = String(p.state || '').trim().toLowerCase();
  return !!(h && o && h !== o);
}

module.exports = { STATE_CODES, stateCode, homeStateCode, posStateCode, posInfo, interState };
