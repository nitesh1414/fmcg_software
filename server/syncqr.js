// Pairing QR for System → Mobile App Sync.
//
// The phone's Settings → Desktop Sync → "Scan QR" reads a JSON payload that
// tells it (a) which LAN URL to call and (b) the secret API key, so pairing is
// zero-typing. The payload format is the contract documented in
// docs/06-MOBILE-SYNC.md:
//
//   { "v": 1, "app": "rightserve-sync", "url": "http://192.168.1.5:4000", "key": "rsync_…" }
//
// This module is deliberately dependency-light and free of the DB/Express so it
// can be unit-tested and reused. It renders the payload to a PNG data-URL with
// the `qrcode` package (a declared server dependency).
let QRCode = null;
try { QRCode = require('qrcode'); } catch (_) { QRCode = null; }

function pairingPayload(url, key) {
  return { v: 1, app: 'rightserve-sync', url: String(url || '').replace(/\/+$/, ''), key: String(key || '') };
}

/**
 * Build the scannable pairing QR.
 * Resolves { qrDataUrl, payload }. Rejects with a helpful message when the
 * `qrcode` package is unavailable (e.g. a partial install) so callers can fall
 * back to the "Show URL & key" path instead of crashing.
 */
async function buildPairingQr(url, key, opts = {}) {
  if (!QRCode) {
    throw new Error('QR support missing — run `npm install` in the server folder (installs the "qrcode" package).');
  }
  if (!url) throw new Error('No URL to encode in the QR.');
  if (!key) throw new Error('No sync key to encode in the QR — enable Mobile Sync first.');
  const payload = pairingPayload(url, key);
  const qrDataUrl = await QRCode.toDataURL(JSON.stringify(payload), {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: opts.width || 480,
    color: { dark: '#000000', light: '#ffffff' },
  });
  return { qrDataUrl, payload, url: payload.url, key: payload.key };
}

module.exports = { buildPairingQr, pairingPayload };
