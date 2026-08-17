// PUBLIC activation endpoint — called by the RightServe desktop app (the end
// client's device), NOT by the sales team. No auth; identified by the signed key.
//
// One-time activation rule:
//   - First device to activate a key gets BOUND to it (machine fingerprint saved).
//   - Any other device using the same key is REJECTED.
//   - The same device re-checking returns OK (idempotent re-validation).
const express = require('express');
const db = require('../db');
const { licenseStatus } = require('../status');

const router = express.Router();

// POST /api/activate  { licenseId, machine }
// Returns: { ok, state, expires, perpetual, daysLeft, client } or { ok:false, reason }
router.post('/', (req, res) => {
  const licenseId = String((req.body && req.body.licenseId) || '').trim();
  const machine = String((req.body && req.body.machine) || '').trim().toUpperCase();
  if (!licenseId || !machine) return res.status(400).json({ ok: false, reason: 'licenseId and machine are required' });

  const lic = db.prepare('SELECT * FROM licenses WHERE license_id=?').get(licenseId);
  if (!lic) return res.status(404).json({ ok: false, reason: 'Unknown license. Please contact RightServe.' });

  if (lic.status === 'revoked') return res.status(403).json({ ok: false, reason: 'This license has been revoked. Please contact RightServe.' });
  if (lic.status === 'renewed') return res.status(409).json({ ok: false, reason: 'This key was renewed. Please use the latest key sent to you.' });

  // If a pre-set machine lock exists in the key, enforce it too.
  if (lic.machine && lic.machine.toUpperCase() !== machine) {
    return res.status(403).json({ ok: false, reason: 'This license is locked to a different computer.' });
  }

  const status = licenseStatus(lic);
  if (status.state === 'expired') {
    return res.status(403).json({ ok: false, reason: `License expired on ${lic.expires}. Please renew.` });
  }

  // Bind on first activation; reject other devices; allow same device again.
  if (!lic.activated_machine) {
    db.prepare(
      "UPDATE licenses SET activated_machine=?, activated_at=datetime('now'), activation_count=activation_count+1 WHERE id=?"
    ).run(machine, lic.id);
  } else if (lic.activated_machine !== machine) {
    return res.status(409).json({
      ok: false, code: 'ALREADY_ACTIVATED',
      reason: 'This license key is already activated on another computer and cannot be reused. Contact RightServe to transfer it.',
    });
  }
  // else: same machine re-validating — fine.

  res.json({
    ok: true,
    licenseId: lic.license_id,
    client: db.prepare('SELECT business_name FROM clients WHERE id=?').get(lic.client_id)?.business_name || '',
    plan: lic.plan,
    expires: lic.expires,
    perpetual: !!lic.perpetual,
    daysLeft: status.daysLeft,
    state: status.state,
    machine,
  });
});

module.exports = router;
