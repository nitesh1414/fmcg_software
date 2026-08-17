// Server-side license signing for the portal. Uses the SAME ed25519 private key
// as the desktop product (portal/server/license_private.pem) so portal-generated
// keys verify offline in the installed RightServe app.
//
// SECURITY: the private key never leaves the server. Salespeople only call the
// API; they never see the key.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PRIV_PATH = process.env.LICENSE_PRIVATE_KEY || path.join(__dirname, 'license_private.pem');
const privateKey = crypto.createPrivateKey(fs.readFileSync(PRIV_PATH));

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function isoDate(d) { return d.toISOString().slice(0, 10); }

/**
 * Build + sign a license. Returns { payload, licenseKey }.
 * opts: { client, plan, days?, expires?, never?, machine?, reminderDays?, notes? }
 */
function generateLicense(opts) {
  let expires = null; // null = perpetual
  if (opts.never) {
    expires = null;
  } else if (opts.expires) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.expires)) throw new Error('expires must be YYYY-MM-DD');
    expires = opts.expires;
  } else if (opts.days) {
    const d = new Date();
    d.setDate(d.getDate() + parseInt(opts.days, 10));
    expires = isoDate(d);
  } else {
    throw new Error('Provide days, expires (YYYY-MM-DD), or never=true');
  }

  const payload = {
    v: 1,
    id: 'RS-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
    client: String(opts.client || '').trim(),
    plan: opts.plan ? String(opts.plan) : 'Standard',
    issued: isoDate(new Date()),
    expires,
    machine: opts.machine ? String(opts.machine).toUpperCase().trim() : null,
    reminderDays: opts.reminderDays ? parseInt(opts.reminderDays, 10) : 15,
    notes: opts.notes ? String(opts.notes) : '',
    // One-time online activation. When true, the desktop app must claim the key
    // at the portal on first use; the portal binds it to that one machine and
    // refuses any other device. `act` is the activation endpoint base URL.
    online: opts.online === false ? false : true,
    act: opts.activationUrl || process.env.ACTIVATION_URL || '',
  };
  if (!payload.client) throw new Error('client (business name) is required');

  const payloadBuf = Buffer.from(JSON.stringify(payload), 'utf8');
  const sig = crypto.sign(null, payloadBuf, privateKey);
  const licenseKey = `RSL1.${b64url(payloadBuf)}.${b64url(sig)}`;
  return { payload, licenseKey };
}

module.exports = { generateLicense };
