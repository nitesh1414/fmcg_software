// License generation, add-ons, renewal, edits & deletion.
// Salespeople can manage licenses for their own clients; admin for any client.
// The signed key is stored so it can be re-shown / re-sent at any time.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../auth');
const { generateLicense } = require('../licensing');
const { licenseStatus, dayDiff } = require('../status');
const { decorate, licenseSummary, liveForProduct, findBaseFor, normProduct, normKind, PRODUCTS } = require('../view');

const router = express.Router();
router.use(authRequired);

const isAdmin = (req) => req.user.role === 'admin';

function canTouchClient(req, client) {
  return client && (isAdmin(req) || client.created_by === req.user.id);
}

function clientOf(lic) {
  return lic ? db.prepare('SELECT * FROM clients WHERE id=?').get(lic.client_id) : null;
}

// 'both' mints one key per product — activation binds a single device, so a
// bundle is always two keys for the same client.
function productsFromBody(product) {
  const p = String(product || 'desktop').toLowerCase();
  if (p === 'both' || p === 'bundle' || p === 'desktop+mobile') return ['desktop', 'mobile'];
  if (p === 'mobile') return ['mobile'];
  return ['desktop'];
}

const clientRows = (clientId) => db.prepare(
  'SELECT * FROM licenses WHERE client_id=? ORDER BY datetime(created_at) DESC, id DESC'
).all(clientId);

function insertLicense(client, gen, req, extra = {}) {
  const info = db.prepare(`
    INSERT INTO licenses (license_id,client_id,plan,product,kind,parent_id,issued,expires,perpetual,machine,reminder_days,notes,license_key,carried_days,created_by)
    VALUES (@license_id,@client_id,@plan,@product,@kind,@parent_id,@issued,@expires,@perpetual,@machine,@reminder_days,@notes,@license_key,@carried_days,@created_by)
  `).run({
    license_id: gen.payload.id, client_id: client.id, plan: gen.payload.plan,
    product: gen.payload.product || 'desktop',
    kind: gen.payload.kind || 'base', parent_id: extra.parent_id || null,
    issued: gen.payload.issued, expires: gen.payload.expires, perpetual: gen.payload.expires ? 0 : 1,
    machine: gen.payload.machine || '', reminder_days: gen.payload.reminderDays,
    notes: gen.payload.notes || '', license_key: gen.licenseKey,
    carried_days: extra.carried_days || 0, created_by: req.user.id,
  });
  return decorate(db.prepare('SELECT * FROM licenses WHERE id=?').get(info.lastInsertRowid));
}

function mintOpts(client, b, product, extra = {}) {
  return {
    client: client.business_name,
    plan: b.plan, days: b.days, expires: b.expires, never: !!b.never,
    machine: b.machine, reminderDays: b.reminderDays, notes: b.notes,
    product,
    kind: extra.kind || 'base',
    parentId: extra.parent ? extra.parent.license_id : undefined,
  };
}

// An add-on normally ends on the same day as the license it hangs off, so the
// client renews everything in one go.
function coTermTerm(parent, b) {
  if (!parent) return {};
  if (parent.perpetual || !parent.expires) return { never: true };
  return { expires: parent.expires };
}

/**
 * Create a license for a client.
 * body: { client_id, product: 'desktop'|'mobile'|'both', plan, days|expires|never,
 *         machine, reminderDays, notes,
 *         kind?: 'base'|'addon', parent_id?, matchBaseExpiry?, force? }
 *
 * Add-ons: a client that already runs (say) desktop can be sold mobile later —
 * pass kind:'addon'. The new key hangs off their existing base license and, by
 * default, expires on the same day as it.
 */
