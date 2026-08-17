// Client management. Salespeople see/manage ONLY their own clients; admin sees all.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../auth');
const { licenseStatus } = require('../status');

const router = express.Router();
router.use(authRequired);

const isAdmin = (req) => req.user.role === 'admin';

// Attach the latest (current) license + computed status to a client row.
function withLicense(client) {
  const lic = db.prepare(
    `SELECT * FROM licenses WHERE client_id=? AND status!='revoked' ORDER BY datetime(created_at) DESC LIMIT 1`
  ).get(client.id);
  const creator = client.created_by
    ? db.prepare('SELECT id,name,username FROM users WHERE id=?').get(client.created_by) : null;
  return {
    ...client,
    salesperson: creator ? creator.name : '—',
    salesperson_id: creator ? creator.id : null,
    license: lic || null,
    status: licenseStatus(lic),
  };
}

// List clients (scoped by role) with optional search.
router.get('/', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  let rows;
  if (isAdmin(req)) {
    rows = db.prepare('SELECT * FROM clients ORDER BY datetime(created_at) DESC').all();
  } else {
    rows = db.prepare('SELECT * FROM clients WHERE created_by=? ORDER BY datetime(created_at) DESC').all(req.user.id);
  }
  let out = rows.map(withLicense);
  if (q) out = out.filter((c) =>
    (c.business_name || '').toLowerCase().includes(q) ||
    (c.contact_person || '').toLowerCase().includes(q) ||
    (c.phone || '').includes(q) ||
    (c.city || '').toLowerCase().includes(q));
  res.json(out);
});

// One client + its full license history.
router.get('/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM clients WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (!isAdmin(req) && c.created_by !== req.user.id) return res.status(403).json({ error: 'Not your client' });
  const history = db.prepare(`
    SELECT l.*, u.name AS created_by_name
    FROM licenses l LEFT JOIN users u ON u.id = l.created_by
    WHERE l.client_id=? ORDER BY datetime(l.created_at) DESC
  `).all(c.id);
  res.json({ ...withLicense(c), history });
});

// Create a client (salesperson becomes the owner).
router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.business_name) return res.status(400).json({ error: 'Business name is required' });
  const info = db.prepare(
    `INSERT INTO clients (business_name,contact_person,phone,email,city,gstin,notes,created_by)
     VALUES (@business_name,@contact_person,@phone,@email,@city,@gstin,@notes,@created_by)`
  ).run({
    business_name: b.business_name.trim(),
    contact_person: b.contact_person || '',
    phone: b.phone || '', email: b.email || '', city: b.city || '',
    gstin: b.gstin || '', notes: b.notes || '', created_by: req.user.id,
  });
  res.json(withLicense(db.prepare('SELECT * FROM clients WHERE id=?').get(info.lastInsertRowid)));
});

// Update a client (owner or admin).
router.put('/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM clients WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (!isAdmin(req) && c.created_by !== req.user.id) return res.status(403).json({ error: 'Not your client' });
  const b = req.body || {};
  db.prepare(`UPDATE clients SET business_name=?,contact_person=?,phone=?,email=?,city=?,gstin=?,notes=? WHERE id=?`)
    .run(b.business_name ?? c.business_name, b.contact_person ?? c.contact_person, b.phone ?? c.phone,
      b.email ?? c.email, b.city ?? c.city, b.gstin ?? c.gstin, b.notes ?? c.notes, c.id);
  res.json({ ok: true });
});

// Delete a client (admin only, to keep history safe).
router.delete('/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  db.prepare('DELETE FROM clients WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
