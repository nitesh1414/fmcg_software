// Portal UI integration test — runs the REAL React app in jsdom against the
// REAL portal API (its own throwaway SQLite DB). It logs in, lists clients,
// sells a mobile add-on on top of a desktop license, edits + deletes a license,
// and edits/deletes a user.
//
//   cd portal/client && npm test
// (builds the test bundle with vite, then drives it in jsdom)
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const BUNDLE = path.resolve(HERE, '..', 'dist-test', 'ui-entry.js');
// resolve the portal SERVER's modules (and their deps) from the server package
const req = createRequire(path.resolve(HERE, '..', '..', 'server', 'index.js'));
const bcrypt = req('bcryptjs');

let assertionCount = 0;
const assert_ = new Proxy(assert, {
  get(t, p) {
    const v = t[p];
    if (typeof v !== 'function') return v;
    return (...a) => { assertionCount++; return v.apply(t, a); };
  },
});

// ---------------------------------------------------------------- test server
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-portal-ui-'));
process.env.PORTAL_DB_PATH = path.join(TMP, 'portal.db');
process.env.PORTAL_JWT_SECRET = 'ui-test-secret';

const { createApp } = req('./index.js');
const db = req('./db.js');
const insUser = db.prepare('INSERT INTO users (name,username,email,phone,password_hash,role) VALUES (?,?,?,?,?,?)');
insUser.run('Portal Admin', 'admin', 'a@x.in', '', bcrypt.hashSync('admin123', 8), 'admin');
insUser.run('Ravi Sales', 'sales1', 's@x.in', '', bcrypt.hashSync('sales123', 8), 'sales');

