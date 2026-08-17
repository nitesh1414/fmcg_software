// WhatsApp API: link a device via QR, check status, and send a sale bill PDF.
const express = require('express');
const db = require('../db');
const wa = require('../whatsapp');
const pdf = require('./pdf');
const router = express.Router();

// Current connection status (+ QR data URL while linking).
router.get('/status', (req, res) => {
  res.json(wa.getStatus());
});

// Start / (re)initialise the client — triggers QR generation on first use.
router.post('/connect', async (req, res) => {
  try { res.json(await wa.init()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Unlink the device.
router.post('/logout', async (req, res) => {
  try { res.json(await wa.logout()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Send an invoice PDF to a customer's WhatsApp number.
// body: { invoice_id, number?, format?, caption? }
router.post('/send-invoice', async (req, res) => {
  const b = req.body || {};
  const invoiceId = Number(b.invoice_id);
  if (!invoiceId) return res.status(400).json({ error: 'invoice_id required' });

  const st = wa.getStatus();
  if (!st.available) return res.status(400).json({ error: 'WhatsApp is not installed on this server.', code: 'WA_UNAVAILABLE' });
  if (st.status !== 'ready') return res.status(409).json({ error: 'WhatsApp is not connected. Scan the QR to link a device.', code: 'WA_NOT_READY' });

  let bundle;
  try { bundle = await pdf.invoicePdfBuffer(invoiceId, b.format); }
  catch (e) { return res.status(500).json({ error: 'Could not build the bill PDF: ' + e.message }); }
  if (!bundle) return res.status(404).json({ error: 'Invoice not found' });

  const { buffer, inv, biz } = bundle;
  // Number: explicit override → else the party's saved phone.
  let number = (b.number || '').trim();
  if (!number) number = inv.party_phone || '';
  if (!number) return res.status(400).json({ error: 'No mobile number. Enter one or set it on the customer.', code: 'NO_NUMBER' });

  const filename = (inv.invoice_no || 'invoice') + '.pdf';
  const caption = (b.caption || '').trim() ||
    `Hello${inv.party_name ? ' ' + inv.party_name : ''}, here is your ${inv.type === 'purchase' ? 'purchase bill' : 'invoice'} ${inv.invoice_no} for ${money(inv.total)} from ${biz.name || 'us'}. Thank you!`;

  try {
    const r = await wa.sendDocument(number, buffer, filename, caption);
    // Best-effort: if this party has no phone saved yet, remember it.
    try {
      if (inv.party_id && !inv.party_phone) {
        db.prepare('UPDATE parties SET phone=? WHERE id=? AND (phone IS NULL OR phone="")').run(String(number).replace(/[^\d+]/g, ''), inv.party_id);
      }
    } catch (_) {}
    res.json({ ok: true, to: r.to, number });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Failed to send on WhatsApp' });
  }
});

function money(n) { return '\u20b9' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

module.exports = router;
