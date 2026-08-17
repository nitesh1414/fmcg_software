// Compute a license's live status (active / expiring / expired / perpetual)
// from its stored expiry, so both the API and UI can show consistent info.
function dayDiff(expISO, now) {
  const [y, m, d] = expISO.split('-').map(Number);
  const exp = Date.UTC(y, m - 1, d);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((exp - today) / 86400000);
}

function licenseStatus(lic, now = new Date()) {
  if (!lic) return { state: 'none', daysLeft: null };
  if (lic.status === 'revoked') return { state: 'revoked', daysLeft: null };
  if (lic.perpetual || !lic.expires) return { state: 'perpetual', daysLeft: null };
  const daysLeft = dayDiff(lic.expires, now);
  const reminder = lic.reminder_days || 15;
  let state = 'active';
  if (daysLeft < 0) state = 'expired';
  else if (daysLeft <= reminder) state = 'expiring';
  return { state, daysLeft };
}

module.exports = { licenseStatus, dayDiff };
