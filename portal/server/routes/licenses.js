// License generation & renewal. Salespeople can generate/renew for their own
// clients; admin for any client. The signed key is stored so it can be re-shown.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../auth');
const { generateLicense } = require('../licensing');
const { licenseStatus, dayDiff } = require('../status');

const router = express.Router();
router.use(authRequired);

const isAdmin = (req) => req.user.role === 'admin';

function canTouchClient(req, client) {
  return client && (isAdmin(req) || client.created_by === req.user.id);
}

// Create a license for a client. body: { client_id, plan, days|expires|never, machine, reminderDays, notes }
router.post('/', (req, res) => {
  const b = req.body || {};
  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(b.client_id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (!canTouchClient(req, client)) return res.status(403).json({ error: 'Not your client' });

  let gen;
  try {
    gen = generateLicense({
      client: client.business_name,
      plan: b.plan, days: b.days, expires: b.expires, never: !!b.never,
      machine: b.machine, reminderDays: b.reminderDays, notes: b.notes,
    });
  } catch (e) { return res.status(400).json({ error: e.message }); }

  const info = db.prepare(`
    INSERT INTO licenses (license_id,client_id,plan,issued,expires,perpetual,machine,reminder_days,notes,license_key,created_by)
    VALUES (@license_id,@client_id,@plan,@issued,@expires,@perpetual,@machine,@reminder_days,@notes,@license_key,@created_by)
  `).run({
    license_id: gen.payload.id, client_id: client.id, plan: gen.payload.plan,
    issued: gen.payload.issued, expires: gen.payload.expires, perpetual: gen.payload.expires ? 0 : 1,
    machine: gen.payload.machine || '', reminder_days: gen.payload.reminderDays,
    notes: gen.payload.notes || '', license_key: gen.licenseKey, created_by: req.user.id,
  });
  const row = db.prepare('SELECT * FROM licenses WHERE id=?').get(info.lastInsertRowid);
  res.json({ ...row, status: licenseStatus(row) });
});

// Renew = generate a NEW license for the same client and mark the old one renewed.
router.post('/:id/renew', (req, res) => {
  const b = req.body || {};
  const old = db.prepare('SELECT * FROM licenses WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'License not found' });
  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(old.client_id);
  if (!canTouchClient(req, client)) return res.status(403).json({ error: 'Not your client' });

  // Carry over UNUSED days from the current license into the new term (default on).
  // Only positive remaining days of a dated (non-perpetual) license are added.
  const carryOver = b.carryOver === false ? false : true;
  let carried = 0;
  if (carryOver && old.expires && !old.perpetual) {
    const left = dayDiff(old.expires, new Date());
    if (left > 0) carried = left;
  }

  // Resolve the new term, then add carried days (unless the new license is perpetual).
  let extraDays = 0;
  if (!b.never) extraDays = carried;

  let gen;
  try {
    // If renewing by days, simply add carried days to the chosen days.
    if (b.days && !b.never) {
      gen = generateLicense({
        client: client.business_name, plan: b.plan || old.plan,
        days: parseInt(b.days, 10) + extraDays,
        machine: b.machine !== undefined ? b.machine : old.machine,
        reminderDays: b.reminderDays || old.reminder_days, notes: b.notes || old.notes,
      });
    } else if (b.expires && !b.never) {
      // If renewing to a fixed date, push that date out by the carried days.
      const d = new Date(b.expires + 'T00:00:00');
      d.setDate(d.getDate() + extraDays);
      gen = generateLicense({
        client: client.business_name, plan: b.plan || old.plan,
        expires: d.toISOString().slice(0, 10),
        machine: b.machine !== undefined ? b.machine : old.machine,
        reminderDays: b.reminderDays || old.reminder_days, notes: b.notes || old.notes,
      });
    } else {
      // Perpetual renewal — no carry needed.
      gen = generateLicense({
        client: client.business_name, plan: b.plan || old.plan, never: !!b.never,
        days: b.never ? undefined : b.days, expires: b.never ? undefined : b.expires,
        machine: b.machine !== undefined ? b.machine : old.machine,
        reminderDays: b.reminderDays || old.reminder_days, notes: b.notes || old.notes,
      });
    }
  } catch (e) { return res.status(400).json({ error: e.message }); }

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO licenses (license_id,client_id,plan,issued,expires,perpetual,machine,reminder_days,notes,license_key,carried_days,created_by)
      VALUES (@license_id,@client_id,@plan,@issued,@expires,@perpetual,@machine,@reminder_days,@notes,@license_key,@carried_days,@created_by)
    `).run({
      license_id: gen.payload.id, client_id: client.id, plan: gen.payload.plan,
      issued: gen.payload.issued, expires: gen.payload.expires, perpetual: gen.payload.expires ? 0 : 1,
      machine: gen.payload.machine || '', reminder_days: gen.payload.reminderDays,
      notes: gen.payload.notes || '', license_key: gen.licenseKey,
      carried_days: extraDays, created_by: req.user.id,
    });
    db.prepare("UPDATE licenses SET status='renewed', superseded_by=? WHERE id=?").run(info.lastInsertRowid, old.id);
    return info.lastInsertRowid;
  });
  const newId = tx();
  const row = db.prepare('SELECT * FROM licenses WHERE id=?').get(newId);
  res.json({ ...row, status: licenseStatus(row), carriedDays: extraDays });
});

// Re-fetch a stored key (e.g. to copy/resend to the client).
router.get('/:id/key', (req, res) => {
  const lic = db.prepare('SELECT * FROM licenses WHERE id=?').get(req.params.id);
  if (!lic) return res.status(404).json({ error: 'Not found' });
  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(lic.client_id);
  if (!canTouchClient(req, client)) return res.status(403).json({ error: 'Not allowed' });
  res.json({ license_key: lic.license_key, license_id: lic.license_id });
});

// Revoke (admin only).
router.post('/:id/revoke', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  db.prepare("UPDATE licenses SET status='revoked' WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// Reset / transfer activation — frees the key so it can be activated on a new
// device (e.g. client changed computers). Owner or admin.
router.post('/:id/reset-activation', (req, res) => {
  const lic = db.prepare('SELECT * FROM licenses WHERE id=?').get(req.params.id);
  if (!lic) return res.status(404).json({ error: 'Not found' });
  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(lic.client_id);
  if (!canTouchClient(req, client)) return res.status(403).json({ error: 'Not your client' });
  db.prepare("UPDATE licenses SET activated_machine='', activated_at='' WHERE id=?").run(lic.id);
  res.json({ ok: true });
});

module.exports = router;
