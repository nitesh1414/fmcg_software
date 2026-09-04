// Dashboard stats — scoped by role.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../auth');
const { licenseStatus } = require('../status');
const { licenseSummary, PRODUCTS } = require('../view');

const router = express.Router();
router.use(authRequired);

const clientRows = (clientId) => db.prepare(
  'SELECT * FROM licenses WHERE client_id=? ORDER BY datetime(created_at) DESC, id DESC'
).all(clientId);

router.get('/', (req, res) => {
  const admin = req.user.role === 'admin';
  const clients = admin
    ? db.prepare('SELECT * FROM clients').all()
    : db.prepare('SELECT * FROM clients WHERE created_by=?').all(req.user.id);

  const counts = {
    clients: clients.length, active: 0, expiring: 0, expired: 0, perpetual: 0, noLicense: 0,
    desktop: 0, mobile: 0, addons: 0,
  };
  const expiringList = [];
  const addonList = [];

  for (const c of clients) {
    const sum = licenseSummary(clientRows(c.id));
    const lic = sum.primary;
    const st = licenseStatus(lic);
    if (!lic) counts.noLicense++;
    else if (st.state === 'perpetual') counts.perpetual++;
    else if (st.state === 'expired') counts.expired++;
    else if (st.state === 'expiring') counts.expiring++;
    else counts.active++;

    for (const p of PRODUCTS) {
      if (sum.byProduct[p]) counts[p]++;
    }
    counts.addons += sum.all.filter((l) => l.kind === 'addon' && l.status !== 'revoked').length;

    // One row per live license that is due for renewal (desktop and mobile
    // separately — they are separate keys with separate terms).
    for (const p of PRODUCTS) {
      const l = sum.byProduct[p];
      if (!l) continue;
      const s = licenseStatus(l);
      if (s.state === 'expiring' || s.state === 'expired') {
        expiringList.push({
          client_id: c.id, business_name: c.business_name, phone: c.phone, product: p,
          license_id: l.license_id, expires: l.expires, daysLeft: s.daysLeft, state: s.state,
        });
      }
    }
    // Cross-sell: they run one product but not the other.
    if (sum.products.length === 1) {
      addonList.push({
        client_id: c.id, business_name: c.business_name, phone: c.phone,
        has: sum.products[0], missing: sum.missing[0],
      });
    }
  }
  expiringList.sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));

  let teamStats = null;
  if (admin) {
    teamStats = db.prepare(`
      SELECT u.id,u.name,u.username,
        (SELECT COUNT(*) FROM clients c WHERE c.created_by=u.id) AS clients,
        (SELECT COUNT(*) FROM licenses l WHERE l.created_by=u.id) AS licenses
      FROM users u WHERE u.role='sales' ORDER BY clients DESC
    `).all();
  }

  res.json({
    role: req.user.role,
    counts,
    expiringSoon: expiringList.slice(0, 20),
    addonOpportunities: addonList.slice(0, 20),
    addonCount: addonList.length,
    teamStats,
  });
});

module.exports = router;
