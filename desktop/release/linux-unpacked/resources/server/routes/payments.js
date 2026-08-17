const express = require('express');
const db = require('../db');
const { businessContext } = require('../business');
const router = express.Router();

router.use(businessContext);

router.get('/', (req, res) => {
  const { from, to, party_id, type } = req.query;
  let sql = `SELECT pay.*, p.name AS party_name, inv.invoice_no
             FROM payments pay
             LEFT JOIN parties p ON p.id = pay.party_id
             LEFT JOIN invoices inv ON inv.id = pay.invoice_id WHERE pay.business_id = ?`;
  const params = [req.businessId];
  if (party_id) { sql += ' AND pay.party_id = ?'; params.push(party_id); }
  if (type) { sql += ' AND pay.type = ?'; params.push(type); }
  if (from) { sql += ' AND pay.date >= ?'; params.push(from); }
  if (to) { sql += ' AND pay.date <= ?'; params.push(to); }
  sql += ' ORDER BY pay.date DESC, pay.id DESC';
  res.json(db.prepare(sql).all(...params));
});

router.post('/', (req, res) => {
  const b = req.body || {};
  if (!b.amount || !b.party_id) return res.status(400).json({ error: 'party_id and amount required' });
  const info = db
    .prepare(
      `INSERT INTO payments (party_id, invoice_id, business_id, type, amount, mode, date, notes)
       VALUES (@party_id,@invoice_id,@business_id,@type,@amount,@mode,@date,@notes)`
    )
    .run({
      party_id: b.party_id,
      invoice_id: b.invoice_id || null,
      business_id: req.businessId,
      type: b.type === 'out' ? 'out' : 'in',
      amount: Number(b.amount) || 0,
      mode: b.mode || 'cash',
      date: b.date || new Date().toISOString().slice(0, 10),
      notes: b.notes || '',
    });

  // If linked to an invoice, update its paid + status
  if (b.invoice_id) {
    const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(b.invoice_id);
    if (inv) {
      const paid = inv.paid + (Number(b.amount) || 0);
      const status = paid >= inv.total ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
      db.prepare('UPDATE invoices SET paid = ?, status = ? WHERE id = ?').run(paid, status, inv.id);
    }
  }
  res.json(db.prepare('SELECT * FROM payments WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM payments WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
