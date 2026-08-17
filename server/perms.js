// Per-module access control for staff users. Admin always has full access.
//
// Modules map to app screens / API areas. Each module has a level:
//   'none'  -> cannot see or use
//   'read'  -> can view/list/print/export, but not create/edit/delete
//   'write' -> full access
const db = require('./db');

const MODULES = ['sales', 'purchase', 'items', 'parties', 'payments', 'reports', 'gst'];
const LEVELS = ['none', 'read', 'write'];

// Default permissions for a brand-new staff user (read-only everywhere, safe).
function defaultPerms() {
  const p = {};
  for (const m of MODULES) p[m] = 'read';
  return p;
}

function normalizePerms(input) {
  const out = {};
  const src = input && typeof input === 'object' ? input : {};
  for (const m of MODULES) out[m] = LEVELS.includes(src[m]) ? src[m] : 'none';
  return out;
}

function getUserPerms(userId) {
  const row = db.prepare('SELECT role, permissions FROM users WHERE id=?').get(userId);
  if (!row) return { role: 'staff', perms: {} };
  let perms = {};
  try { perms = JSON.parse(row.permissions || '{}'); } catch (_) { perms = {}; }
  return { role: row.role, perms: normalizePerms(perms) };
}

// Express middleware factory: require a given level on a module.
// Admins bypass. Read endpoints typically use 'read'; mutations use 'write'.
function require_(moduleName, level = 'read') {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (req.user.role === 'admin') return next();
    const { perms } = getUserPerms(req.user.id);
    const have = perms[moduleName] || 'none';
    const rank = { none: 0, read: 1, write: 2 };
    if (rank[have] >= rank[level]) return next();
    return res.status(403).json({
      error: `You don't have ${level} access to ${moduleName}. Contact your admin.`,
      code: 'NO_ACCESS',
    });
  };
}

// Convenience: for a router where GET = read and others = write.
function guard(moduleName) {
  return (req, res, next) => {
    const level = req.method === 'GET' || req.method === 'HEAD' ? 'read' : 'write';
    return require_(moduleName, level)(req, res, next);
  };
}

module.exports = { MODULES, LEVELS, defaultPerms, normalizePerms, getUserPerms, require: require_, guard };
