const path = require('path');
const fs = require('fs');

// --- tiny zero-dependency .env loader (reads portal/server/.env if present) ---
(function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const key = m[1];
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = val; // real env wins
    }
  } catch (_) { /* ignore */ }
})();

const express = require('express');
const cors = require('cors');

function createApp() {
  require('./db');
  const app = express();
  // CORS: when the frontend is hosted on a DIFFERENT origin than this API,
  // set CORS_ORIGIN to the frontend URL(s), comma-separated, e.g.
  //   CORS_ORIGIN=https://portal.rightserve.com,https://www.rightserve.com
  // Leave unset to allow all origins (fine for single-server or testing).
  const corsOrigin = (process.env.CORS_ORIGIN || '').trim();
  if (corsOrigin && corsOrigin !== '*') {
    const allow = corsOrigin.split(',').map((s) => s.trim()).filter(Boolean);
    app.use(cors({ origin: allow, credentials: true }));
  } else {
    app.use(cors());
  }
  app.use(express.json({ limit: '2mb' }));

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/users', require('./routes/users'));
  app.use('/api/clients', require('./routes/clients'));
  app.use('/api/licenses', require('./routes/licenses'));
  app.use('/api/dashboard', require('./routes/dashboard'));
  app.use('/api/activate', require('./routes/activate')); // PUBLIC — desktop devices
  app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  // Serve the built portal client.
  const clientDist = process.env.PORTAL_CLIENT_DIST || path.join(__dirname, '..', 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }
  return app;
}

function start(port = process.env.PORT || 4100) {
  return new Promise((resolve, reject) => {
    const app = createApp();
    const host = process.env.HOST || '0.0.0.0'; // bind public for cloud deploy
    const server = app.listen(port, host, () => {
      console.log(`\n  RightServe Portal running on http://localhost:${server.address().port}\n`);
      resolve({ server, port: server.address().port });
    });
    server.on('error', reject);
  });
}

if (require.main === module) start();
module.exports = { createApp, start };
