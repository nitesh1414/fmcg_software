'use strict';
// Portal API smoke test — boots the real Express app against a throwaway SQLite
// file and walks the license lifecycle: base license → mobile add-on → edit
// (re-issue) → renew → revoke/restore → delete, plus client & user edit/delete.
//
//   cd portal/server && npm test
// Count every assertion that actually runs, so the summary line is real.
let assertionCount = 0;
const assert = new Proxy(require('assert'), {
  get(target, prop) {
    const v = target[prop];
    if (typeof v !== 'function') return v;
    return (...args) => { assertionCount++; return v.apply(target, args); };
  },
});
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-portal-test-'));
const DB = path.join(TMP, 'portal.db');
process.env.PORTAL_DB_PATH = DB;
process.env.PORTAL_JWT_SECRET = 'test-secret';

const { createApp } = require('./index');
const db = require('./db');

// --- seed two admins + one salesperson ---------------------------------------
const insUser = db.prepare(
  'INSERT INTO users (name,username,email,phone,password_hash,role) VALUES (?,?,?,?,?,?)'
);
insUser.run('Admin One', 'admin', 'a@x.in', '', bcrypt.hashSync('admin123', 8), 'admin');
insUser.run('Admin Two', 'admin2', 'a2@x.in', '', bcrypt.hashSync('admin123', 8), 'admin');
insUser.run('Sales One', 'sales1', 's@x.in', '', bcrypt.hashSync('sales123', 8), 'sales');

let base;
let adminTok, salesTok;

async function call(method, url, { token, body } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch (_) { data = text; }
  return { status: res.status, data };
}
const as = (token) => ({
  get: (u) => call('GET', u, { token }),
  post: (u, b) => call('POST', u, { token, body: b || {} }),
  put: (u, b) => call('PUT', u, { token, body: b || {} }),
  del: (u) => call('DELETE', u, { token }),
});

