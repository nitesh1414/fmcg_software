// HSN suggestion + GSTIN decode/verify endpoints.
const express = require('express');
const { suggestHSN, hsnInfo, decodeGstin, fetchGstinOnline } = require('../lookup');
const router = express.Router();

// GET /api/lookup/hsn?q=shampoo|3305   → suggestions
router.get('/hsn', (req, res) => {
  res.json(suggestHSN(req.query.q || '', Number(req.query.limit) || 12));
});

// GET /api/lookup/hsn/:code → exact info (desc + gst rate)
router.get('/hsn/:code', (req, res) => {
  const info = hsnInfo(req.params.code);
  if (!info) return res.status(404).json({ error: 'HSN not found in local list' });
  res.json(info);
});

// GET /api/lookup/gstin/:gstin → offline decode, plus online enrichment if configured.
router.get('/gstin/:gstin', async (req, res) => {
  const decoded = decodeGstin(req.params.gstin);
  if (!decoded.formatValid) {
    return res.status(400).json({ ...decoded, error: 'Invalid GSTIN format (15 chars: 22AAAAA0000A1Z5)' });
  }
  // Online enrichment (name, address, etc.) when a provider is configured & reachable.
  let online = null;
  if (req.query.online !== '0') {
    try { online = await fetchGstinOnline(decoded.gstin); } catch (_) { online = null; }
  }
  res.json({ ...decoded, online: online || null, onlineAvailable: !!(online && !online.error) });
});

module.exports = router;
