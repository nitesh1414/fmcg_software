// GST state-code resolution + inter/intra-state (CGST/SGST vs IGST) detection.
// Client mirror of server/gstState.js — used by the Sales/Purchase voucher so
// the live totals show IGST (different state) vs CGST + SGST (same state).
//
// A supply's nature is decided by the SUPPLIER's (business) state vs the
// recipient's (customer/supplier) state. Authoritative = the 2-digit GST state
// code in a GSTIN's first two characters; otherwise the state-name → code map.

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

// Resolve the 2-digit GST state code from a GSTIN or a state name.
export function stateCode(stateName, gstin) {
  const g = String(gstin || '').trim();
  if (/^\d{2}/.test(g)) return g.slice(0, 2);
  const raw = String(stateName || '').trim();
  if (!raw) return '';
  const low = raw.toLowerCase();
  if (STATE_CODES[low]) return STATE_CODES[low];
  const m = raw.match(/\b(0[1-9]|1[0-9]|2[0-9]|3[0-8]|97)\b/);
  return m ? m[1] : '';
}

// The business (supplier/home) state code.
export function homeStateCode(biz) {
  if (!biz) return '';
  return stateCode(biz.state, biz.gstin) || String(biz.state_code || '').trim();
}

// The recipient (place-of-supply) state code from a party object.
export function partyStateCode(party) {
  if (!party) return '';
  return stateCode(party.state, party.gstin);
}

// TRUE = inter-state supply → IGST. FALSE = intra-state → CGST + SGST.
// `biz` = active business profile; `party` = selected customer/supplier (may be null for walk-in).
export function isInterState(biz, party) {
  if (!biz) return false;
  const home = homeStateCode(biz);
  const other = partyStateCode(party);
  if (home && other) return home !== other;
  // Fallback: state-name comparison when codes can't be resolved.
  const h = String(biz.state || '').trim().toLowerCase();
  const o = String((party && party.state) || '').trim().toLowerCase();
  return !!(h && o && h !== o);
}