const server = await new Promise((resolve) => {
  const s = createApp().listen(0, '127.0.0.1', () => resolve(s));
});
const API = `http://127.0.0.1:${server.address().port}`;
const nodeFetch = globalThis.fetch;
const api = async (method, p, token, body) => {
  const r = await nodeFetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch (_) { d = t; }
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${t.slice(0, 160)}`);
  return d;
};

const admin = await api('POST', '/api/auth/login', null, { username: 'admin', password: 'admin123' });
const sales = await api('POST', '/api/auth/login', null, { username: 'sales1', password: 'sales123' });

// ------------------------------------------------------------------ test data
const c1 = await api('POST', '/api/clients', sales.token, {
  business_name: 'Sharma FMCG Distributors', contact_person: 'Rakesh', phone: '9822012345', city: 'Pune',
});
const desktop = await api('POST', '/api/licenses', sales.token, { client_id: c1.id, product: 'desktop', days: 365, plan: 'Standard' });
await api('POST', '/api/clients', sales.token, { business_name: 'New Horizon Traders', city: 'Thane' });
const c2 = await api('POST', '/api/clients', sales.token, { business_name: 'Deep Link Stores', city: 'Nanded' });
const c2desk = await api('POST', '/api/licenses', sales.token, { client_id: c2.id, product: 'desktop', days: 200 });

// --------------------------------------------------------------------- jsdom
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/clients', pretendToBeVisual: true,
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
// node 22 ships a read-only globalThis.navigator — replace it with jsdom's
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true });
globalThis.localStorage = window.localStorage;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.MouseEvent = window.MouseEvent;
globalThis.KeyboardEvent = window.KeyboardEvent;
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// the app calls fetch('/api/...') — point relative URLs at the test server
// the app calls fetch('/api/...') — point those relative URLs at the test server
globalThis.fetch = (u, o) => nodeFetch(new URL(u, API).toString(), o);

window.localStorage.setItem('rs_portal_token', admin.token);

// React logs "not wrapped in act" noise for updates that land between settles;
// the harness is a thin jsdom driver, so keep the output readable.
const realError = console.error;
console.error = (...a) => {
  const msg = String(a[0] || '');
  if (msg.includes('not wrapped in act') || msg.includes('wrap-tests-with-act') ||
      msg.includes('ReactDOMTestUtils.act') || msg.includes('React Router Future Flag')) return;
  realError(...a);
};

if (!fs.existsSync(BUNDLE)) {
  console.error('missing bundle — run: npm run build:test');
  process.exit(1);
}
const ui = await import(pathToFileURL(BUNDLE).href);

try {
  // ------------------------------------------------ clients list + add-on flow
  await ui.mount('/clients');
  assert_.ok(ui.text().includes('Sharma FMCG Distributors'), 'client list renders the client');
  assert_.ok(ui.text().includes('New Horizon Traders'), 'client list renders every client');
  assert_.ok(ui.text().includes('Desktop'), 'the licensed product is tagged');
  assert_.ok(ui.count('.menu-btn') === 1, 'mobile menu button is in the markup');
  assert_.strictEqual(ui.cellsMissingLabel(), 0, 'every table cell has a data-label for the stacked mobile view');

  // drawer navigation (phone layout)
  await ui.clickSelector('.menu-btn');
  assert_.strictEqual(ui.attr('.app', 'data-nav'), 'open', 'the hamburger opens the nav drawer');
  assert_.ok(ui.count('.scrim') === 1, 'a backdrop sits behind the drawer');
  await ui.clickSelector('.scrim');
  assert_.strictEqual(ui.attr('.app', 'data-nav'), 'closed', 'tapping the backdrop closes the drawer');

  // every screen must label its table cells so the stacked phone view reads well
  for (const p of ['/', '/clients', '/generate', '/users']) {
    await ui.mount(p);
    assert_.strictEqual(ui.cellsMissingLabel(), 0, `no unlabelled table cells on ${p}`);
  }

  // 2) one tap from the dashboard: ?focus=<client>&add=mobile opens the add-on form
  await ui.mount('/clients?focus=' + c2.id + '&add=mobile');
  assert_.match(ui.modalTitle(), /Add-on License/, 'the add-on deep link opens the add-on form');
  assert_.ok(ui.modalText().includes(c2desk.license_id), 'the add-on form is pre-loaded with the base license');
  assert_.ok(ui.modalText().includes('Deep Link Stores'), 'the add-on form names the client');
  await ui.clickText('Cancel');

  await ui.mount('/clients');
  // sell mobile on top of the existing desktop license
  await ui.clickRowButton('Sharma FMCG Distributors', '+ Mobile');
  assert_.match(ui.modalTitle(), /Add-on License/, 'the add-on form opens');
  assert_.ok(ui.modalText().includes(desktop.license_id), 'the add-on form shows the base license it hangs off');
  assert_.strictEqual(ui.checked('End on the same day'), true, 'co-terminate is on by default');
  await ui.clickText('Issue Add-on Key');
  assert_.ok(ui.text().includes('Mobile app'), 'the mobile key is shown to send to the client');
  assert_.ok(ui.modalText().includes('RSL1.'), 'a signed key string is displayed');
  await ui.clickText('Done');

  // the client now runs both products
  await ui.mount('/clients');
  assert_.ok(ui.html().includes('Mobile'), 'the client row now shows the mobile product');

  // ------------------------------------------------------- client detail sheet
  await ui.mount('/clients?focus=' + c1.id);
  assert_.match(ui.modalTitle(), /Sharma FMCG/, 'the client detail sheet opens from a deep link');
  assert_.ok(ui.text().includes('Licenses by product'), 'licenses are grouped by product');
  for (const label of ['Edit client', 'Delete client', 'Renew', 'Edit', 'Delete', 'Key']) {
    assert_.ok(ui.text().includes(label), `client detail offers "${label}"`);
  }

  // ------------------------------------------------------------- license edit
  await ui.clickRowButton(desktop.license_id, 'Edit');
  assert_.match(ui.modalTitle(), /Edit License/, 'the license edit form opens');
  await ui.typeInField('Plan', 'Premium');
  assert_.ok(ui.modalText().includes('NEW key will be generated'), 'the form warns that the key is re-issued');
  await ui.clickText('Save Changes');
  assert_.ok(ui.modalText().includes('Desktop app') && ui.modalText().includes('RSL1.'), 'the re-issued key is shown');
  const edited = await api('GET', '/api/licenses/' + desktop.id + '/key', admin.token);
  assert_.notStrictEqual(edited.license_key, desktop.license_key, 'the stored key really changed');
  assert_.strictEqual(edited.license_id, desktop.license_id, 'the license id is unchanged');
  await ui.clickText('Done');

  // ------------------------------------------------------------ license delete
  await ui.mount('/clients?focus=' + c1.id);
  await ui.clickRowButton(desktop.license_id, 'Delete');
  assert_.match(ui.modalTitle(), new RegExp('Delete ' + desktop.license_id), 'license delete asks for confirmation');
  await ui.clickText('Delete license');
  const left = await api('GET', '/api/clients/' + c1.id, admin.token);
  assert_.ok(!left.history.some((l) => l.id === desktop.id), 'the license row is gone from the API');

  // -------------------------------------------------------------- client delete
  await ui.mount('/clients');
  await ui.clickRowButton('Sharma FMCG Distributors', 'Delete');
  assert_.match(ui.modalTitle(), /Delete Sharma FMCG/, 'client delete asks for confirmation');
  await ui.clickText('Delete client');                       // has licenses → needs a second confirm
  assert_.ok(ui.modalText().includes('Delete client & licenses'), 'the forced delete step is offered');
  await ui.clickText('Delete client & licenses');
  const after = await api('GET', '/api/clients', admin.token);
  assert_.ok(!after.some((c) => c.id === c1.id), 'the client is deleted');

  // --------------------------------------------------------------- user edit/del
  await ui.mount('/users');
  assert_.ok(ui.text().includes('Ravi Sales'), 'sales team lists the salesperson');
  await ui.clickRowButton('Ravi Sales', 'Edit');
  assert_.match(ui.modalTitle(), /Edit User/, 'the user edit form opens');
  await ui.typeInField('Full Name', 'Ravi Kumar');
  await ui.clickText('Save Changes');
  assert_.ok(ui.text().includes('Ravi Kumar'), 'the renamed user shows in the list');

  await ui.clickRowButton('Ravi Kumar', 'Delete');
  assert_.match(ui.modalTitle(), /Delete Ravi Kumar/, 'user delete asks for confirmation');
  assert_.ok(ui.modalText().includes('Hand their clients'), 'the delete dialog offers to reassign their clients');
  await ui.typeInField('Hand their clients', '1');            // → the admin
  await ui.clickText('Delete user');
  assert_.ok(!ui.text().includes('Ravi Kumar'), 'the user is removed from the list');
  const users = await api('GET', '/api/users', admin.token);
  assert_.strictEqual(users.length, 1, 'only the admin is left');

  // ------------------------------------------------------------------- logged out
  await ui.unmount();
  window.localStorage.removeItem('rs_portal_token');
  await ui.mount('/login');
  assert_.ok(ui.text().includes('RightServe Portal'), 'the login screen renders without a session');

  console.log(`\n  ✓ portal ui: ${assertionCount} assertions passed (real React app in jsdom + real API)\n`);
} catch (e) {
  console.error('\n  ✗ portal ui test failed:', e && e.message);
  console.error('\n  page text was:\n  ' + ui.text().slice(0, 1200));
  process.exitCode = 1;
} finally {
  server.close();
  db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
}
