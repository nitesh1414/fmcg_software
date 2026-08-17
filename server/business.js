// Multi-business helpers: resolve the active business for a request.
const db = require('./db');

function listBusinesses(includeInactive = false) {
  const sql = `SELECT * FROM businesses ${includeInactive ? '' : 'WHERE active=1'} ORDER BY is_default DESC, name`;
  return db.prepare(sql).all();
}

function getDefaultBusiness() {
  return (
    db.prepare('SELECT * FROM businesses WHERE is_default=1 AND active=1').get() ||
    db.prepare('SELECT * FROM businesses WHERE active=1 ORDER BY id LIMIT 1').get() ||
    null
  );
}

function getBusiness(id) {
  return db.prepare('SELECT * FROM businesses WHERE id=?').get(id);
}

// Resolve the business a request operates on.
//  1. explicit X-Business-Id header / ?business_id query (must be an active biz)
//  2. otherwise the default business
// Returns a numeric id (or null if none exist).
function resolveBusinessId(req) {
  const raw = req.get('X-Business-Id') || (req.query && req.query.business_id) || (req.body && req.body.business_id);
  const id = Number(raw);
  if (id) {
    const b = db.prepare('SELECT id FROM businesses WHERE id=? AND active=1').get(id);
    if (b) return b.id;
  }
  const def = getDefaultBusiness();
  return def ? def.id : null;
}

// Express middleware: attaches req.businessId for downstream routes.
// Blocks WRITE operations aimed at an inactive/unknown business so that a
// deactivated business can never be used for new transactions.
function businessContext(req, res, next) {
  const raw = req.get('X-Business-Id') || (req.query && req.query.business_id) || (req.body && req.body.business_id);
  const isWrite = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
  if (raw && isWrite) {
    const b = db.prepare('SELECT id, active FROM businesses WHERE id=?').get(Number(raw));
    if (!b || !b.active) {
      return res.status(400).json({
        error: 'This business is inactive. Switch to an active business to record transactions.',
        code: 'BUSINESS_INACTIVE',
      });
    }
  }
  req.businessId = resolveBusinessId(req);
  next();
}

module.exports = { listBusinesses, getDefaultBusiness, getBusiness, resolveBusinessId, businessContext };
