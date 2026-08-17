#!/usr/bin/env node
// ===========================================================================
// license-gen.js — RightServe license key generator (RUN PRIVATELY ONLY)
// ---------------------------------------------------------------------------
// Mints a signed license block that the RightServe desktop app verifies
// offline with its embedded public key. Keep tools/keys/license_private.pem
// SECRET — anyone with it can mint keys.
//
// Usage:
//   node tools/license-gen.js --client "Sharma FMCG" --days 365
//   node tools/license-gen.js --client "ABC Traders" --expires 2027-03-31
//   node tools/license-gen.js --client "VIP Client" --never            # perpetual
//   node tools/license-gen.js --client "XYZ" --days 365 \
//        --machine 1A2B-3C4D-5E6F-7A8B    # lock to one computer
//
// Options:
//   --client   <name>      Client / business name (shown in app)            [required]
//   --days     <n>         Valid for N days from today
//   --expires  <YYYY-MM-DD>Explicit expiry date (overrides --days)
//   --never                Perpetual license (never expires)
//   --machine  <ID>        Lock to a Machine ID (from the app's activation screen)
//   --plan     <text>      Plan label e.g. "Standard", "Premium"           [optional]
//   --reminder <n>         Days before expiry to start reminding (default 15)
//   --notes    <text>      Free notes stored in the license                [optional]
//   --key      <path>      Private key PEM (default tools/keys/license_private.pem)
//   --out      <path>      Also write the license block to a file
// ===========================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--never') { a.never = true; continue; }
    if (t.startsWith('--')) {
      const k = t.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      a[k] = v;
    }
  }
  return a;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function isoDate(d) { return d.toISOString().slice(0, 10); }

function main() {
  const a = parseArgs(process.argv);
  if (!a.client) {
    console.error('ERROR: --client "<name>" is required.\n');
    console.error('Example: node tools/license-gen.js --client "Sharma FMCG" --days 365');
    process.exit(1);
  }

  const keyPath = a.key || path.join(__dirname, 'keys', 'license_private.pem');
  if (!fs.existsSync(keyPath)) {
    console.error('ERROR: private key not found at ' + keyPath);
    console.error('Generate one with: node tools/make-keys.js');
    process.exit(1);
  }
  const privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath));

  // Resolve expiry
  let expires = null; // null = perpetual
  if (a.never) {
    expires = null;
  } else if (a.expires) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.expires)) { console.error('ERROR: --expires must be YYYY-MM-DD'); process.exit(1); }
    expires = a.expires;
  } else if (a.days) {
    const d = new Date();
    d.setDate(d.getDate() + parseInt(a.days, 10));
    expires = isoDate(d);
  } else {
    console.error('ERROR: specify --days N, --expires YYYY-MM-DD, or --never');
    process.exit(1);
  }

  const payload = {
    v: 1,
    id: 'RS-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
    client: String(a.client),
    plan: a.plan ? String(a.plan) : 'Standard',
    issued: isoDate(new Date()),
    expires, // null => perpetual
    machine: a.machine ? String(a.machine).toUpperCase() : null, // null => any PC
    reminderDays: a.reminder ? parseInt(a.reminder, 10) : 15,
    notes: a.notes ? String(a.notes) : '',
    // One-time online activation. Pass --activation-url <portal> to make the
    // key claim itself online (binds to one device). Use --offline to opt out
    // (CLI keys default to OFFLINE so existing manual keys keep working).
    online: a.activationUrl || a['activation-url'] ? true : (a.online ? true : false),
    act: a.activationUrl || a['activation-url'] || '',
  };

  const payloadBuf = Buffer.from(JSON.stringify(payload), 'utf8');
  const sig = crypto.sign(null, payloadBuf, privateKey);
  const licenseBlock = `RSL1.${b64url(payloadBuf)}.${b64url(sig)}`;

  console.log('\n=== RightServe License Generated ===');
  console.log('License ID : ' + payload.id);
  console.log('Client     : ' + payload.client);
  console.log('Plan       : ' + payload.plan);
  console.log('Issued     : ' + payload.issued);
  console.log('Expires    : ' + (payload.expires || 'NEVER (perpetual)'));
  console.log('Machine    : ' + (payload.machine || 'ANY computer'));
  console.log('Reminder   : ' + payload.reminderDays + ' days before expiry');
  if (payload.notes) console.log('Notes      : ' + payload.notes);
  console.log('\n--- LICENSE KEY (send this to the client) ---\n');
  console.log(licenseBlock);
  console.log('\n---------------------------------------------\n');

  if (a.out) {
    fs.writeFileSync(a.out, licenseBlock + '\n', 'utf8');
    console.log('Saved to: ' + a.out + '\n');
  }
}

main();
