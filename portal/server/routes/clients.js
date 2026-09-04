// Client management. Salespeople see/manage ONLY their own clients; admin sees all.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../auth');
const { licenseStatus } = require('../status');
const { licenseSummary, PRODUCTS } = require('../view');

const router = express.Router();
router.use(authRequired);

const isAdmin = (req) => req.user.role === 'admin';

const clientRows = (clientId) => db.prepare(
  'SELECT * FROM licenses WHERE client_id=? ORDER BY datetime(created_at) DESC, id DESC'
).all(clientId);

// Attach the current license PER PRODUCT (desktop / mobile) + computed status.
// A client may hold a desktop license and a mobile add-on at the same time, so
// `license` (kept for the older UI) is only the primary one.
function withLicense(client) {
  const sum = licenseSummary(clientRows(client.id));
  const creator = client.created_by
    ? db.prepare('SELECT id,name,username FROM users WHERE id=?').get(client.created_by) : null;
  return {
    ...client,
    salesperson: creator ? creator.name : '—',
    salesperson_id: creator ? creator.id : null,
    license: sum.primary,                                  // primary (base → desktop → any)
    licenses: sum.byProduct,                               // { desktop, mobile } — live ones only
    products: sum.products,                                // ['desktop'] / ['desktop','mobile']
    missing_products: sum.missing,                         // what an add-on can still be sold for
    license_count: sum.all.filter((l) => l.status !== 'revoked').length,
    status: licenseStatus(sum.primary),
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
    (c.email || '').toLowerCase().includes(q) ||
    (c.city || '').toLowerCase().includes(q));
  res.json(out);
});

// One client + its full license history.
router.get('/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM clients WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (!isAdmin(req) && c.created_by !== req.user.id) return res.status(403).json({ error: 'Not your client' });
  const history = db.prepare(`
    SELECT l.*, u.name AS created_by_name,
           (SELECT p.license_id FROM licenses p WHERE p.id = l.parent_id) AS parent_license_id
    FROM licenses l LEFT JOIN users u ON u.id = l.created_by
    WHERE l.client_id=? ORDER BY datetime(l.created_at) DESC, l.id DESC
  `).all(c.id);
  const sum = licenseSummary(history);
  res.json({
    ...withLicense(c),
    history: history.map((h) => ({ ...h, computed: licenseStatus(h) })),
    products: sum.products,
    missing_products: sum.missing,
  });
});

// Create a client (salesperson becomes the owner).
router.post('/', (req, res) => {
  const b = req.body || {};
  const name = String(b.business_name || '').trim();
  if (!name) return res.status(400).json({ error: 'Business name is required' });
  const info = db.prepare(
    `INSERT INTO clients (business_name,contact_person,phone,email,city,gstin,notes,created_by)
     VALUES (@business_name,@contact_person,@phone,@email,@city,@gstin,@notes,@created_by)`
  ).run({
    business_name: name,
    contact_person: b.contact_person || '',
    phone: b.phone || '', email: b.email || '', city: b.city || '',
    gstin: String(b.gstin || '').toUpperCase().trim(), notes: b.notes || '', created_by: req.user.id,
  });
  res.json(withLicense(db.prepare('SELECT * FROM clients WHERE id=?').get(info.lastInsertRowid)));
});

// Update a client (owner or admin). Admin may also move the client to another
// salesperson with { created_by: <user id> }.
router.put('/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM clients WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (!isAdmin(req) && c.created_by !== req.user.id) return res.status(403).json({ error: 'Not your client' });
  const b = req.body || {};
  const name = b.business_name === undefined ? c.business_name : String(b.business_name).trim();
  if (!name) return res.status(400).json({ error: 'Business name cannot be empty' });

  let createdBy = c.created_by;
  if (isAdmin(req) && b.created_by !== undefined) {
    if (b.created_by === null) createdBy = null;
    else {
      const u = db.prepare('SELECT id FROM users WHERE id=?').get(b.created_by);
      if (!u) return res.status(400).json({ error: 'Unknown salesperson' });
      createdBy = u.id;
    }
  }

  db.prepare(`UPDATE clients SET business_name=?,contact_person=?,phone=?,email=?,city=?,gstin=?,notes=?,created_by=? WHERE id=?`)
    .run(name, b.contact_person ?? c.contact_person, b.phone ?? c.phone,
      b.email ?? c.email, b.city ?? c.city,
      String(b.gstin ?? c.gstin).toUpperCase().trim(), b.notes ?? c.notes, createdBy, c.id);
  res.json(withLicense(db.prepare('SELECT * FROM clients WHERE id=?').get(c.id)));
});

// Delete a client — removes the client AND its license history.
//   admin  : may delete any client (pass ?force=1 for clients that already have
//            licenses, since that invalidates keys already installed in the field)
//   owner  : may delete their own client only while it has no licenses
router.delete('/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM clients WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const owner = !isAdmin(req) && c.created_by === req.user.id;
  if (!isAdmin(req) && !owner) return res.status(403).json({ error: 'Not your client' });

  const licCount = db.prepare('SELECT COUNT(*) AS n FROM licenses WHERE client_id=?').get(c.id).n;
  const activated = db.prepare(
    "SELECT COUNT(*) AS n FROM licenses WHERE client_id=? AND activated_machine!=''"
  ).get(c.id).n;
  const force = req.query.force === '1' || req.body?.force === true;

  if (licCount > 0 && !isAdmin(req)) {
    return res.status(409).json({
      error: 'This client already has licenses. Ask an admin to delete it.',
      code: 'HAS_LICENSES', licenses: licCount,
    });
  }
  if (licCount > 0 && !force) {
    return res.status(409).json({
      error: `This client has ${licCount} license(s)${activated ? `, ${activated} already activated` : ''}. Confirm to delete everything.`,
      code: 'HAS_LICENSES', licenses: licCount, activated,
    });
  }

  db.prepare('DELETE FROM clients WHERE id=?').run(c.id); // licenses cascade
  res.json({ ok: true, deleted_licenses: licCount });
});

module.exports = router;
module.exports.PRODUCTS = PRODUCTS;
