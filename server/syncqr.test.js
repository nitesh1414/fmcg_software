'use strict';
// Pairing-QR smoke test: the Mobile Sync QR must encode the documented
// rightserve-sync payload and come back as a scannable PNG data URL.
//   cd server && node syncqr.test.js
const assert = require('assert');
const { buildPairingQr, pairingPayload } = require('./syncqr');

(async () => {
  const url = 'http://192.168.1.5:4000';
  const key = 'rsync_0123456789abcdef';

  const payload = pairingPayload(url, key);
  assert.strictEqual(payload.v, 1);
  assert.strictEqual(payload.app, 'rightserve-sync');
  assert.strictEqual(payload.url, url);
  assert.strictEqual(payload.key, key);

  const qr = await buildPairingQr(url, key);
  assert.ok(qr.qrDataUrl.startsWith('data:image/png;base64,'), 'QR is a PNG data URL');
  assert.ok(qr.qrDataUrl.length > 2000, 'QR image has real content (not a stub)');
  assert.strictEqual(qr.payload.app, 'rightserve-sync');

  // trailing slash on the URL is normalised away (matches the pairing contract)
  const qr2 = await buildPairingQr(url + '/', key);
  assert.strictEqual(qr2.payload.url, url, 'trailing slash trimmed');

  // missing inputs reject cleanly instead of throwing later
  await assert.rejects(() => buildPairingQr('', key), /No URL/);
  await assert.rejects(() => buildPairingQr(url, ''), /No sync key/);

  console.log('syncqr tests ok');
})().catch((e) => { console.error('syncqr test failed:', e && e.message); process.exit(1); });
