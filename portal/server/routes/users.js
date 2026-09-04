// User management — admin only (create salespeople, edit, enable/disable,
// reset passwords, delete). Deleting a user never deletes their clients or
// licenses — those can be handed over to another salesperson instead.
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authRequired, adminOnly } = require('../auth');

const router = express.Router();
router.use(authRequired, adminOnly);

const publicCols = 'id,name,username,email,phone,role,active,created_at,last_login_at';

function rowOf(id) {
  return db.prepare(`SELECT ${publicCols} FROM users WHERE id=?`).get(id);
}

// How many active admins would be left if `id` stopped being one?
function activeAdminsExcluding(id) {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1 AND id!=?").get(id).n;
}

// List all portal users with how many clients/licenses each owns.
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT u.id,u.name,u.username,u.email,u.phone,u.role,u.active,u.created_at,u.last_login_at,
      (SELECT COUNT(*) FROM clients c WHERE c.created_by=u.id) AS client_count,
      (SELECT COUNT(*) FROM licenses l WHERE l.created_by=u.id) AS license_count
    FROM users u ORDER BY u.role='admin' DESC, u.name
  `).all();
  res.json(rows);
});

// Create a salesperson (or another admin).
router.post('/', (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const username = String(b.username || '').trim();
  if (!name || !username || !b.password) {
    return res.status(400).json({ error: 'name, username and password are required' });
  }
  if (String(b.password).length < 4) return res.status(400).json({ error: 'Password too short' });
  const exists = db.prepare('SELECT 1 FROM users WHERE username=?').get(username);
  if (exists) return res.status(409).json({ error: 'Username already taken' });
  const role = b.role === 'admin' ? 'admin' : 'sales';
  const info = db.prepare(
    `INSERT INTO users (name,username,email,phone,password_hash,role) VALUES (?,?,?,?,?,?)`
  ).run(name, username, b.email || '', b.phone || '', bcrypt.hashSync(b.password, 10), role);
  res.json(rowOf(info.lastInsertRowid));
});

// Update a user (name/username/email/phone/role/active).
router.put('/:id', (req, res) => {
  const b = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });

  const username = b.username === undefined ? u.username : String(b.username).trim();
  if (!username) return res.status(400).json({ error: 'Username cannot be empty' });
  if (username !== u.username) {
    const dup = db.prepare('SELECT 1 FROM users WHERE username=? AND id!=?').get(username, u.id);
    if (dup) return res.status(409).json({ error: 'Username already taken' });
  }

  const role = b.role === 'admin' ? 'admin' : (b.role === 'sales' ? 'sales' : u.role);
  const active = b.active === undefined ? u.active : (b.active ? 1 : 0);

  // Never let the portal lock itself out of admin access.
  if (u.role === 'admin' && (role !== 'admin' || !active)) {
    if (Number(u.id) === Number(req.user.id)) {
      return res.status(400).json({ error: "You can't remove or disable your own admin access." });
    }
    if (activeAdminsExcluding(u.id) === 0) {
      return res.status(409).json({ error: 'This is the last active admin — promote another admin first.' });
    }
  }

  db.prepare('UPDATE users SET name=?,username=?,email=?,phone=?,role=?,active=? WHERE id=?').run(
    String(b.name ?? u.name).trim() || u.name, username, b.email ?? u.email, b.phone ?? u.phone,
    role, active, u.id
  );
  res.json(rowOf(u.id));
});

// Reset a user's password.
router.post('/:id/reset-password', (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 4) return res.status(400).json({ error: 'Password too short' });
  const u = db.prepare('SELECT id FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password, 10), u.id);
  res.json({ ok: true });
});

/**
 * Delete a user. Their clients & licenses are KEPT.
 *   ?reassign_to=<id>  hand their clients/licenses to another user
 *   otherwise they become unassigned (shown as "—") and only an admin sees them.
 */
router.delete('/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (Number(u.id) === Number(req.user.id)) {
    return res.status(400).json({ error: "You can't delete your own account." });
  }
  if (u.role === 'admin' && u.active && activeAdminsExcluding(u.id) === 0) {
    return res.status(409).json({ error: 'This is the last active admin — promote another admin first.' });
  }

  const clients = db.prepare('SELECT COUNT(*) AS n FROM clients WHERE created_by=?').get(u.id).n;
  const licenses = db.prepare('SELECT COUNT(*) AS n FROM licenses WHERE created_by=?').get(u.id).n;

  const reassignTo = req.query.reassign_to || req.body?.reassign_to;
  let targetId = null;
  if (reassignTo) {
    const target = db.prepare('SELECT id FROM users WHERE id=? AND id!=?').get(reassignTo, u.id);
    if (!target) return res.status(400).json({ error: 'Unknown user to reassign to' });
    targetId = target.id;
    db.prepare('UPDATE clients SET created_by=? WHERE created_by=?').run(target.id, u.id);
    db.prepare('UPDATE licenses SET created_by=? WHERE created_by=?').run(target.id, u.id);
  }

  db.prepare('DELETE FROM users WHERE id=?').run(u.id); // created_by → NULL (ON DELETE SET NULL)
  res.json({ ok: true, clients, licenses, reassigned_to: targetId });
});

module.exports = router;
