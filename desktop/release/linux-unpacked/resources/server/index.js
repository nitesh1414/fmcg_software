const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

const { authRequired, adminOnly } = require('./auth');

/**
 * Build the Express app. DB is required lazily so callers (e.g. Electron) can
 * set process.env.DB_PATH before the schema bootstraps.
 */
function createApp() {
  const db = require('./db'); // bootstrap schema (honours DB_PATH env)

  // Financial-year auto-rollover: the current FY is always computed live from
  // today's date + the configured start month (see fy.js), so reports/dashboard
  // switch to the new FY automatically. Here we just detect the transition and
  // note it in the log the first time a new FY is seen.
  try {
    const { currentFy } = require('./fy');
    const fy = currentFy();
    const row = db.prepare('SELECT last_fy FROM company WHERE id=1').get();
    if (row && row.last_fy !== fy.label) {
      if (row.last_fy) console.log(`  Financial year rolled over: ${row.last_fy} → ${fy.label}`);
      db.prepare('UPDATE company SET last_fy=? WHERE id=1').run(fy.label);
    }
  } catch (_) { /* non-fatal */ }

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));

  // Read-only mode (e.g. desktop license expired): allow GETs + auth + backup,
  // but block create/update/delete so data can be viewed/printed but not changed.
  app.use('/api', (req, res, next) => {
    if (process.env.RS_READONLY !== '1') return next();
    const safe = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
    const allowedPath = req.path.startsWith('/auth') || req.path.startsWith('/backup');
    if (safe || allowedPath) return next();
    return res.status(423).json({
      error: 'License expired — RightServe is in read-only mode. Please renew to make changes.',
      code: 'READ_ONLY',
    });
  });

  // Expose license state so the client UI can show a banner / disable buttons
  // and render the in-app License page. Details come from the desktop wrapper
  // via RS_LICENSE_INFO; in the web build there is no license (state 'web').
  app.get('/api/license-state', (req, res) => {
    let info = {};
    try { info = JSON.parse(process.env.RS_LICENSE_INFO || '{}'); } catch (_) { info = {}; }
    res.json({
      readOnly: process.env.RS_READONLY === '1',
      state: process.env.RS_LICENSE_STATE || (info.desktop ? info.state : 'web'),
      desktop: !!info.desktop,
      client: info.client || '',
      plan: info.plan || '',
      licenseId: info.licenseId || '',
      issued: info.issued || '',
      expires: info.expires || null,
      perpetual: !!info.perpetual,
      daysLeft: typeof info.daysLeft === 'number' ? info.daysLeft : null,
      machineId: info.machineId || '',
      machineLocked: !!info.machineLocked,
    });
  });

  const perms = require('./perms');
  // Invoices route serves both sales & purchases; pick the module from ?type
  // (list/create) or the stored invoice type, then apply read/write level.
  // (db was required at the top of createApp.)
  const invoiceGuard = (req, res, next) => {
    if (req.user && req.user.role === 'admin') return next();
    let mod = null;
    const qType = (req.query && req.query.type) || (req.body && req.body.type);
    // permission module names: 'sales' / 'purchase' (invoice type is 'sale'/'purchase')
    if (qType === 'sale') mod = 'sales';
    else if (qType === 'purchase') mod = 'purchase';
    else if (req.params && req.params.id) {
      const inv = db.prepare('SELECT type FROM invoices WHERE id=?').get(req.params.id);
      if (inv) mod = inv.type === 'sale' ? 'sales' : 'purchase';
    }
    if (!mod) {
      // Mixed/unknown: allow if the user can touch either sale or purchase.
      const { perms: up } = perms.getUserPerms(req.user.id);
      const need = req.method === 'GET' ? 'read' : 'write';
      const rank = { none: 0, read: 1, write: 2 };
      if (rank[up.sales] >= rank[need] || rank[up.purchase] >= rank[need]) return next();
      return res.status(403).json({ error: "You don't have access to billing.", code: 'NO_ACCESS' });
    }
    return perms.guard(mod)(req, res, next);
  };

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/items', authRequired, perms.guard('items'), require('./routes/items'));
  // Serial/batch lookup — read access via the 'items' module.
  app.use('/api/serials', authRequired, perms.guard('items'), require('./routes/serials'));
  app.use('/api/parties', authRequired, perms.guard('parties'), require('./routes/parties').router);
  app.use('/api/invoices', authRequired, invoiceGuard, require('./routes/invoices'));
  app.use('/api/payments', authRequired, perms.guard('payments'), require('./routes/payments'));
  // E-Way Bills live under Accounts; gated on the 'payments' module (accounting).
  app.use('/api/eway', authRequired, perms.guard('payments'), require('./routes/eway'));
  // Reports route also serves GST reports — allow if the user has read on
  // either 'reports' or 'gst'.
  const reportsGuard = (req, res, next) => {
    if (req.user && req.user.role === 'admin') return next();
    const { perms: up } = perms.getUserPerms(req.user.id);
    if (up.reports !== 'none' || up.gst !== 'none') return next();
    return res.status(403).json({ error: "You don't have access to reports.", code: 'NO_ACCESS' });
  };
  app.use('/api/reports', authRequired, reportsGuard, require('./routes/reports'));
  app.use('/api/company', authRequired, require('./routes/company'));
  // Business profiles: any authed user may LIST/GET (to switch); writes are admin-only.
  const businessesRouter = require('./routes/businesses');
  const businessWriteGuard = (req, res, next) => {
    if (req.method === 'GET') return next();
    return adminOnly(req, res, next);
  };
  app.use('/api/businesses', authRequired, businessWriteGuard, businessesRouter);
  app.use('/api/migrate', authRequired, adminOnly, require('./routes/migrate'));
  app.use('/api/backup', require('./routes/backup'));
  app.use('/api/lookup', authRequired, require('./routes/lookup'));
  app.use('/api/pdf', require('./routes/pdf'));
  // WhatsApp: link a device (QR) and send bill PDFs. Gated on the 'sales' module.
  app.use('/api/whatsapp', authRequired, perms.guard('sales'), require('./routes/whatsapp'));

  app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  // Serve built client. Allow override via CLIENT_DIST (used when packaged).
  const clientDist = process.env.CLIENT_DIST || path.join(__dirname, '..', 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  return app;
}

/**
 * Start the HTTP server. Returns a promise resolving to { server, port }.
 * Pass port 0 to let the OS pick a free port (used by the desktop app).
 */
function start(port = process.env.PORT || 4000) {
  return new Promise((resolve, reject) => {
    const app = createApp();
    const server = app.listen(port, '127.0.0.1', () => {
      const actualPort = server.address().port;
      console.log(`\n  FMCG server running on http://localhost:${actualPort}\n`);
      resolve({ server, port: actualPort });
    });
    server.on('error', reject);
  });
}

module.exports = { createApp, start };

// Run directly (web/standalone mode)
if (require.main === module) {
  start().catch((e) => {
    console.error('Failed to start server:', e);
    process.exit(1);
  });
}
