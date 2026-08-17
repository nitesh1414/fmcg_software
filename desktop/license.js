// ===========================================================================
// license.js — RightServe offline licensing (ed25519 signed license blocks)
// ---------------------------------------------------------------------------
// How it works
//  - RightServe holds a PRIVATE key (tools/keys/license_private.pem) and mints
//    signed "license blocks" with the generator tool (tools/license-gen.js).
//  - The app ships ONLY the PUBLIC key (desktop/license_public.pem) and the
//    license string is verified offline — clients cannot forge or edit a key.
//  - A license payload is JSON: { client, plan, issued, expires, machine, ... }
//    "expires" may be null  => never expires (perpetual license).
//    "machine" may be null  => works on any computer; otherwise it must match
//    this machine's fingerprint (so a key can't be copied to another PC).
//  - The signed block is:  RSL1.<base64url(payload)>.<base64url(signature)>
//
// Stored at: <userData>/license.dat  (just the license string)
// Anti-rollback: <userData>/.rsmeta stores the highest date the app has seen,
// so setting the clock back doesn't extend an expired license.
// ===========================================================================
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PREFIX = 'RSL1';
const REMINDER_DAYS = 15; // start warning this many days before expiry

function b64urlDecode(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}
function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// Machine fingerprint — STABLE per-computer id.
// ---------------------------------------------------------------------------
// A random device id is generated ONCE and stored in a local file (device.id in
// the user-data folder). That persisted id is the primary machine identity, so
// it never changes when network adapters / MAC / VPN / hostname change — which
// previously caused the app to think it was a "different computer" and demand
// re-activation (needing internet) on some launches.
//
// The hardware hash (MAC + hostname + cpu) is only a FALLBACK used before the
// device file exists (or if it can't be written). main.js calls
// setDeviceIdPath(<userData>/device.id) once at startup.
let _deviceIdPath = null;
let _cachedId = null;
function setDeviceIdPath(p) { _deviceIdPath = p; _cachedId = null; }

// Hardware-derived fallback id (not persisted).
function hardwareId() {
  let mac = '';
  try {
    const ifaces = os.networkInterfaces();
    const macs = [];
    for (const name of Object.keys(ifaces)) {
      for (const ni of ifaces[name] || []) {
        if (!ni.internal && ni.mac && ni.mac !== '00:00:00:00:00:00') macs.push(ni.mac);
      }
    }
    macs.sort();
    mac = macs[0] || '';
  } catch (_) { /* ignore */ }
  const cpu = (os.cpus()[0] && os.cpus()[0].model) || '';
  return [mac, os.hostname(), os.platform(), os.arch(), cpu].join('|');
}

function formatId(hex) {
  const h = hex.slice(0, 16).toUpperCase();
  return h.replace(/(.{4})/g, '$1-').replace(/-$/, ''); // XXXX-XXXX-XXXX-XXXX
}

function machineId() {
  if (_cachedId) return _cachedId;

  // 1) Prefer a persisted random device id (stable across adapter/MAC changes).
  if (_deviceIdPath) {
    try {
      if (fs.existsSync(_deviceIdPath)) {
        const saved = fs.readFileSync(_deviceIdPath, 'utf8').trim();
        if (/^[0-9A-F-]{16,}$/i.test(saved)) { _cachedId = saved.toUpperCase(); return _cachedId; }
      }
    } catch (_) { /* ignore */ }
  }

  // 2) Derive an id from hardware, and if we have a path, persist it so future
  //    launches are stable even if the hardware signature later changes.
  const raw = hardwareId();
  const id = formatId(crypto.createHash('sha256').update(raw).digest('hex'));
  if (_deviceIdPath) {
    try { fs.writeFileSync(_deviceIdPath, id, 'utf8'); } catch (_) { /* ignore */ }
  }
  _cachedId = id;
  return id;
}

