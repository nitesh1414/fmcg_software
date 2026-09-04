// Shared "shape a license row for the API/UI" helpers.
//
// A client can hold MORE THAN ONE live license: one per product (desktop,
// mobile). The first product they buy is the `base` license, anything bought
// later is an `addon`. These helpers pick the live license per product and tell
// the UI which products are still missing, so it can offer "add mobile" etc.
const { licenseStatus } = require('./status');

const PRODUCTS = ['desktop', 'mobile'];

// Statuses that no longer represent the client's current entitlement.
const DEAD = ['revoked', 'renewed'];

const normProduct = (p) => (String(p || 'desktop').toLowerCase() === 'mobile' ? 'mobile' : 'desktop');
const normKind = (k) => (String(k || 'base').toLowerCase() === 'addon' ? 'addon' : 'base');

// Attach computed fields to a raw licenses row.
function decorate(row) {
  if (!row) return null;
  const st = licenseStatus(row);
  return {
    ...row,
    product: normProduct(row.product),
    kind: normKind(row.kind),
    status: row.status,               // stored lifecycle state: active | renewed | revoked
    computed: st,                     // { state, daysLeft } — active/expiring/expired/perpetual/revoked
  };
}

const newestFirst = (a, b) =>
  String(b.created_at || '').localeCompare(String(a.created_at || '')) || (b.id - a.id);

function isLive(row) {
  return !!row && !DEAD.includes(row.status);
}

// The current license for one product: newest live row, base preferred over addon.
function liveForProduct(rows, product) {
  const p = normProduct(product);
  const cand = (rows || []).filter((r) => isLive(r) && normProduct(r.product) === p);
  if (!cand.length) return null;
  cand.sort((a, b) => (normKind(a.kind) === normKind(b.kind) ? newestFirst(a, b)
    : normKind(a.kind) === 'base' ? -1 : 1));
  return cand[0];
}

/**
 * Summarise a client's licenses by product.
 * rows = every license row of the client (any status).
 * Returns { byProduct: { desktop, mobile }, products, missing, all, primary }
 */
function licenseSummary(rows) {
  const all = (rows || []).map(decorate).sort(newestFirst);
  const byProduct = {};
  for (const p of PRODUCTS) byProduct[p] = decorate(liveForProduct(rows, p));
  const products = PRODUCTS.filter((p) => byProduct[p]);
  const missing = PRODUCTS.filter((p) => !byProduct[p]);
  // `primary` keeps the old single-license UI working: prefer the base license,
  // then desktop, then whatever is live, else the newest row at all.
  const primary =
    byProduct.desktop || byProduct.mobile ||
    all.find((r) => isLive(r)) || all[0] || null;
  return { byProduct, products, missing, all, primary };
}

// The base license an add-on should hang off: the client's live base license,
// preferring one for a DIFFERENT product than the add-on itself.
function findBaseFor(rows, product) {
  const p = normProduct(product);
  const live = (rows || []).filter((r) => isLive(r)).sort(newestFirst);
  return (
    live.find((r) => normKind(r.kind) === 'base' && normProduct(r.product) !== p) ||
    live.find((r) => normKind(r.kind) === 'base') ||
    live.find((r) => normProduct(r.product) !== p) ||
    live[0] || null
  );
}

module.exports = {
  PRODUCTS, decorate, isLive, liveForProduct, licenseSummary, findBaseFor, normProduct, normKind,
};
