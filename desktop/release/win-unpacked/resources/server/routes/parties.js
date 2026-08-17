const express = require('express');
const db = require('../db');
const router = express.Router();

// Compute current balance for a party:
// opening + sales(total) - purchases(total) + paymentsOut - paymentsIn  ... simplified:
// balance = opening + (sale totals - sale paid) - (purchase totals - purchase paid)
function partyBalance(partyId) {
  const p = db.prepare('SELECT opening_balance FROM parties WHERE id = ?').get(partyId);
  if (!p) return 0;
  const sale = db
    .prepare(`SELECT COALESCE(SUM(total),0) t FROM invoices WHERE party_id=? AND type='sale'`)
    .get(partyId).t;
  const purchase = db
    .prepare(`SELECT COALESCE(SUM(total),0) t FROM invoices WHERE party_id=? AND type='purchase'`)
    .get(partyId).t;
  const inP = db
    .prepare(`SELECT COALESCE(SUM(amount),0) a FROM payments WHERE party_id=? AND type='in'`)
    .get(partyId).a;
  const outP = db
    .prepare(`SELECT COALESCE(SUM(amount),0) a FROM payments WHERE party_id=? AND type='out'`)
    .get(partyId).a;
  // positive = party owes us (receivable)
  return p.opening_balance + sale - inP - (purchase - outP);
}

router.get('/', (req, res) => {
  const { type } = req.query;
  let rows;
  if (type) rows = db.prepare('SELECT * FROM parties WHERE type = ? ORDER BY name').all(type);
  else rows = db.prepare('SELECT * FROM parties ORDER BY name').all();
  rows.forEach((r) => (r.balance = partyBalance(r.id)));
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM parties WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Party not found' });
  p.balance = partyBalance(p.id);
  p.invoices = db
    .prepare('SELECT * FROM invoices WHERE party_id = ? ORDER BY date DESC, id DESC')
    .all(p.id);
  p.payments = db
    .prepare('SELECT * FROM payments WHERE party_id = ? ORDER BY date DESC, id DESC')
    .all(p.id);
  res.json(p);
});

router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name required' });
  const info = db
    .prepare(
      `INSERT INTO parties (name, type, phone, email, gstin, address, state, opening_balance)
       VALUES (@name,@type,@phone,@email,@gstin,@address,@state,@opening_balance)`
    )
    .run({
      name: b.name,
      type: b.type || 'customer',
      phone: b.phone || '',
      email: b.email || '',
      gstin: b.gstin || '',
      address: b.address || '',
      state: b.state || '',
      opening_balance: Number(b.opening_balance) || 0,
    });
  res.json(db.prepare('SELECT * FROM parties WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const b = req.body || {};
  db.prepare(
    `UPDATE parties SET name=@name, type=@type, phone=@phone, email=@email, gstin=@gstin,
      address=@address, state=@state, opening_balance=@opening_balance WHERE id=@id`
  ).run({
    id: req.params.id,
    name: b.name,
    type: b.type || 'customer',
    phone: b.phone || '',
    email: b.email || '',
    gstin: b.gstin || '',
    address: b.address || '',
    state: b.state || '',
    opening_balance: Number(b.opening_balance) || 0,
  });
  res.json(db.prepare('SELECT * FROM parties WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM parties WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = { router, partyBalance };