async function main() {
  const server = await new Promise((resolve) => {
    const s = createApp().listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;

  // ---- auth -----------------------------------------------------------------
  const login = await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin123' } });
  assert.strictEqual(login.status, 200, 'admin login');
  adminTok = login.data.token;
  const slogin = await call('POST', '/api/auth/login', { body: { username: 'sales1', password: 'sales123' } });
  salesTok = slogin.data.token;
  assert.ok(adminTok && salesTok, 'both tokens issued');
  const loggedIn = db.prepare('SELECT last_login_at FROM users WHERE username=?').get('admin');
  assert.ok(loggedIn.last_login_at.length > 10, 'login stamps last_login_at');

  const A = as(adminTok), S = as(salesTok);

  // ---- client create/edit ----------------------------------------------------
  const c1 = await S.post('/api/clients', { business_name: 'Sharma FMCG', phone: '9000000001', city: 'Pune' });
  assert.strictEqual(c1.status, 200, 'sales creates client');
  assert.deepStrictEqual(c1.data.products, [], 'new client owns no product');
  assert.deepStrictEqual(c1.data.missing_products, ['desktop', 'mobile'], 'both products missing');
  const clientId = c1.data.id;

  const cEdit = await S.put('/api/clients/' + clientId, { contact_person: 'Rakesh', gstin: '27abcde1234f1z5' });
  assert.strictEqual(cEdit.status, 200, 'client edit');
  assert.strictEqual(cEdit.data.contact_person, 'Rakesh', 'contact saved');
  assert.strictEqual(cEdit.data.gstin, '27ABCDE1234F1Z5', 'gstin upper-cased');

  // admin sees it, other sales do not
  const allForAdmin = await A.get('/api/clients');
  assert.ok(allForAdmin.data.some((c) => c.id === clientId), 'admin sees all clients');

  // ---- base desktop license ---------------------------------------------------
  const dup0 = await S.post('/api/licenses', { client_id: clientId, product: 'desktop', days: 365 });
  assert.strictEqual(dup0.status, 200, 'base desktop license issued');
  assert.strictEqual(dup0.data.product, 'desktop');
  assert.strictEqual(dup0.data.kind, 'base');
  assert.ok(/^RSL1\./.test(dup0.data.license_key), 'signed key returned');
  const desktopId = dup0.data.id;
  const desktopLicId = dup0.data.license_id;
  const baseExpires = dup0.data.expires;

  const dup = await S.post('/api/licenses', { client_id: clientId, product: 'desktop', days: 365 });
  assert.strictEqual(dup.status, 409, 'second desktop key blocked');
  assert.strictEqual(dup.data.code, 'PRODUCT_ALREADY_LICENSED');
  const forced = await S.post('/api/licenses', { client_id: clientId, product: 'desktop', days: 30, force: true });
  assert.strictEqual(forced.status, 200, 'force=true allowed');
  await A.del('/api/licenses/' + forced.data.id); // tidy

  // ---- mobile ADD-ON (bought desktop first, mobile later) ----------------------
  const noBase = await S.post('/api/clients', { business_name: 'Solo Traders' });
  const orphan = await S.post('/api/licenses', { client_id: noBase.data.id, product: 'mobile', kind: 'addon' });
  assert.strictEqual(orphan.status, 409, 'add-on without a base license is refused');
  assert.strictEqual(orphan.data.code, 'NO_BASE_LICENSE');

  const addon = await S.post('/api/licenses', {
    client_id: clientId, product: 'mobile', kind: 'addon', matchBaseExpiry: true, plan: 'Standard',
  });
  assert.strictEqual(addon.status, 200, 'mobile add-on issued');
  assert.strictEqual(addon.data.kind, 'addon', 'marked as add-on');
  assert.strictEqual(addon.data.product, 'mobile');
  assert.strictEqual(addon.data.parent_id, desktopId, 'add-on hangs off the desktop base license');
  assert.strictEqual(addon.data.expires, baseExpires, 'add-on co-terminates with the base license');
  assert.notStrictEqual(addon.data.license_key, dup0.data.license_key, 'add-on has its own key');
  const mobileId = addon.data.id;

  // add-on for a product they already own is refused
  const addonDup = await S.post('/api/licenses', { client_id: clientId, product: 'mobile', kind: 'addon' });
  assert.strictEqual(addonDup.status, 409, 'duplicate mobile add-on blocked');

  const detail = await S.get('/api/clients/' + clientId);
  assert.deepStrictEqual(detail.data.products, ['desktop', 'mobile'], 'client now runs both products');
  assert.deepStrictEqual(detail.data.missing_products, [], 'nothing missing');
  assert.ok(detail.data.licenses.desktop && detail.data.licenses.mobile, 'per-product live licenses exposed');
  assert.strictEqual(detail.data.history.length, 2, 'history holds both keys');

  // ---- "both" issues one key per product, skipping what they already own -------
  const both = await S.post('/api/licenses', { client_id: clientId, product: 'both', days: 30 });
  assert.strictEqual(both.status, 409, 'both products already owned → refused');
  assert.strictEqual(both.data.code, 'PRODUCT_ALREADY_LICENSED');

  const fresh = await S.post('/api/clients', { business_name: 'Bundle Buyers' });
  const bundle = await S.post('/api/licenses', { client_id: fresh.data.id, product: 'both', days: 180 });
  assert.strictEqual(bundle.status, 200, 'bundle issues keys');
  assert.strictEqual(bundle.data.licenses.length, 2, 'one key per product');
  assert.deepStrictEqual(bundle.data.licenses.map((l) => l.product).sort(), ['desktop', 'mobile']);
  assert.strictEqual(bundle.data.licenses[0].expires, bundle.data.licenses[1].expires, 'same term for both keys');
  const halfOwned = await S.post('/api/licenses', { client_id: fresh.data.id, product: 'both', days: 60 });
  assert.strictEqual(halfOwned.status, 409, 'nothing left to add for this client');
  assert.deepStrictEqual(halfOwned.data.skipped, ['desktop', 'mobile'], 'it reports what was skipped');

  // ---- edit a license (re-issues the key, keeps the id) ------------------------
  const newExpiry = new Date(Date.now() + 400 * 86400000).toISOString().slice(0, 10);
  const edited = await S.put('/api/licenses/' + desktopId, { expires: newExpiry, plan: 'Premium', notes: 'corrected term' });
  assert.strictEqual(edited.status, 200, 'license edit');
  assert.strictEqual(edited.data.reissued, true, 'edit re-issues the key');
  assert.strictEqual(edited.data.license.license_id, desktopLicId, 'license id preserved');
  assert.strictEqual(edited.data.license.plan, 'Premium');
  assert.strictEqual(edited.data.license.expires, newExpiry);
  assert.notStrictEqual(edited.data.license_key, dup0.data.license_key, 'a fresh key string was minted');

  const notesOnly = await S.put('/api/licenses/' + desktopId, { notes: 'just a note' });
  assert.strictEqual(notesOnly.data.reissued, false, 'notes-only edit does NOT re-issue the key');
  assert.strictEqual(notesOnly.data.license_key, edited.data.license_key, 'key untouched');

  const keys = await S.get('/api/licenses/' + desktopId + '/keys');
  assert.strictEqual(keys.status, 200, 'key history readable');
  assert.strictEqual(keys.data.history.length, 1, 'old key archived once');
  assert.strictEqual(keys.data.history[0].license_key, dup0.data.license_key, 'archived key is the original');

  // editing to a machine lock resets the activation binding
  const lockEdit = await S.put('/api/licenses/' + desktopId, { machine: 'c011-aac8-44cf-0b59' });
  assert.strictEqual(lockEdit.data.reissued, true, 'machine lock re-issues the key');
  assert.strictEqual(lockEdit.data.license.machine, 'C011-AAC8-44CF-0B59', 'machine stored upper-cased');
  assert.strictEqual(lockEdit.data.activation_reset, true);

  // ---- activation binding ------------------------------------------------------
  // machine-locked key: only the locked device may activate it
  const actLocked = await call('POST', '/api/activate', { body: { licenseId: desktopLicId, machine: 'AAAA-BBBB-CCCC-DDDD' } });
  assert.strictEqual(actLocked.status, 403, 'machine-locked key rejects another device');
  const actOk = await call('POST', '/api/activate', { body: { licenseId: desktopLicId, machine: 'C011-AAC8-44CF-0B59' } });
  assert.strictEqual(actOk.status, 200, 'the locked machine activates');

  // unlocked key: first device binds it, any other device is refused
  const mobileLicId = addon.data.license_id;
  const bind = await call('POST', '/api/activate', { body: { licenseId: mobileLicId, machine: 'AAAA-BBBB-CCCC-DDDD' } });
  assert.strictEqual(bind.status, 200, 'first device binds the key');
  const other = await call('POST', '/api/activate', { body: { licenseId: mobileLicId, machine: 'EEEE-1111-2222-3333' } });
  assert.strictEqual(other.status, 409, 'a second device is refused');
  assert.strictEqual(other.data.code, 'ALREADY_ACTIVATED');
  const reset = await S.post('/api/licenses/' + mobileId + '/reset-activation');
  assert.strictEqual(reset.status, 200, 'activation can be transferred');
  const rebound = await call('POST', '/api/activate', { body: { licenseId: mobileLicId, machine: 'EEEE-1111-2222-3333' } });
  assert.strictEqual(rebound.status, 200, 'the new device activates after the transfer');

  const activated = await S.del('/api/licenses/' + desktopId);
  assert.strictEqual(activated.status, 403, 'owner cannot delete an activated license');
  const adminNoForce = await A.del('/api/licenses/' + desktopId);
  assert.strictEqual(adminNoForce.status, 409, 'admin must confirm deleting an activated license');
  assert.strictEqual(adminNoForce.data.code, 'ACTIVATED');

  // ---- renew keeps the add-on relationship ------------------------------------
  const renewed = await S.post('/api/licenses/' + mobileId + '/renew', { days: 365, carryOver: true });
  assert.strictEqual(renewed.status, 200, 'mobile add-on renewed');
  assert.strictEqual(renewed.data.kind, 'addon', 'renewal stays an add-on');
  assert.strictEqual(renewed.data.product, 'mobile');
  assert.ok(renewed.data.carriedDays >= 0, 'carry-over reported');
  const oldMobile = db.prepare('SELECT status,superseded_by FROM licenses WHERE id=?').get(mobileId);
  assert.strictEqual(oldMobile.status, 'renewed', 'old mobile key superseded');
  assert.strictEqual(oldMobile.superseded_by, renewed.data.id, 'superseded_by points at the renewal');

  // ---- revoke / restore --------------------------------------------------------
  const rev = await A.post('/api/licenses/' + renewed.data.id + '/revoke');
  assert.strictEqual(rev.status, 200, 'admin revokes');
  const revokedAct = await call('POST', '/api/activate', { body: { licenseId: renewed.data.license_id, machine: 'ZZZZ' } });
  assert.strictEqual(revokedAct.status, 403, 'revoked key will not activate');
  const salesRevoke = await S.post('/api/licenses/' + renewed.data.id + '/revoke');
  assert.strictEqual(salesRevoke.status, 403, 'sales cannot revoke');
  const restored = await A.post('/api/licenses/' + renewed.data.id + '/restore');
  assert.strictEqual(restored.status, 200, 'admin restores');

  // ---- users: edit, guards, delete --------------------------------------------
  const users = await A.get('/api/users');
  const salesUser = users.data.find((u) => u.username === 'sales1');
  assert.strictEqual(typeof salesUser.client_count, 'number', 'client_count exposed');
  assert.strictEqual(typeof salesUser.license_count, 'number', 'license_count exposed');

  const userEdit = await A.put('/api/users/' + salesUser.id, { name: 'Sales Renamed', email: 'new@x.in', username: 'sales1b' });
  assert.strictEqual(userEdit.status, 200, 'user edit');
  assert.strictEqual(userEdit.data.name, 'Sales Renamed');
  assert.strictEqual(userEdit.data.username, 'sales1b');
  const dupUser = await A.put('/api/users/' + salesUser.id, { username: 'admin' });
  assert.strictEqual(dupUser.status, 409, 'username collision refused');

  const admin2 = users.data.find((u) => u.username === 'admin2');
  const selfDemote = await A.put('/api/users/' + users.data.find((u) => u.username === 'admin').id, { role: 'sales' });
  assert.strictEqual(selfDemote.status, 400, 'admin cannot demote themselves');
  const selfDel = await A.del('/api/users/' + users.data.find((u) => u.username === 'admin').id);
  assert.strictEqual(selfDel.status, 400, 'admin cannot delete themselves');
  const delAdmin2 = await A.del('/api/users/' + admin2.id);
  assert.strictEqual(delAdmin2.status, 200, 'second admin deletable');

  // another admin CAN be demoted (the caller is still an admin)
  const promoted = await A.post('/api/users', { name: 'Tmp Admin', username: 'tmpadmin', password: 'x1234', role: 'admin' });
  assert.strictEqual(promoted.status, 200, 'second admin created');
  const demoteOther = await A.put('/api/users/' + promoted.data.id, { role: 'sales' });
  assert.strictEqual(demoteOther.status, 200, 'another admin can be demoted while one admin remains');
  assert.strictEqual(demoteOther.data.role, 'sales');

  // delete the salesperson and hand their clients to an admin
  const adminRow = users.data.find((u) => u.username === 'admin');
  const delUser = await A.del('/api/users/' + salesUser.id + '?reassign_to=' + adminRow.id);
  assert.strictEqual(delUser.status, 200, 'user deleted');
  assert.ok(delUser.data.clients >= 1, 'client count reported');
  const moved = db.prepare('SELECT created_by FROM clients WHERE id=?').get(clientId);
  assert.strictEqual(moved.created_by, adminRow.id, 'clients reassigned to the chosen user');

  // ---- client delete policy -----------------------------------------------------
  const c2 = await A.post('/api/clients', { business_name: 'Empty Client' });
  const softDel = await A.del('/api/clients/' + clientId);
  assert.strictEqual(softDel.status, 409, 'client with licenses needs confirmation');
  assert.strictEqual(softDel.data.code, 'HAS_LICENSES');
  const emptyDel = await A.del('/api/clients/' + c2.data.id);
  assert.strictEqual(emptyDel.status, 200, 'client without licenses deletes cleanly');
  const forcedDel = await A.del('/api/clients/' + clientId + '?force=1');
  assert.strictEqual(forcedDel.status, 200, 'forced client delete');
  assert.ok(forcedDel.data.deleted_licenses >= 2, 'license history removed with the client');
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM licenses WHERE client_id=?').get(clientId).n, 0,
    'licenses cascaded away');

  const tmpAdminRow = db.prepare('SELECT id FROM users WHERE username=?').get('tmpadmin');
  const delTmp = await A.del('/api/users/' + tmpAdminRow.id);
  assert.strictEqual(delTmp.status, 200, 'tmp admin deleted');

  // ---- the DESKTOP APP must accept what this portal mints -------------------
  // (the portal signs with the same ed25519 key the desktop app ships)
  const desktop = require('../../desktop/license.js');
  const pub = fs.readFileSync(path.join(__dirname, '..', '..', 'desktop', 'license_public.pem'), 'utf8');

  const vDesk = desktop.verifyLicenseString(lockEdit.data.license_key, pub);
  assert.strictEqual(vDesk.valid, true, 'desktop app verifies a portal-minted key offline');
  assert.strictEqual(vDesk.payload.kind, 'base', 'the base/add-on kind travels inside the key');
  const evDesk = desktop.evaluate(vDesk.payload, { machineId: 'C011-AAC8-44CF-0B59' });
  assert.strictEqual(evDesk.state, 'active', 'the locked desktop key activates its machine');
  assert.strictEqual(desktop.evaluate(vDesk.payload, { machineId: 'OTHER' }).state, 'invalid',
    'the same key is refused on another machine');

  const vMob = desktop.verifyLicenseString(addon.data.license_key, pub);
  assert.strictEqual(vMob.valid, true, 'mobile add-on key is a valid signed key');
  assert.strictEqual(vMob.payload.kind, 'addon', 'the add-on is marked in the key');
  assert.strictEqual(vMob.payload.parent, desktopLicId, 'the add-on names the license it hangs off');
  assert.strictEqual(desktop.evaluate(vMob.payload, { machineId: 'C011-AAC8-44CF-0B59' }).state, 'invalid',
    'the desktop app still refuses a mobile key');

  server.close();
  console.log(`\n  ✓ portal api: ${assertionCount} assertions passed\n`);
  fs.rmSync(TMP, { recursive: true, force: true });
}

main().catch((e) => {
  console.error('\n  ✗ portal api test failed:', e && e.message);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  process.exit(1);
});
