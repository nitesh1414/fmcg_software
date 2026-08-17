// User management — admin only (create salespeople, enable/disable, reset pwd).
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authRequired, adminOnly } = require('../auth');

const router = express.Router();
router.use(authRequired, adminOnly);

// List all portal users with how many clients each created.
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT u.id,u.name,u.username,u.email,u.phone,u.role,u.active,u.created_at,
      (SELECT COUNT(*) FROM clients c WHERE c.created_by=u.id) AS client_count
    FROM users u ORDER BY u.role='admin' DESC, u.name
  `).all();
  res.json(rows);
});

// Create a salesperson (or another admin).
router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.username || !b.password) {
    return res.status(400).json({ error: 'name, username and password are required' });
  }
  const exists = db.prepare('SELECT 1 FROM users WHERE username=?').get(b.username.trim());
  if (exists) return res.status(409).json({ error: 'Username already taken' });
  const role = b.role === 'admin' ? 'admin' : 'sales';
  const info = db.prepare(
    `INSERT INTO users (name,username,email,phone,password_hash,role) VALUES (?,?,?,?,?,?)`
  ).run(b.name.trim(), b.username.trim(), b.email || '', b.phone || '', bcrypt.hashSync(b.password, 10), role);
  res.json(db.prepare('SELECT id,name,username,email,phone,role,active,created_at FROM users WHERE id=?').get(info.lastInsertRowid));
});

// Update a user (name/email/phone/role/active).
router.put('/:id', (req, res) => {
  const b = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE users SET name=?,email=?,phone=?,role=?,active=? WHERE id=?').run(
    b.name ?? u.name, b.email ?? u.email, b.phone ?? u.phone,
    b.role === 'admin' ? 'admin' : (b.role === 'sales' ? 'sales' : u.role),
    b.active === undefined ? u.active : (b.active ? 1 : 0),
    u.id
  );
  res.json({ ok: true });
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

module.exports = router;
