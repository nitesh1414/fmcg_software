// Unit Conversion Engine — shared helpers.
//
// Every item is stored in ONE base unit (the smallest indivisible unit — Piece,
// Gram, ml, Bottle...). All batch quantities live in base units. On top of the
// base an item can define any number of packaging levels (Pack, Box, Carton,
// Pallet, Crate...), each with an absolute conversion factor to the base unit.
//
// This module resolves a billed { unit, qty } into base units and validates the
// conversion ladder, so the same inventory core serves FMCG, pharma, hardware,
// paints, agriculture, etc. without changing the stock engine.
const db = require('./db');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
// Base-unit quantities can be fractional (KG, LTR) — keep 3 dp of precision.
const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

// Return an item's packaging ladder (base first), each row incl. factor & prices.
function getItemUnits(itemId) {
  return db
    .prepare('SELECT * FROM item_units WHERE item_id = ? ORDER BY is_base DESC, factor ASC, sort_order ASC')
    .all(itemId);
}

// The base unit name for an item (falls back to legacy `unit`, then 'PCS').
function baseUnitName(item) {
  if (!item) return 'PCS';
  if (item.base_unit && String(item.base_unit).trim()) return String(item.base_unit).trim();
  if (item.unit && String(item.unit).trim()) return String(item.unit).trim();
  return 'PCS';
}

// Resolve the conversion factor (base units per 1 of `unitName`) for an item.
// Falls back to 1 when the unit is unknown/blank (i.e. line already in base).
function factorFor(itemId, unitName, item) {
  if (!unitName || !String(unitName).trim()) return 1;
  const rows = getItemUnits(itemId);
  const match = rows.find((r) => r.unit_name.toLowerCase() === String(unitName).trim().toLowerCase());
  if (match) return Number(match.factor) || 1;
  // Unknown unit but it matches the item's base name → factor 1.
  if (item && String(baseUnitName(item)).toLowerCase() === String(unitName).trim().toLowerCase()) return 1;
  return 1;
}

// Convert a billed quantity in `unitName` to BASE units.
function toBaseQty(itemId, unitName, qty, item) {
  const f = factorFor(itemId, unitName, item);
  return round3((Number(qty) || 0) * f);
}

// Given a total base-unit quantity, express it in the largest whole packaging
// units down to base, e.g. 250 pcs → "1 Carton 0 Box 5 Pack 0 Piece" (compact:
// only non-zero levels). Returns a short human string for stock display.
function humanizeQty(itemId, baseQty, item) {
  const q = Number(baseQty) || 0;
  const rows = getItemUnits(itemId).slice().sort((a, b) => (Number(b.factor) || 1) - (Number(a.factor) || 1));
  if (!rows.length) return `${round3(q)} ${baseUnitName(item)}`;
  let remaining = q;
  const parts = [];
  for (const r of rows) {
    const f = Number(r.factor) || 1;
    if (f <= 0) continue;
    if (f === 1) { // base level — show the remainder (may be fractional)
      const v = round3(remaining);
      if (v > 0 || parts.length === 0) parts.push(`${v} ${r.unit_name}`);
      remaining = 0;
      break;
    }
    const whole = Math.floor(round3(remaining) / f);
    if (whole > 0) { parts.push(`${whole} ${r.unit_name}`); remaining = round3(remaining - whole * f); }
  }
  if (remaining > 0.0005) parts.push(`${round3(remaining)} ${baseUnitName(item)}`);
  return parts.join(' ') || `0 ${baseUnitName(item)}`;
}

// Validate & normalise a submitted packaging ladder for an item.
// `units` = [{ unit_name, factor, purchase_price, sale_price, barcode }].
// Ensures exactly one base unit (factor 1), positive factors, unique names.
// Returns { ok, error?, units? } where units are sorted base-first.
function normalizeUnits(units) {
  const list = Array.isArray(units) ? units.filter((u) => u && String(u.unit_name || '').trim()) : [];
  if (!list.length) return { ok: false, error: 'At least one unit (the base unit) is required.' };
  const seen = new Set();
  const out = [];
  for (const u of list) {
    const name = String(u.unit_name).trim();
    const key = name.toLowerCase();
    if (seen.has(key)) return { ok: false, error: `Duplicate unit name "${name}".` };
    seen.add(key);
    const factor = round3(Number(u.factor) || 0);
    if (factor <= 0) return { ok: false, error: `Unit "${name}" must have a factor greater than 0.` };
    out.push({
      unit_name: name,
      factor,
      is_base: factor === 1 ? 1 : 0,
      purchase_price: round2(Number(u.purchase_price) || 0),
      sale_price: round2(Number(u.sale_price) || 0),
      barcode: String(u.barcode || '').trim(),
    });
  }
  // Exactly one base unit (factor === 1). If none, the smallest becomes base.
  let bases = out.filter((u) => u.factor === 1);
  if (bases.length === 0) {
    return { ok: false, error: 'One unit must be the base unit with factor = 1 (e.g. 1 Piece = 1).' };
  }
  if (bases.length > 1) return { ok: false, error: 'Only one unit can be the base unit (factor = 1).' };
  // Sort base-first, then ascending factor.
  out.sort((a, b) => (b.is_base - a.is_base) || (a.factor - b.factor));
  out.forEach((u, i) => (u.sort_order = i));
  return { ok: true, units: out };
}

// Replace an item's packaging ladder with a normalised list.
function saveItemUnits(itemId, units) {
  const del = db.prepare('DELETE FROM item_units WHERE item_id = ?');
  const ins = db.prepare(
    `INSERT INTO item_units (item_id, unit_name, factor, is_base, purchase_price, sale_price, barcode, sort_order)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  const tx = db.transaction(() => {
    del.run(itemId);
    units.forEach((u) =>
      ins.run(itemId, u.unit_name, u.factor, u.is_base, u.purchase_price, u.sale_price, u.barcode, u.sort_order)
    );
  });
  tx();
}

// Find an item + unit by barcode (any packaging level). Returns { item_id, unit }.
function findByBarcode(code) {
  if (!code || !String(code).trim()) return null;
  return db
    .prepare('SELECT item_id, unit_name, factor FROM item_units WHERE barcode = ? COLLATE NOCASE LIMIT 1')
    .get(String(code).trim());
}

module.exports = {
  round2, round3, getItemUnits, baseUnitName, factorFor, toBaseQty,
  humanizeQty, normalizeUnits, saveItemUnits, findByBarcode,
};
