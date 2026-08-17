// Financial-year helpers. Default FY starts in April (month 4) as per India.
const db = require('./db');

function fyStartMonth() {
  try {
    const c = db.prepare('SELECT fy_start_month FROM company WHERE id=1').get();
    const m = c && Number(c.fy_start_month);
    return m >= 1 && m <= 12 ? m : 4;
  } catch (_) { return 4; }
}

// Given a label like "2024-2025" (or a Date) return {from, to} ISO date strings.
function fyRange(label) {
  const sm = fyStartMonth();
  let startYear;
  if (label && /^\d{4}/.test(String(label))) {
    startYear = parseInt(String(label).slice(0, 4), 10);
  } else {
    const now = new Date();
    startYear = now.getMonth() + 1 >= sm ? now.getFullYear() : now.getFullYear() - 1;
  }
  const pad = (n) => String(n).padStart(2, '0');
  const from = `${startYear}-${pad(sm)}-01`;
  // FY ends the day before the start month, next year (or same year if sm===1)
  const endYear = sm === 1 ? startYear : startYear + 1;
  const endMonth = sm === 1 ? 12 : sm - 1;
  const lastDay = new Date(endYear, endMonth, 0).getDate(); // day 0 of next month = last day
  const to = `${endYear}-${pad(endMonth)}-${pad(lastDay)}`;
  return { from, to, startYear, endYear, label: `${startYear}-${endYear}` };
}

// The financial year that TODAY falls in — computed live from the current date
// and the configured start month, so it rolls over automatically when a new FY
// begins (e.g. on 1 April for the default April-start FY).
function currentFy() {
  const sm = fyStartMonth();
  const now = new Date();
  const startYear = now.getMonth() + 1 >= sm ? now.getFullYear() : now.getFullYear() - 1;
  return fyRange(String(startYear));
}

// Build a list of available financial years from the earliest transaction to now.
function listFinancialYears() {
  const sm = fyStartMonth();
  const row = db.prepare(`SELECT MIN(date) AS mn FROM invoices`).get();
  const minDate = row && row.mn ? new Date(row.mn) : new Date();
  const now = new Date();
  const firstStartYear = minDate.getMonth() + 1 >= sm ? minDate.getFullYear() : minDate.getFullYear() - 1;
  const curStartYear = now.getMonth() + 1 >= sm ? now.getFullYear() : now.getFullYear() - 1;
  const years = [];
  for (let y = curStartYear; y >= firstStartYear; y--) {
    years.push(fyRange(String(y)));
  }
  return years;
}

module.exports = { fyStartMonth, fyRange, currentFy, listFinancialYears };
