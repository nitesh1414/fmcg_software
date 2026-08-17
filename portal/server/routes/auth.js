const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, authRequired } = require('../auth');

const router = express.Router();

// Login (single login for admin + sales — role decides the experience)
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  if (!row || !row.active || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const user = { id: row.id, name: row.name, username: row.username, role: row.role };
  res.json({ token: signToken(user), user });
});

// Current user
router.get('/me', authRequired, (req, res) => {
  const row = db.prepare('SELECT id,name,username,email,phone,role FROM users WHERE id=?').get(req.user.id);
  if (!row) return res.status(404).json({ error: 'User not found' });
  res.json(row);
});

// Change own password
router.put('/password', authRequired, (req, res) => {
  const { current, next } = req.body || {};
  if (!next || next.length < 4) return res.status(400).json({ error: 'New password too short' });
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!row || !bcrypt.compareSync(current || '', row.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(next, 10), req.user.id);
  res.json({ ok: true });
});

module.exports = router;