// Kept for reference / legacy: pure hardware hash (used by nothing critical now).
function machineIdLegacy() {
  const raw = hardwareId();
  // Short, human-friendly id (12 hex chars grouped) for the activation screen.
  const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16).toUpperCase();
  return hash.replace(/(.{4})/g, '$1-').replace(/-$/, ''); // XXXX-XXXX-XXXX-XXXX
}

// ---------------------------------------------------------------------------
// Verify a license string against the embedded public key.
// Returns { valid, reason, payload }
// ---------------------------------------------------------------------------
function loadPublicKey(publicKeyPem) {
  return crypto.createPublicKey(publicKeyPem);
}

function verifyLicenseString(licStr, publicKeyPem) {
  try {
    const parts = String(licStr || '').trim().split('.');
    if (parts.length !== 3 || parts[0] !== PREFIX) {
      return { valid: false, reason: 'Invalid license format' };
    }
    const payloadBuf = b64urlDecode(parts[1]);
    const sig = b64urlDecode(parts[2]);
    const pub = loadPublicKey(publicKeyPem);
    const ok = crypto.verify(null, payloadBuf, pub, sig);
    if (!ok) return { valid: false, reason: 'Signature verification failed (tampered or wrong key)' };
    let payload;
    try { payload = JSON.parse(payloadBuf.toString('utf8')); }
    catch (_) { return { valid: false, reason: 'Corrupt license payload' }; }
    return { valid: true, payload };
  } catch (e) {
    return { valid: false, reason: 'Could not read license: ' + e.message };
  }
}

// ---------------------------------------------------------------------------
// Evaluate a verified payload against this machine + the current (monotonic)
// date. Returns a rich status object the app uses to allow / warn / lock.
// ---------------------------------------------------------------------------
// Whole-day difference between two YYYY-MM-DD dates (b - a), ignoring time.
function dayDiff(expISO, now) {
  const [y, m, d] = expISO.split('-').map(Number);
  const exp = Date.UTC(y, m - 1, d);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((exp - today) / 86400000);
}

function evaluate(payload, opts = {}) {
  const now = opts.now || new Date();
  const thisMachine = opts.machineId || machineId();

  // Machine binding
  if (payload.machine && payload.machine !== thisMachine) {
    return {
      state: 'invalid',
      reason: 'This license is locked to a different computer.',
      payload, machineId: thisMachine,
    };
  }

  // Perpetual (never expires)
  if (!payload.expires) {
    return {
      state: 'active', perpetual: true, daysLeft: null,
      expires: null, payload, machineId: thisMachine,
    };
  }

  // daysLeft: 0 = expires today (still valid today); negative = expired.
  const daysLeft = dayDiff(payload.expires, now);

  if (daysLeft < 0) {
    return {
      state: 'expired', daysLeft, expires: payload.expires,
      payload, machineId: thisMachine,
      reason: `License expired on ${payload.expires}.`,
    };
  }
  return {
    state: daysLeft <= (payload.reminderDays || REMINDER_DAYS) ? 'expiring' : 'active',
    perpetual: false, daysLeft, expires: payload.expires,
    payload, machineId: thisMachine,
  };
}

// ---------------------------------------------------------------------------
// File helpers (license + anti-rollback meta) — paths supplied by the caller
// so this module stays free of Electron.
// ---------------------------------------------------------------------------
function readLicenseFile(licPath) {
  try { return fs.readFileSync(licPath, 'utf8').trim(); } catch (_) { return ''; }
}
function writeLicenseFile(licPath, licStr) {
  fs.writeFileSync(licPath, String(licStr).trim(), 'utf8');
}
function clearLicenseFile(licPath) {
  try { fs.unlinkSync(licPath); } catch (_) {}
}

// Monotonic "now": never earlier than the highest date we've ever recorded, so
// rolling the system clock back can't revive an expired license.
function monotonicNow(metaPath) {
  const real = new Date();
  let seen = 0;
  try { seen = JSON.parse(fs.readFileSync(metaPath, 'utf8')).maxSeen || 0; } catch (_) {}
  const effective = real.getTime() < seen ? new Date(seen) : real;
  try {
    fs.writeFileSync(metaPath, JSON.stringify({ maxSeen: Math.max(seen, real.getTime()) }), 'utf8');
  } catch (_) {}
  return effective;
}

