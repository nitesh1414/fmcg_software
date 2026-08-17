#!/usr/bin/env node
// ===========================================================================
// make-keys.js — generate the RightServe ed25519 license signing keypair.
// Run ONCE. Keep tools/keys/license_private.pem SECRET (never ship / commit).
// The public key is copied into the desktop app so it can verify keys offline.
// ===========================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const keysDir = path.join(__dirname, 'keys');
fs.mkdirSync(keysDir, { recursive: true });

const privPath = path.join(keysDir, 'license_private.pem');
const pubPath = path.join(keysDir, 'license_public.pem');

if (fs.existsSync(privPath) && !process.argv.includes('--force')) {
  console.error('A private key already exists at ' + privPath);
  console.error('Refusing to overwrite (this would invalidate all issued licenses).');
  console.error('Use --force only if you really want a NEW keypair.');
  process.exit(1);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
fs.writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }));

// Copy public key into the desktop app (shipped, safe to distribute).
const desktopPub = path.join(__dirname, '..', 'desktop', 'license_public.pem');
fs.copyFileSync(pubPath, desktopPub);

console.log('Keypair generated:');
console.log('  PRIVATE (keep secret): ' + privPath);
console.log('  PUBLIC  (shipped)    : ' + pubPath);
console.log('  Copied public key to : ' + desktopPub);
console.log('\nNext: mint a license with  node tools/license-gen.js --client "..." --days 365');
