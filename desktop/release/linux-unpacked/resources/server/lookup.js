// HSN suggestion + GSTIN decode/verify.
// Works fully OFFLINE (bundled HSN list + GSTIN checksum/state decode) and,
// when internet + an API key are configured, ENRICHES with live data.
const fs = require('fs');
const path = require('path');
const db = require('./db');

// ---- Bundled HSN dataset ----
let HSN = [];
try { HSN = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'hsn.json'), 'utf8')); }
catch (_) { HSN = []; }

// GST state code -> state name
const STATE_BY_CODE = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '25': 'Daman and Diu', '26': 'Dadra and Nagar Haveli', '27': 'Maharashtra', '29': 'Karnataka',
  '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
  '97': 'Other Territory', '99': 'Centre Jurisdiction',
};

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

// Validate the 15th GSTIN check digit (mod-36 algorithm used by GSTN).
function isValidGstinChecksum(gstin) {
  const code = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const factor = 36;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = code.indexOf(gstin[i]);
    if (v < 0) return false;
    const f = (i % 2) === 0 ? 1 : 2;
    let p = v * f;
    p = Math.floor(p / factor) + (p % factor);
    sum += p;
  }
  const checkVal = (factor - (sum % factor)) % factor;
  return code[checkVal] === gstin[14];
}

// PAN-holder type from the 4th character of the PAN (chars 6 of GSTIN).
const PAN_ENTITY = {
  P: 'Individual / Proprietor', C: 'Company', H: 'Hindu Undivided Family (HUF)',
  F: 'Partnership Firm / LLP', A: 'Association of Persons (AOP)', T: 'Trust',
  B: 'Body of Individuals', L: 'Local Authority', J: 'Artificial Juridical Person',
  G: 'Government',
};

// Offline decode of everything a GSTIN structurally tells us.
function decodeGstin(raw) {
  const gstin = String(raw || '').trim().toUpperCase();
  const valid = GSTIN_RE.test(gstin);
  const checksumOk = valid && isValidGstinChecksum(gstin);
  const stateCode = gstin.slice(0, 2);
  const pan = gstin.slice(2, 12);
  return {
    gstin,
    formatValid: valid,
    checksumValid: checksumOk,
    valid: valid && checksumOk,
    stateCode,
    state: STATE_BY_CODE[stateCode] || '',
    pan: PAN_RE.test(pan) ? pan : '',
    entityType: PAN_ENTITY[pan?.[3]] || '',
    registrationNo: gstin.slice(12, 13), // entity registration count digit
  };
}

// ---- HSN suggestions (offline) ----
// Match by HSN prefix or description keyword. Returns up to `limit`.
function suggestHSN(query, limit = 12) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return HSN.slice(0, limit);
  const starts = [];
  const contains = [];
  for (const row of HSN) {
    const code = String(row.hsn).toLowerCase();
    const desc = row.desc.toLowerCase();
    if (code.startsWith(q)) starts.push(row);
    else if (desc.includes(q) || code.includes(q)) contains.push(row);
  }
  return [...starts, ...contains].slice(0, limit);
}

// Look up GST rate + description for an exact-ish HSN code.
function hsnInfo(code) {
  const c = String(code || '').trim();
  if (!c) return null;
  // exact, then longest prefix match (e.g. 30049011 -> 3004)
  let best = HSN.find((r) => String(r.hsn) === c);
  if (!best) {
    const cand = HSN.filter((r) => c.startsWith(String(r.hsn)) || String(r.hsn).startsWith(c))
      .sort((a, b) => String(b.hsn).length - String(a.hsn).length);
    best = cand[0];
  }
  return best || null;
}

// Online enrichment for a GSTIN via a configured provider.
// Provider is read from company.features.gstApi (url template + key). We do NOT
// hardcode a vendor; the user supplies their key (e.g. APISetu, GST portal
// resellers). The URL may contain {gstin} and {key} placeholders.
async function fetchGstinOnline(gstin) {
  let cfg = {};
  try {
    const row = db.prepare('SELECT features FROM company WHERE id=1').get();
    cfg = JSON.parse((row && row.features) || '{}');
  } catch (_) {}
  const tmpl = cfg.gstApiUrl;   // e.g. https://api.example.com/gstin/{gstin}
  const key = cfg.gstApiKey || '';
  const header = cfg.gstApiHeader || 'Authorization'; // header name for the key
  if (!tmpl) return null;       // no provider configured → offline only

  const url = tmpl.replace('{gstin}', encodeURIComponent(gstin)).replace('{key}', encodeURIComponent(key));
  const headers = { Accept: 'application/json' };
  if (key && !tmpl.includes('{key}')) headers[header] = key.startsWith('Bearer') ? key : key;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return { error: `Provider returned ${res.status}` };
    const data = await res.json();
    return normalizeGstinResponse(data);
  } catch (e) {
    clearTimeout(t);
    return { error: e.name === 'AbortError' ? 'Lookup timed out' : e.message };
  }
}

// Map common provider response shapes to our fields (best-effort).
function normalizeGstinResponse(d) {
  if (!d || typeof d !== 'object') return null;
  // dig into a nested data/result/taxpayerInfo object if present
  const o = d.data || d.result || d.taxpayerInfo || d.taxpayer || d;
  const pradr = o.pradr || o.principalAddress || {};
  const addr = pradr.addr || pradr.address || pradr;
  const addrStr =
    o.address ||
    (typeof addr === 'string' ? addr :
      [addr.bno, addr.bnm, addr.st, addr.loc, addr.dst, addr.stcd, addr.pncd]
        .filter(Boolean).join(', ')) || '';
  return {
    legalName: o.lgnm || o.legalName || o.name || '',
    tradeName: o.tradeNam || o.tradeName || o.tradenam || '',
    status: o.sts || o.status || '',
    registrationDate: o.rgdt || o.registrationDate || '',
    constitution: o.ctb || o.constitution || '',
    address: addrStr,
    state: o.stj || o.state || (addr && addr.stcd) || '',
    pincode: (addr && (addr.pncd || addr.pincode)) || '',
    raw: undefined,
  };
}

module.exports = {
  HSN, suggestHSN, hsnInfo,
  decodeGstin, fetchGstinOnline, isValidGstinChecksum, STATE_BY_CODE,
};