// ---------------------------------------------------------------------------
// One-time activation
// ---------------------------------------------------------------------------
// Local "activation seal": once a key is activated, we record the licenseId +
// this machine's id locally. If the activated files are copied to another PC,
// the seal's machine won't match → the app refuses to run there (offline guard,
// in addition to the server-side one-device binding).
function readSeal(sealPath) {
  try { return JSON.parse(fs.readFileSync(sealPath, 'utf8')); } catch (_) { return null; }
}
function writeSeal(sealPath, licenseId) {
  try { fs.writeFileSync(sealPath, JSON.stringify({ licenseId, machine: machineId(), at: Date.now() }), 'utf8'); } catch (_) {}
}

// Claim a key at the portal (one-time, binds to this machine). Online required
// only at activation; afterwards the app runs offline. Returns { ok, reason }.
// A key is "online" (one-device locked) only when it BOTH opts in (online !== false)
// AND carries an activation server address. Without a server address there is
// nothing to claim against, so the key behaves as a normal offline key.
function isOnlineKey(payload) {
  return payload.online !== false && !!(payload.act && String(payload.act).trim());
}

async function activateOnline(payload, { timeoutMs = 12000 } = {}) {
  // Offline keys (online:false, OR no server address) skip the server claim.
  if (!isOnlineKey(payload)) return { ok: true, offline: true };
  const base = (payload.act || '').replace(/\/+$/, '');
  const url = base + '/api/activate';
  const body = JSON.stringify({ licenseId: payload.id, machine: machineId() });
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: ctrl.signal,
    });
    clearTimeout(t);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      return { ok: false, reason: data.reason || `Activation failed (HTTP ${res.status}).`, code: data.code };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, reason: 'Could not reach the activation server. Please connect to the internet and try again.\n(' + (e.message || e) + ')' };
  }
}

// One-call helper: read + verify + evaluate the installed license, INCLUDING the
// local activation seal check (so a copied activated install fails elsewhere).
function getStatus({ licPath, metaPath, sealPath, publicKeyPem }) {
  const licStr = readLicenseFile(licPath);
  if (!licStr) return { state: 'none', machineId: machineId() };
  const v = verifyLicenseString(licStr, publicKeyPem);
  if (!v.valid) return { state: 'invalid', reason: v.reason, machineId: machineId() };

  // Activation seal: an online key must have a local seal for THIS license,
  // proving it was activated on this install. Checked entirely OFFLINE — no
  // network on normal launches.
  if (isOnlineKey(v.payload) && sealPath) {
    const seal = readSeal(sealPath);
    if (!seal || seal.licenseId !== v.payload.id) {
      return { state: 'needs-activation', reason: 'This key has not been activated on this computer.', payload: v.payload, machineId: machineId() };
    }
    // The seal exists for this license on this install. We do NOT reject on a
    // machine-string mismatch here, because the fingerprint can legitimately
    // change (network adapter / MAC / hostname changes) on the SAME computer —
    // that previously forced needless re-activation. Copy-to-another-PC misuse
    // is prevented at activation time by the server one-device binding.
    // Heal the seal to the current (now stable, persisted) id so it stays put.
    if (seal.machine !== machineId()) {
      try { writeSeal(sealPath, v.payload.id); } catch (_) {}
    }
  }

  const now = monotonicNow(metaPath);
  return evaluate(v.payload, { now });
}

module.exports = {
  PREFIX, REMINDER_DAYS,
  machineId, setDeviceIdPath, verifyLicenseString, evaluate, getStatus,
  readLicenseFile, writeLicenseFile, clearLicenseFile, monotonicNow,
  activateOnline, isOnlineKey, readSeal, writeSeal,
  b64urlEncode, b64urlDecode,
};
