// Dashboard stats — scoped by role.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../auth');
const { licenseStatus } = require('../status');

const router = express.Router();
router.use(authRequired);

router.get('/', (req, res) => {
  const admin = req.user.role === 'admin';
  const clients = admin
    ? db.prepare('SELECT * FROM clients').all()
    : db.prepare('SELECT * FROM clients WHERE created_by=?').all(req.user.id);

  const counts = { clients: clients.length, active: 0, expiring: 0, expired: 0, perpetual: 0, noLicense: 0 };
  const expiringList = [];
  for (const c of clients) {
    const lic = db.prepare(
      `SELECT * FROM licenses WHERE client_id=? AND status!='revoked' ORDER BY datetime(created_at) DESC LIMIT 1`
    ).get(c.id);
    const st = licenseStatus(lic);
    if (!lic) counts.noLicense++;
    else if (st.state === 'perpetual') counts.perpetual++;
    else if (st.state === 'expired') counts.expired++;
    else if (st.state === 'expiring') counts.expiring++;
    else counts.active++;
    if (lic && (st.state === 'expiring' || st.state === 'expired')) {
      expiringList.push({ client_id: c.id, business_name: c.business_name, phone: c.phone,
        expires: lic.expires, daysLeft: st.daysLeft, state: st.state });
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

  res.json({ role: req.user.role, counts, expiringSoon: expiringList.slice(0, 20), teamStats });
});

module.exports = router;
