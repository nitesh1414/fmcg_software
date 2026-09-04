// Demo data for the portal — talk to a RUNNING portal and fill it with clients
// that cover every license state, so the UI can be clicked through immediately.
// Dev/demo only; it never touches production unless you point it there.
//
//   npm start                # terminal 1  (portal on :4100)
//   npm run demo             # terminal 2  (fills it)
//   BASE=https://portal.example.com npm run demo
const BASE = (process.env.BASE || 'http://localhost:4100').replace(/\/+$/, '') + '/api';
const ADMIN = { username: process.env.DEMO_ADMIN || 'admin', password: process.env.DEMO_PASS || 'admin123' };

async function call(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch (_) { data = text; }
  if (!res.ok && res.status !== 409) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 160)}`);
  return { status: res.status, data };
}

(async () => {
  const login = await call('POST', '/auth/login', null, ADMIN);
  if (!login.data.token) throw new Error('Login failed — run `npm run seed` first (admin/admin123).');
  const T = login.data.token;

  const existing = (await call('GET', '/clients', T)).data;
  if (existing.length) {
    console.log(`Portal already has ${existing.length} client(s) — leaving it alone.`);
    return;
  }

  const mk = (c) => call('POST', '/clients', T, c).then((r) => r.data);
  const lic = (b) => call('POST', '/licenses', T, b).then((r) => r.data);

  // 1) desktop base + mobile add-on (co-terminating) — the classic upsell
  const c1 = await mk({ business_name: 'Sharma FMCG Distributors', contact_person: 'Rakesh Sharma', phone: '9822012345', email: 'rakesh@sharmafmcg.in', city: 'Pune', gstin: '27AABCS1429B1ZX' });
  const d1 = await lic({ client_id: c1.id, product: 'desktop', days: 365, plan: 'Premium' });
  await lic({ client_id: c1.id, product: 'mobile', kind: 'addon', matchBaseExpiry: true, plan: 'Premium' });

  // 2) desktop only, expiring soon → renewal + add-on opportunity
  const c2 = await mk({ business_name: 'Krishna Medical & General', contact_person: 'Sunita Patil', phone: '9970045678', city: 'Nashik', gstin: '27AACCK1234M1Z9' });
  await lic({ client_id: c2.id, product: 'desktop', days: 12, plan: 'Standard' });

  // 3) desktop expired → renewal due
  const c3 = await mk({ business_name: 'Annapurna Kirana Stores', contact_person: 'Ganesh Kulkarni', phone: '9011223344', city: 'Pune' });
  await lic({ client_id: c3.id, product: 'desktop', days: -5, plan: 'Standard' });

  // 4) lifetime desktop + mobile add-on
  const c4 = await mk({ business_name: 'LivePro Retail Pvt Ltd', contact_person: 'Nitesh', phone: '9404484560', city: 'Mumbai', gstin: '27AAECL1234P1ZK' });
  await lic({ client_id: c4.id, product: 'desktop', never: true, plan: 'Premium' });
  await lic({ client_id: c4.id, product: 'mobile', kind: 'addon', matchBaseExpiry: true });

  // 5) no license yet → "Generate" flow
  await mk({ business_name: 'New Horizon Traders', contact_person: 'Imran Shaikh', phone: '9890011223', city: 'Thane' });

  // pretend one client already activated their desktop key on a machine
  await call('POST', '/activate', null, { licenseId: d1.license_id, machine: 'C011-AAC8-44CF-0B59' });

  const dash = (await call('GET', '/dashboard', T)).data;
  console.log('\n  Demo data ready:');
  console.log(`    clients ${dash.counts.clients} · desktop ${dash.counts.desktop} · mobile ${dash.counts.mobile} · add-ons ${dash.counts.addons}`);
  console.log(`    renewals due ${dash.expiringSoon.length} · add-on opportunities ${dash.addonCount}`);
  console.log(`    ${d1.license_id} is activated on C011-AAC8-44CF-0B59 (try "Transfer device")\n`);
})().catch((e) => { console.error('demo failed:', e.message); process.exit(1); });
