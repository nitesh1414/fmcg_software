const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, authRequired, adminOnly } = require('../auth');
const { MODULES, defaultPerms, normalizePerms, getUserPerms } = require('../perms');

const router = express.Router();

function parseTheme(raw) { try { return JSON.parse(raw || '{}'); } catch (_) { return {}; } }

// Build the public user object returned to the client (incl. permissions).
function publicUser(row) {
  const { perms } = getUserPerms(row.id);
  return {
    id: row.id, name: row.name, username: row.username, role: row.role,
    theme: parseTheme(row.theme_prefs),
    permissions: row.role === 'admin' ? null : perms, // null = full access (admin)
  };
}

// ---------------------------------------------------------------------------
// First-run ONLY: create the single admin. Blocked once any user exists.
// ---------------------------------------------------------------------------
router.post('/register', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) {
    return res.status(403).json({ error: 'An admin already exists. New users are created from inside the app by the admin.' });
  }
  const { name, username, password, sec_question, sec_answer } = req.body || {};
  if (!name || !username || !password) return res.status(400).json({ error: 'name, username and password are required' });
  if (!sec_question || !sec_answer) return res.status(400).json({ error: 'A security question & answer are required (used for admin password recovery)' });

  const hash = bcrypt.hashSync(password, 10);
  const ansHash = bcrypt.hashSync(String(sec_answer).trim().toLowerCase(), 10);
  const info = db.prepare(
    `INSERT INTO users (name, username, password_hash, role, permissions, active, sec_question, sec_answer_hash)
     VALUES (?,?,?,?,?,1,?,?)`
  ).run(name, username, hash, 'admin', '{}', sec_question, ansHash);
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
  res.json({ token: signToken(row), user: publicUser(row) });
});

// Whether the very first (admin) user still needs to be created.
router.get('/needs-setup', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  res.json({ needsSetup: count === 0 });
});

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password are required' });
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row || !bcrypt.compareSync(password, row.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });
  if (!row.active) return res.status(403).json({ error: 'This account is disabled. Contact your admin.' });
  res.json({ token: signToken(row), user: publicUser(row) });
});

router.get('/me', authRequired, (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!row) return res.status(404).json({ error: 'User not found' });
  if (!row.active) return res.status(403).json({ error: 'Account disabled' });
  res.json(publicUser(row));
});

router.put('/theme', authRequired, (req, res) => {
  const prefs = req.body || {};
  const clean = {
    palette: typeof prefs.palette === 'string' ? prefs.palette : 'teal',
    density: typeof prefs.density === 'string' ? prefs.density : 'comfortable',
    textSize: typeof prefs.textSize === 'string' ? prefs.textSize : 'normal',
  };
  db.prepare('UPDATE users SET theme_prefs = ? WHERE id = ?').run(JSON.stringify(clean), req.user.id);
  res.json({ ok: true, theme: clean });
});

// Change own password (any logged-in user).
router.put('/password', authRequired, (req, res) => {
  const { current, next } = req.body || {};
  if (!next || String(next).length < 4) return res.status(400).json({ error: 'New password must be at least 4 characters' });
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!row || !bcrypt.compareSync(current || '', row.password_hash)) return res.status(400).json({ error: 'Current password is incorrect' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(next, 10), req.user.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Admin "forgot password" via security question (no email needed, offline).
// ---------------------------------------------------------------------------
// Step 1: fetch the admin's security question.
router.get('/recover/question', (req, res) => {
  const admin = db.prepare("SELECT username, sec_question FROM users WHERE role='admin' ORDER BY id LIMIT 1").get();
  if (!admin || !admin.sec_question) return res.status(404).json({ error: 'No recovery question is set.' });
  res.json({ username: admin.username, question: admin.sec_question });
});
// Step 2: answer it to reset the admin password.
router.post('/recover/reset', (req, res) => {
  const { answer, newPassword } = req.body || {};
  if (!answer || !newPassword || String(newPassword).length < 4) return res.status(400).json({ error: 'Answer and a new password (min 4 chars) are required' });
  const admin = db.prepare("SELECT * FROM users WHERE role='admin' ORDER BY id LIMIT 1").get();
  if (!admin || !admin.sec_answer_hash) return res.status(404).json({ error: 'Recovery not available.' });
  if (!bcrypt.compareSync(String(answer).trim().toLowerCase(), admin.sec_answer_hash)) {
    return res.status(401).json({ error: 'Incorrect answer to the security question.' });
  }
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(newPassword, 10), admin.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// User management — ADMIN ONLY
// ---------------------------------------------------------------------------
// List users (admin sees all; non-admin gets only themselves for the header).
router.get('/users', authRequired, (req, res) => {
  if (req.user.role !== 'admin') {
    const me = db.prepare('SELECT id,name,username,role FROM users WHERE id=?').get(req.user.id);
    return res.json(me ? [me] : []);
  }
  const rows = db.prepare('SELECT id,name,username,role,active,permissions,created_at FROM users ORDER BY role=\'admin\' DESC, id').all();
  res.json(rows.map((r) => ({
    id: r.id, name: r.name, username: r.username, role: r.role, active: !!r.active,
    created_at: r.created_at,
    permissions: r.role === 'admin' ? null : normalizePerms((() => { try { return JSON.parse(r.permissions || '{}'); } catch (_) { return {}; } })()),
  })));
});

// Create a staff user (admin only). Cannot create another admin.
router.post('/users', authRequired, adminOnly, (req, res) => {
  const { name, username, password, permissions } = req.body || {};
  if (!name || !username || !password) return res.status(400).json({ error: 'name, username and password are required' });
  const exists = db.prepare('SELECT 1 FROM users WHERE username=?').get(username.trim());
  if (exists) return res.status(409).json({ error: 'Username already taken' });
  const perms = JSON.stringify(normalizePerms(permissions || defaultPerms()));
  const info = db.prepare(
    `INSERT INTO users (name, username, password_hash, role, permissions, active, created_by)
     VALUES (?,?,?,?,?,1,?)`
  ).run(name.trim(), username.trim(), bcrypt.hashSync(password, 10), 'staff', perms, req.user.id);
  res.json({ id: info.lastInsertRowid });
});

// Update a staff user's name / permissions / active (admin only).
router.put('/users/:id', authRequired, adminOnly, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (u.role === 'admin') return res.status(400).json({ error: 'The admin account cannot be modified here.' });
  const b = req.body || {};
  const perms = b.permissions ? JSON.stringify(normalizePerms(b.permissions)) : u.permissions;
  db.prepare('UPDATE users SET name=?, permissions=?, active=? WHERE id=?').run(
    b.name ?? u.name, perms, b.active === undefined ? u.active : (b.active ? 1 : 0), u.id
  );
  res.json({ ok: true });
});

// Reset a user's password (admin only).
router.post('/users/:id/reset-password', authRequired, adminOnly, (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password).length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  const u = db.prepare('SELECT id FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(password, 10), u.id);
  res.json({ ok: true });
});

// Delete a user (admin only; cannot delete an admin / self).
router.delete('/users/:id', authRequired, adminOnly, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (u.role === 'admin') return res.status(400).json({ error: 'The admin account cannot be deleted.' });
  if (u.id === req.user.id) return res.status(400).json({ error: 'You cannot delete yourself.' });
  db.prepare('DELETE FROM users WHERE id=?').run(u.id);
  res.json({ ok: true });
});

// Expose module list for the UI permission editor.
router.get('/modules', authRequired, adminOnly, (req, res) => res.json({ modules: MODULES }));

module.exports = router;
