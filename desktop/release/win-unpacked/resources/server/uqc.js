// GST UQC (Unit Quantity Code) mapping.
// The GST portal accepts a fixed list of UQC codes. We map the app's free-form
// units (PCS, BOX, KG, …) to the nearest official UQC.

// Official GSTN UQC codes (code -> human label) — the common subset.
const UQC_LIST = {
  BAG: 'BAGS', BAL: 'BALE', BDL: 'BUNDLES', BKL: 'BUCKLES', BOU: 'BILLION OF UNITS',
  BOX: 'BOX', BTL: 'BOTTLES', BUN: 'BUNCHES', CAN: 'CANS', CBM: 'CUBIC METERS',
  CCM: 'CUBIC CENTIMETERS', CMS: 'CENTIMETERS', CTN: 'CARTONS', DOZ: 'DOZENS',
  DRM: 'DRUMS', GGK: 'GREAT GROSS', GMS: 'GRAMMES', GRS: 'GROSS', GYD: 'GROSS YARDS',
  KGS: 'KILOGRAMS', KLR: 'KILOLITRE', KME: 'KILOMETRE', LTR: 'LITRES', MLT: 'MILILITRE',
  MTR: 'METERS', MTS: 'METRIC TON', NOS: 'NUMBERS', PAC: 'PACKS', PCS: 'PIECES',
  PRS: 'PAIRS', QTL: 'QUINTAL', ROL: 'ROLLS', SET: 'SETS', SQF: 'SQUARE FEET',
  SQM: 'SQUARE METERS', SQY: 'SQUARE YARDS', TBS: 'TABLETS', TGM: 'TEN GROSS',
  THD: 'THOUSANDS', TON: 'TONNES', TUB: 'TUBES', UGS: 'US GALLONS', UNT: 'UNITS',
  YDS: 'YARDS', OTH: 'OTHERS',
};

// App unit (upper-cased) -> GSTN UQC code
const UNIT_TO_UQC = {
  PCS: 'PCS', PC: 'PCS', PIECE: 'PCS', PIECES: 'PCS', NOS: 'NOS', NO: 'NOS', UNIT: 'UNT', UNITS: 'UNT',
  BOX: 'BOX', BOXES: 'BOX', CASE: 'CTN', CTN: 'CTN', CARTON: 'CTN', CARTONS: 'CTN',
  KG: 'KGS', KGS: 'KGS', KILOGRAM: 'KGS', KILO: 'KGS',
  GM: 'GMS', GMS: 'GMS', GRAM: 'GMS', G: 'GMS',
  LTR: 'LTR', LITRE: 'LTR', LITER: 'LTR', L: 'LTR',
  ML: 'MLT', MLT: 'MLT', MILLILITRE: 'MLT',
  MTR: 'MTR', METER: 'MTR', M: 'MTR',
  DOZEN: 'DOZ', DOZ: 'DOZ', DZ: 'DOZ',
  PKT: 'PAC', PACKET: 'PAC', PACK: 'PAC', PAC: 'PAC',
  BTL: 'BTL', BOTTLE: 'BTL',
  BAG: 'BAG', BAGS: 'BAG',
  SET: 'SET', SETS: 'SET',
  PAIR: 'PRS', PRS: 'PRS', PAIRS: 'PRS',
  ROLL: 'ROL', ROL: 'ROL',
  TON: 'TON', TONNE: 'TON', MT: 'MTS',
};

// Map a free-form app unit to a valid UQC code (defaults to OTH-OTHERS).
function toUQC(unit) {
  if (!unit) return 'OTH';
  const u = String(unit).trim().toUpperCase();
  if (UQC_LIST[u]) return u;            // already a valid UQC
  return UNIT_TO_UQC[u] || 'OTH';
}

function isValidUQC(code) {
  return !!UQC_LIST[String(code || '').toUpperCase()];
}

module.exports = { UQC_LIST, toUQC, isValidUQC };