router.post('/', (req, res) => {
  const b = req.body || {};
  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(b.client_id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (!canTouchClient(req, client)) return res.status(403).json({ error: 'Not your client' });

  const kind = normKind(b.kind);
  const rows = clientRows(client.id);
  const wanted = productsFromBody(b.product);

  // An add-on needs something to hang off.
  let parent = null;
  if (kind === 'addon') {
    parent = b.parent_id
      ? db.prepare('SELECT * FROM licenses WHERE id=? AND client_id=?').get(b.parent_id, client.id)
      : findBaseFor(rows, wanted[0]);
    if (!parent) {
      return res.status(409).json({
        error: 'This client has no active license to add on to — issue the first (base) license first.',
        code: 'NO_BASE_LICENSE',
      });
    }
  }

  // Don't silently stack a second live key on a product they already have.
  // A multi-product request ("both") simply skips what they own; a single-product
  // request is refused so the salesperson renews (or adds on) instead.
  const products = [];
  const skipped = [];
  for (const p of wanted) {
    const existing = liveForProduct(rows, p);
    if (existing && b.force !== true) {
      if (wanted.length > 1) { skipped.push(p); continue; }
      return res.status(409).json({
        error: `This client already has an active ${p} license (${existing.license_id}). Renew it instead, or pass force=true.`,
        code: 'PRODUCT_ALREADY_LICENSED', product: p, existing: decorate(existing),
      });
    }
    products.push(p);
  }
  if (!products.length) {
    return res.status(409).json({
      error: 'This client already has every product you selected. Renew an existing license instead.',
      code: 'PRODUCT_ALREADY_LICENSED', skipped,
    });
  }

  const licenses = [];
  try {
    for (const product of products) {
      const pParent = kind === 'addon'
        ? (parent && normProduct(parent.product) !== product ? parent : findBaseFor(rows, product))
        : null;
      const term = (kind === 'addon' && b.matchBaseExpiry !== false && pParent)
        ? coTermTerm(pParent, b) : {};
      const gen = generateLicense(mintOpts(client, { ...b, ...term }, product, { kind, parent: pParent }));
      licenses.push(insertLicense(client, gen, req, { kind, parent_id: pParent ? pParent.id : null }));
    }
  } catch (e) { return res.status(400).json({ error: e.message }); }

  const first = licenses[0];
  res.json({ ...first, licenses, license_key: first.license_key, skipped });
});

// Renew = generate a NEW license for the same client/product and mark the old
// one renewed. Keeps the add-on relationship intact.
router.post('/:id/renew', (req, res) => {
  const b = req.body || {};
  const old = db.prepare('SELECT * FROM licenses WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'License not found' });
  const client = clientOf(old);
  if (!canTouchClient(req, client)) return res.status(403).json({ error: 'Not your client' });

  // Carry over UNUSED days from the current license into the new term (default on).
  // Only positive remaining days of a dated (non-perpetual) license are added.
  const carryOver = b.carryOver !== false;
  let carried = 0;
  if (carryOver && old.expires && !old.perpetual) {
    const left = dayDiff(old.expires, new Date());
    if (left > 0) carried = left;
  }

  // Resolve the new term, then add carried days (unless the new license is perpetual).
  const extraDays = b.never ? 0 : carried;

  let gen;
  try {
    // If renewing by days, simply add carried days to the chosen days.
    if (b.days && !b.never) {
      gen = generateLicense({
        client: client.business_name, plan: b.plan || old.plan,
        product: old.product || 'desktop', kind: old.kind, parentId: old.license_id,
        days: parseInt(b.days, 10) + extraDays,
        machine: b.machine !== undefined ? b.machine : old.machine,
        reminderDays: b.reminderDays || old.reminder_days, notes: b.notes !== undefined ? b.notes : old.notes,
      });
    } else if (b.expires && !b.never) {
      // If renewing to a fixed date, push that date out by the carried days.
      const d = new Date(b.expires + 'T00:00:00');
      d.setDate(d.getDate() + extraDays);
      gen = generateLicense({
        client: client.business_name, plan: b.plan || old.plan,
        product: old.product || 'desktop', kind: old.kind, parentId: old.license_id,
        expires: d.toISOString().slice(0, 10),
        machine: b.machine !== undefined ? b.machine : old.machine,
        reminderDays: b.reminderDays || old.reminder_days, notes: b.notes !== undefined ? b.notes : old.notes,
      });
    } else {
      // Perpetual renewal — no carry needed.
      gen = generateLicense({
        client: client.business_name, plan: b.plan || old.plan, never: !!b.never,
        product: old.product || 'desktop', kind: old.kind, parentId: old.license_id,
        days: b.never ? undefined : b.days, expires: b.never ? undefined : b.expires,
        machine: b.machine !== undefined ? b.machine : old.machine,
        reminderDays: b.reminderDays || old.reminder_days, notes: b.notes !== undefined ? b.notes : old.notes,
      });
    }
  } catch (e) { return res.status(400).json({ error: e.message }); }

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO licenses (license_id,client_id,plan,product,kind,parent_id,issued,expires,perpetual,machine,reminder_days,notes,license_key,carried_days,created_by)
      VALUES (@license_id,@client_id,@plan,@product,@kind,@parent_id,@issued,@expires,@perpetual,@machine,@reminder_days,@notes,@license_key,@carried_days,@created_by)
    `).run({
      license_id: gen.payload.id, client_id: client.id, plan: gen.payload.plan,
      product: gen.payload.product || old.product || 'desktop',
      kind: normKind(old.kind), parent_id: old.parent_id || null,
      issued: gen.payload.issued, expires: gen.payload.expires, perpetual: gen.payload.expires ? 0 : 1,
      machine: gen.payload.machine || '', reminder_days: gen.payload.reminderDays,
      notes: gen.payload.notes || '', license_key: gen.licenseKey,
      carried_days: extraDays, created_by: req.user.id,
    });
    db.prepare("UPDATE licenses SET status='renewed', superseded_by=? WHERE id=?").run(info.lastInsertRowid, old.id);
    // Any add-on that hung off the old license now hangs off the renewed one.
    db.prepare('UPDATE licenses SET parent_id=? WHERE parent_id=?').run(info.lastInsertRowid, old.id);
    return info.lastInsertRowid;
  });
  const newId = tx();
  const out = decorate(db.prepare('SELECT * FROM licenses WHERE id=?').get(newId));
  res.json({ ...out, carriedDays: extraDays, licenses: [out] });
});

/**
 * Edit a license. Notes / reminder days are plain records — they update in
 * place. Term / plan / machine lock / product live INSIDE the signed key, so
 * changing one of those RE-ISSUES the key: the row keeps its id + activation
 * binding, the old key is archived, and the new key must be sent to the client.
 *
 * body: { plan?, notes?, reminder_days?, machine?, product?,
 *         days?|expires?|never?, kind?, parent_id? }
 */
router.put('/:id', (req, res) => {
  const b = req.body || {};
  const lic = db.prepare('SELECT * FROM licenses WHERE id=?').get(req.params.id);
  if (!lic) return res.status(404).json({ error: 'License not found' });
  const client = clientOf(lic);
  if (!canTouchClient(req, client)) return res.status(403).json({ error: 'Not your client' });
  if (lic.status === 'revoked') return res.status(409).json({ error: 'This license is revoked — restore or renew it instead.' });

  // --- resolve the new values -------------------------------------------------
  const product = b.product === undefined ? normProduct(lic.product) : normProduct(b.product);
  const kind = b.kind === undefined ? normKind(lic.kind) : normKind(b.kind);
  const plan = b.plan === undefined ? lic.plan : String(b.plan);
  const notes = b.notes === undefined ? lic.notes : String(b.notes);
  const reminderDays = b.reminder_days === undefined ? lic.reminder_days : Number(b.reminder_days);
  const machine = b.machine === undefined ? (lic.machine || '') : String(b.machine).toUpperCase().trim();

  let parent = null;
  if (kind === 'addon') {
    parent = b.parent_id
      ? db.prepare('SELECT * FROM licenses WHERE id=? AND client_id=?').get(b.parent_id, lic.client_id)
      : db.prepare('SELECT * FROM licenses WHERE id=?').get(lic.parent_id);
    if (!parent || parent.id === lic.id) parent = findBaseFor(clientRows(lic.client_id), product);
    if (!parent) {
      return res.status(409).json({
        error: 'An add-on needs a base license — this client has none.', code: 'NO_BASE_LICENSE',
      });
    }
  }

  // term: explicit override wins, otherwise keep what the license already has
  let term;
  if (b.never) term = { never: true };
  else if (b.expires) term = { expires: b.expires };
  else if (b.days) term = { days: Number(b.days) };
  else if (lic.perpetual) term = { never: true };
  else term = { expires: lic.expires };

  const signedChanged =
    product !== normProduct(lic.product) || plan !== lic.plan || machine !== (lic.machine || '') ||
    (term.never ? !!lic.expires : (term.expires || null) !== lic.expires || !!lic.perpetual);
  const activationLockedChanged = machine !== (lic.machine || '') || product !== normProduct(lic.product);

  let licenseKey = lic.license_key;
  try {
    if (signedChanged) {
      const gen = generateLicense({
        id: lic.license_id,                     // SAME id — the license keeps its identity
        client: client.business_name, plan, product, kind,
        parentId: parent ? parent.license_id : undefined,
        machine, reminderDays, notes, ...term,
      });
      licenseKey = gen.licenseKey;
    }
  } catch (e) { return res.status(400).json({ error: e.message }); }

  const tx = db.transaction(() => {
    if (signedChanged) {
      db.prepare(
        'INSERT INTO license_keys (license_row_id,license_id,license_key,reason) VALUES (?,?,?,?)'
      ).run(lic.id, lic.license_id, lic.license_key, 'edit');
    }
    db.prepare(`
      UPDATE licenses SET plan=?,product=?,kind=?,parent_id=?,expires=?,perpetual=?,machine=?,
             reminder_days=?,notes=?,license_key=?,key_updated_at=? WHERE id=?
    `).run(
      plan, product, kind, parent ? parent.id : null,
      term.never ? null : term.expires, term.never ? 1 : 0, machine,
      reminderDays, notes, licenseKey,
      signedChanged ? new Date().toISOString().replace('T', ' ').slice(0, 19) : lic.key_updated_at,
      lic.id
    );
    // A new machine lock / product means the old device binding no longer applies.
    if (activationLockedChanged) {
      db.prepare("UPDATE licenses SET activated_machine='', activated_at='' WHERE id=?").run(lic.id);
    }
  });
  tx();

  const row = decorate(db.prepare('SELECT * FROM licenses WHERE id=?').get(lic.id));
  res.json({
    ok: true,
    reissued: signedChanged,
    activation_reset: activationLockedChanged,
    license: row,
    license_key: licenseKey,
    licenses: [row],
  });
});

// Key history for a license (keys replaced by earlier edits).
router.get('/:id/keys', (req, res) => {
  const lic = db.prepare('SELECT * FROM licenses WHERE id=?').get(req.params.id);
  if (!lic) return res.status(404).json({ error: 'Not found' });
  if (!canTouchClient(req, clientOf(lic))) return res.status(403).json({ error: 'Not your client' });
  const keys = db.prepare(
    'SELECT id,license_key,reason,created_at FROM license_keys WHERE license_row_id=? ORDER BY id DESC'
  ).all(lic.id);
  res.json({ current: lic.license_key, history: keys });
});

// Re-fetch a stored key (e.g. to copy/resend to the client).
router.get('/:id/key', (req, res) => {
  const lic = db.prepare('SELECT * FROM licenses WHERE id=?').get(req.params.id);
  if (!lic) return res.status(404).json({ error: 'Not found' });
  if (!canTouchClient(req, clientOf(lic))) return res.status(403).json({ error: 'Not allowed' });
  res.json({
    license_key: lic.license_key, license_id: lic.license_id,
    product: lic.product || 'desktop', kind: lic.kind || 'base',
  });
});

// Revoke (admin only) — the key stops validating, nothing is deleted.
router.post('/:id/revoke', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  const lic = db.prepare('SELECT * FROM licenses WHERE id=?').get(req.params.id);
  if (!lic) return res.status(404).json({ error: 'License not found' });
  db.prepare("UPDATE licenses SET status='revoked' WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// Undo a revoke (admin only).
router.post('/:id/restore', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  const lic = db.prepare('SELECT * FROM licenses WHERE id=?').get(req.params.id);
  if (!lic) return res.status(404).json({ error: 'License not found' });
  if (lic.status !== 'revoked') return res.status(409).json({ error: 'This license is not revoked' });
  db.prepare("UPDATE licenses SET status='active' WHERE id=?").run(lic.id);
  res.json({ ok: true });
});

/**
 * Delete a license row (issued by mistake, duplicate, etc.).
 *   admin  : any license (?force=1 once it has been activated on a device)
 *   owner  : only a license they issued that has NOT been activated yet
 */
router.delete('/:id', (req, res) => {
  const lic = db.prepare('SELECT * FROM licenses WHERE id=?').get(req.params.id);
  if (!lic) return res.status(404).json({ error: 'License not found' });
  const client = clientOf(lic);
  if (!canTouchClient(req, client)) return res.status(403).json({ error: 'Not your client' });

  const force = req.query.force === '1' || req.body?.force === true;
  if (lic.activated_machine && !isAdmin(req)) {
    return res.status(403).json({
      error: 'This license is already activated on a device — only an admin can delete it.',
      code: 'ACTIVATED',
    });
  }
  if (lic.activated_machine && !force) {
    return res.status(409).json({
      error: `This license is activated on ${lic.activated_machine}. The device will lose access — confirm to delete.`,
      code: 'ACTIVATED', machine: lic.activated_machine,
    });
  }

  db.prepare('DELETE FROM licenses WHERE id=?').run(lic.id);
  res.json({ ok: true });
});

// Reset / transfer activation — frees the key so it can be activated on a new
// device (e.g. client changed computers). Owner or admin.
router.post('/:id/reset-activation', (req, res) => {
  const lic = db.prepare('SELECT * FROM licenses WHERE id=?').get(req.params.id);
  if (!lic) return res.status(404).json({ error: 'Not found' });
  if (!canTouchClient(req, clientOf(lic))) return res.status(403).json({ error: 'Not your client' });
  db.prepare("UPDATE licenses SET activated_machine='', activated_at='', activation_count=0 WHERE id=?").run(lic.id);
  res.json({ ok: true });
});

// One client's licenses grouped by product — handy for the client detail sheet.
router.get('/client/:clientId', (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (!canTouchClient(req, client)) return res.status(403).json({ error: 'Not your client' });
  const sum = licenseSummary(clientRows(client.id));
  res.json({ licenses: sum.all, byProduct: sum.byProduct, products: sum.products, missing: sum.missing });
});

module.exports = router;
module.exports.PRODUCTS = PRODUCTS;
