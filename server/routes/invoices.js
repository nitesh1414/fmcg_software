const express = require('express');
const db = require('../db');
const { recalcAvgCost, findDuplicateBatch } = require('../stock');
const serialsLib = require('../serials');
const { businessContext, getBusiness } = require('../business');
const unitsLib = require('../units');
const router = express.Router();

// Optional tax-invoice detail fields (Consignee/Ship-to, dispatch, e-Invoice,
// order refs…). All optional; missing values default to ''. Returned as a flat
// object of column → value so it can be spread into INSERT/UPDATE params.
const INVOICE_DETAIL_FIELDS = [
  'consignee_name', 'consignee_address', 'consignee_gstin', 'consignee_state',
  'place_of_supply', 'eway_no', 'pay_terms', 'po_no', 'po_date', 'other_ref',
  'dispatch_doc', 'delivery_note', 'delivery_note_date', 'dispatched_through',
  'destination', 'terms_delivery', 'irn', 'ack_no', 'ack_date',
];
function invoiceDetails(b) {
  const out = {};
  for (const k of INVOICE_DETAIL_FIELDS) out[k] = (b && b[k] != null) ? String(b[k]) : '';
  return out;
}
const INVOICE_DETAIL_SET = INVOICE_DETAIL_FIELDS.map((k) => `${k}=@${k}`).join(', ');
const INVOICE_DETAIL_COLS = INVOICE_DETAIL_FIELDS.join(', ');
const INVOICE_DETAIL_VALS = INVOICE_DETAIL_FIELDS.map((k) => `@${k}`).join(', ');

// Resolve a line's quantity in BASE units, using the item's packaging ladder.
// `l.unit_factor` (base units per 1 billed unit) is authoritative when present;
// otherwise we look it up from the item's units by name. Falls back to factor 1.
function lineBaseQty(l) {
  const qty = Number(l.qty) || 0;
  let factor = Number(l.unit_factor);
  if (!factor || factor <= 0) {
    if (l.item_id && l.unit) {
      const item = db.prepare('SELECT id, unit, base_unit FROM items WHERE id=?').get(l.item_id);
      factor = unitsLib.factorFor(l.item_id, l.unit, item);
    } else {
      factor = 1;
    }
  }
  return { base: unitsLib.round3(qty * factor), factor };
}

// Resolve the active business for every invoice request.
router.use(businessContext);

// Generate next invoice/note number per business & type & note-kind
function nextInvoiceNo(type, noteKind, businessId) {
  const biz = getBusiness(businessId) || {};
  let prefix;
  if (noteKind === 'credit') prefix = 'CN';
  else if (noteKind === 'debit') prefix = 'DN';
  else if (type === 'quotation') prefix = 'QTN';
  else prefix = type === 'purchase' ? 'PUR' : (biz.invoice_prefix || 'INV');
  const count = db.prepare("SELECT COUNT(*) c FROM invoices WHERE type=? AND note_kind=? AND business_id=?")
    .get(type, noteKind || '', businessId).c;
  const num = String(count + 1).padStart(4, '0');
  return `${prefix}-${num}`;
}

// Compute a single line's tax math, incl. the three per-line discounts
// (Trade, CD, SD) applied sequentially on the running amount. Each discount is
// driven by its percentage; the resolved rupee amount is returned for storage.
function computeLine(line) {
  const qty = Number(line.qty) || 0;
  const price = Number(line.price) || 0;
  const gst = Number(line.gst_rate) || 0;
  const gross = qty * price;

  // Trade, CD and SD are each computed on the GROSS (qty × rate) — not
  // sequentially — then all three are subtracted from the gross. Each can be
  // entered as a percentage of gross OR as a flat rupee amount (mode='amt').
  // Example (%): qty 10 × rate 100 = 1000; TD 10% = 100, CD 10% = 100,
  // SD 10% = 100 → taxable = 1000 − 100 − 100 − 100 = 700.
  // Example (₹): the same works if TD/CD/SD are typed as 100/100/100 directly.
  const discOf = (pct, amt, mode) => {
    if (mode === 'amt') return round2(Math.min(Math.max(Number(amt) || 0, 0), gross));
    const p = Number(pct) || 0;
    if (p <= 0) return 0;
    return round2((gross * p) / 100);
  };
  const disc_trade_amt = discOf(line.disc_trade_pct, line.disc_trade_amt, line.disc_trade_mode);
  const disc_cd_amt = discOf(line.disc_cd_pct, line.disc_cd_amt, line.disc_cd_mode);
  const disc_sd_amt = discOf(line.disc_sd_pct, line.disc_sd_amt, line.disc_sd_mode);
  // Resolve each discount's % back from the amount so both are stored consistently.
  const disc_trade_pct = gross > 0 ? round2((disc_trade_amt / gross) * 100) : 0;
  const disc_cd_pct = gross > 0 ? round2((disc_cd_amt / gross) * 100) : 0;
  const disc_sd_pct = gross > 0 ? round2((disc_sd_amt / gross) * 100) : 0;
  let running = round2(gross - disc_trade_amt - disc_cd_amt - disc_sd_amt);
  // Legacy single per-line discount (%), applied only if the new ones are unused.
  if (!disc_trade_amt && !disc_cd_amt && !disc_sd_amt) {
    const dp = Number(line.discount) || 0;
    if (dp > 0) { running = round2(gross - round2((gross * dp) / 100)); }
  }

  const taxable = running;
  const taxAmount = (taxable * gst) / 100;
  return {
    taxable: round2(taxable),
    tax_amount: round2(taxAmount),
    line_total: round2(taxable + taxAmount),
    disc_trade_amt, disc_cd_amt, disc_sd_amt,
    disc_trade_pct, disc_cd_pct, disc_sd_pct,
  };
}
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Resolve a single optional bill-level "Extra Discount" on the grand total.
// Given as either a percentage (extra_disc_mode='pct') or a flat rupee amount.
// (The three Trade/CD/SD discounts now live per item line, not on the bill.)
function resolveExtraDiscount(b, base) {
  const v = Number(b.extra_disc_val) || 0;
  let amt = 0;
  if (v > 0) amt = b.extra_disc_mode === 'pct' ? round2((base * v) / 100) : round2(Math.min(v, base));
  // Legacy: a plain `discount` flat amount still works if extra isn't provided.
  if (amt === 0) { const legacy = Number(b.discount) || 0; if (legacy > 0) amt = round2(Math.min(legacy, base)); }
  return amt;
}

// Read company feature toggles (set via the F12 configuration panel)
function getFeatures() {
  try {
    const row = db.prepare('SELECT features FROM company WHERE id=1').get();
    return JSON.parse((row && row.features) || '{}');
  } catch (_) { return {}; }
}

router.get('/', (req, res) => {
  const { type, from, to, party_id } = req.query;
  let sql = `SELECT inv.*, p.name AS party_name FROM invoices inv
             LEFT JOIN parties p ON p.id = inv.party_id WHERE inv.business_id = ?`;
  const params = [req.businessId];
  if (type) { sql += ' AND inv.type = ?'; params.push(type); }
  if (party_id) { sql += ' AND inv.party_id = ?'; params.push(party_id); }
  if (from) { sql += ' AND inv.date >= ?'; params.push(from); }
  if (to) { sql += ' AND inv.date <= ?'; params.push(to); }
  sql += ' ORDER BY inv.date DESC, inv.id DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const inv = db
    .prepare(
      `SELECT inv.*, p.name AS party_name, p.gstin AS party_gstin, p.address AS party_address,
              p.phone AS party_phone, p.state AS party_state
       FROM invoices inv LEFT JOIN parties p ON p.id = inv.party_id WHERE inv.id = ?`
    )
    .get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  inv.items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(inv.id);
  // For purchases: attach each line's batch stock so the UI can warn if some of
  // the received quantity has already been sold (edit then becomes lossy).
  if (inv.type === 'purchase') {
    for (const it of inv.items) {
      if (it.batch_id) {
        const b = db.prepare('SELECT qty_in, qty_available FROM batches WHERE id = ?').get(it.batch_id);
        if (b) { it.batch_qty_in = b.qty_in; it.batch_qty_available = b.qty_available; it.batch_sold = Math.max(0, b.qty_in - b.qty_available); }
      }
    }
  }
  res.json(inv);
});

// Mark a quotation as converted and link it to the sale invoice created from it.
// The actual sale is created via the normal POST /invoices flow (so all stock,
// serial and payment logic runs exactly once); this just records the link.
router.post('/:id/mark-converted', (req, res) => {
  const quote = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!quote || quote.type !== 'quotation') return res.status(404).json({ error: 'Quotation not found' });
  const saleId = Number(req.body && req.body.invoice_id) || null;
  db.prepare("UPDATE invoices SET status='converted', converted_invoice_id=? WHERE id=?").run(saleId, quote.id);
  res.json(db.prepare('SELECT * FROM invoices WHERE id = ?').get(quote.id));
});

// Update a quotation's lifecycle status (open | accepted | rejected).
router.post('/:id/quote-status', (req, res) => {
  const quote = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!quote || quote.type !== 'quotation') return res.status(404).json({ error: 'Quotation not found' });
  const allowed = ['open', 'accepted', 'rejected'];
  const status = allowed.includes(req.body && req.body.status) ? req.body.status : 'open';
  db.prepare('UPDATE invoices SET status=? WHERE id=?').run(status, quote.id);
  res.json(db.prepare('SELECT * FROM invoices WHERE id = ?').get(quote.id));
});

// Create invoice (sale deducts stock FEFO; purchase adds a batch)
router.post('/', (req, res) => {
  const b = req.body || {};
  const type = b.type === 'purchase' ? 'purchase' : b.type === 'quotation' ? 'quotation' : 'sale';
  const lines = Array.isArray(b.items) ? b.items : [];
  if (lines.length === 0) return res.status(400).json({ error: 'At least one line item required' });

  const features = getFeatures();
  const isNote = b.note_kind === 'credit' || b.note_kind === 'debit';
  // Quotations are non-accounting: they never move stock, serials or payments.
  const isQuote = type === 'quotation';

  // Negative-stock guard for sales (unless explicitly allowed via F12 toggle).
  // Credit/Debit notes & quotations never touch stock, so they bypass this check.
  if (type === 'sale' && !isNote && features.negativeStock === false) {
    for (const l of lines) {
      if (!l.item_id) continue;
      const avail = db
        .prepare('SELECT COALESCE(SUM(qty_available),0) s FROM batches WHERE item_id=? AND business_id=?')
        .get(l.item_id, req.businessId).s;
      const need = lineBaseQty(l).base; // requested qty in base units
      if (need > avail) {
        const item = db.prepare('SELECT id, unit, base_unit FROM items WHERE id=?').get(l.item_id);
        const availLabel = unitsLib.humanizeQty(l.item_id, avail, item);
        return res.status(400).json({
          error: `Insufficient stock for "${l.item_name || 'item'}". Available ${availLabel} (${avail} ${unitsLib.baseUnitName(item)}), requested ${l.qty} ${l.unit || ''} = ${need} ${unitsLib.baseUnitName(item)}. (Enable "Allow negative stock" in F12 to override.)`,
        });
      }
    }
  }

  // Serial-number guards. For serial-tracked items:
  //  - SALE: every entered serial must exist and still be in stock (blocks
  //    selling the same serial twice).
  //  - PURCHASE: a serial can't already be in stock (would be a duplicate unit).
  if (!isNote) {
    for (const l of lines) {
      if (!l.item_id || !l.track_serials) continue;
      const serials = serialsLib.parseSerials(l.serials);
      if (!serials.length) continue;
      if (type === 'sale') {
        const v = serialsLib.validateSaleSerials(req.businessId, l.item_id, serials);
        if (!v.ok) {
          const parts = [];
          if (v.notInStock.length) parts.push('already sold / not in stock: ' + v.notInStock.join(', '));
          if (v.missing.length) parts.push('unknown serial(s): ' + v.missing.join(', '));
          return res.status(409).json({
            error: 'SERIAL_UNAVAILABLE',
            message: `Serial number issue for "${l.item_name || 'item'}" — ${parts.join('; ')}.`,
          });
        }
      } else if (type === 'purchase' && (b.allowDuplicate !== 1 && b.allowDuplicate !== '1')) {
        const dup = serials.filter((s) => serialsLib.findInStock(req.businessId, l.item_id, s));
        if (dup.length) {
          return res.status(409).json({
            error: 'DUPLICATE_SERIAL',
            message: `These serial number(s) for "${l.item_name || 'item'}" are already in stock: ${dup.join(', ')}. Confirm to add anyway.`,
          });
        }
      }
    }
  }

  // Duplicate serial/batch guard for purchases that create NEW batches.
  // Skipped when client passes allowDuplicate=1 (after user confirms the alert).
  if (type === 'purchase' && !isNote && features.duplicateSerialAlert !== false && b.allowDuplicate !== 1 && b.allowDuplicate !== '1') {
    for (const l of lines) {
      if (!l.item_id || l.batch_id) continue; // existing batch top-up is fine
      const dups = findDuplicateBatch(l.batch_no);
      if (dups.length > 0) {
        return res.status(409).json({
          error: 'DUPLICATE_BATCH',
          message: `Duplicate Serial/Batch "${l.batch_no}" already exists in stock (${dups.map((d) => d.item_name + (d.qty_available > 0 ? ' · in stock' : ' · sold out')).join(', ')}). Confirm to add anyway.`,
          matches: dups,
        });
      }
    }
  }

  const tx = db.transaction(() => {
    let subtotal = 0, taxTotal = 0, total = 0;
    const computed = lines.map((l) => {
      const c = computeLine(l);
      const bq = lineBaseQty(l);
      subtotal += c.taxable;
      taxTotal += c.tax_amount;
      total += c.line_total;
      return { ...l, ...c, _baseQty: bq.base, _unitFactor: bq.factor };
    });
    const headerDiscount = resolveExtraDiscount(b, round2(subtotal) + round2(taxTotal));
    total = round2(total - headerDiscount);
    // Round-off whole invoice to nearest rupee if enabled
    if (features.autoRoundOff) total = Math.round(total);

    const noteKind = b.note_kind === 'credit' ? 'credit' : b.note_kind === 'debit' ? 'debit' : '';
    const invNo = b.invoice_no || nextInvoiceNo(type, noteKind, req.businessId);
    // Received/Paid can never exceed the invoice total (defense in depth).
    // Quotations carry no payment — they are just an estimate.
    const paid = isQuote ? 0 : Math.min(Math.max(Number(b.paid) || 0, 0), total);
    // Quotation status tracks its lifecycle rather than payment.
    const status = isQuote
      ? (b.status === 'accepted' || b.status === 'rejected' || b.status === 'converted' ? b.status : 'open')
      : (paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid');
    const info = db
      .prepare(
        `INSERT INTO invoices (invoice_no, type, business_id, party_id, date, subtotal, discount,
            tax_total, total, paid, status, notes, note_kind, ref_invoice_no, ref_invoice_date, valid_until,
            ${INVOICE_DETAIL_COLS}, created_by)
         VALUES (@invoice_no,@type,@business_id,@party_id,@date,@subtotal,@discount,
            @tax_total,@total,@paid,@status,@notes,@note_kind,@ref_invoice_no,@ref_invoice_date,@valid_until,
            ${INVOICE_DETAIL_VALS}, @created_by)`
      )
      .run({
        invoice_no: invNo,
        type,
        business_id: req.businessId,
        party_id: b.party_id || null,
        date: b.date || new Date().toISOString().slice(0, 10),
        subtotal: round2(subtotal),
        discount: headerDiscount,
        tax_total: round2(taxTotal),
        total,
        paid,
        status,
        notes: b.notes || '',
        note_kind: noteKind,
        ref_invoice_no: b.ref_invoice_no || '',
        ref_invoice_date: b.ref_invoice_date || '',
        valid_until: isQuote ? (b.valid_until || '') : '',
        ...invoiceDetails(b),
        created_by: (req.user && req.user.id) || null,
      });
    const invoiceId = info.lastInsertRowid;

    for (const l of computed) {
      // Purchase of a product that isn't in the Item master yet (e.g. from an
      // Excel import or typed name) → auto-create the item so stock is tracked.
      if (type === 'purchase' && !noteKind && !l.item_id && l.item_name && String(l.item_name).trim()) {
        const nm = String(l.item_name).trim();
        const existing = db.prepare('SELECT id FROM items WHERE LOWER(name) = LOWER(?) LIMIT 1').get(nm);
        if (existing) {
          l.item_id = existing.id;
        } else {
          const it = db.prepare(
            `INSERT INTO items (name, sku, unit, hsn, gst_rate, purchase_price, sale_price, low_stock_alert)
             VALUES (?,?,?,?,?,?,?,?)`
          ).run(nm, '', 'PCS', l.hsn || '', Number(l.gst_rate) || 0, Number(l.price) || 0, Number(l.mrp) || 0, 0);
          l.item_id = it.lastInsertRowid;
        }
      }

      let batchId = l.batch_id || null;
      let batchNo = l.batch_no || '';
      // Stock always moves in BASE units (billed qty × packaging factor).
      const baseQty = Number(l._baseQty) || 0;
      // Purchase batch prices are stored per BASE unit so costing stays correct
      // regardless of which packaging unit was used to buy.
      const basePurchasePrice = (Number(l._unitFactor) || 1) > 0 ? round2((Number(l.price) || 0) / (Number(l._unitFactor) || 1)) : Number(l.price) || 0;
      const baseMrp = (Number(l._unitFactor) || 1) > 0 ? round2((Number(l.mrp) || 0) / (Number(l._unitFactor) || 1)) : Number(l.mrp) || 0;

      // Credit/Debit notes & quotations do NOT move stock.
      if (noteKind || isQuote) {
        // fall through to invoice_items insert without touching batches
      } else if (type === 'purchase') {
        // Create or top up a batch (within the active business)
        if (batchId) {
          db.prepare('UPDATE batches SET qty_available = qty_available + ?, qty_in = qty_in + ? WHERE id = ?')
            .run(baseQty, baseQty, batchId);
        } else if (l.item_id) {
          const binfo = db
            .prepare(
              `INSERT INTO batches (item_id, business_id, batch_no, mfg_date, expiry_date, purchase_price, mrp, qty_in, qty_available)
               VALUES (?,?,?,?,?,?,?,?,?)`
            )
            .run(
              l.item_id,
              req.businessId,
              batchNo || 'NA',
              l.mfg_date || '',
              l.expiry_date || '',
              basePurchasePrice,
              baseMrp,
              baseQty,
              baseQty
            );
          batchId = binfo.lastInsertRowid;
        }
      } else {
        // SALE: deduct from chosen batch, else FEFO across batches (in base units)
        let remaining = baseQty;
        if (batchId) {
          const bt = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
          if (bt) {
            const take = Math.min(remaining, bt.qty_available);
            db.prepare('UPDATE batches SET qty_available = qty_available - ? WHERE id = ?').run(take, batchId);
            batchNo = bt.batch_no;
            remaining -= take;
          }
        } else if (l.item_id) {
          const avail = db
            .prepare(
              `SELECT * FROM batches WHERE item_id = ? AND business_id = ? AND qty_available > 0
               ORDER BY (expiry_date = ''), expiry_date, id`
            )
            .all(l.item_id, req.businessId);
          const usedBatchNos = [];
          for (const bt of avail) {
            if (remaining <= 0) break;
            const take = Math.min(remaining, bt.qty_available);
            db.prepare('UPDATE batches SET qty_available = qty_available - ? WHERE id = ?').run(take, bt.id);
            usedBatchNos.push(bt.batch_no);
            if (!batchId) batchId = bt.id;
            remaining -= take;
          }
          batchNo = usedBatchNos.join(', ');
        }
      }

      db.prepare(
        `INSERT INTO invoice_items (invoice_id, item_id, batch_id, item_name, description, serials, batch_no, hsn, qty, unit, unit_factor, base_qty, price, discount,
            disc_trade_pct, disc_trade_amt, disc_cd_pct, disc_cd_amt, disc_sd_pct, disc_sd_amt,
            disc_trade_mode, disc_cd_mode, disc_sd_mode,
            gst_rate, taxable, tax_amount, line_total)
         VALUES (@invoice_id,@item_id,@batch_id,@item_name,@description,@serials,@batch_no,@hsn,@qty,@unit,@unit_factor,@base_qty,@price,@discount,
            @disc_trade_pct,@disc_trade_amt,@disc_cd_pct,@disc_cd_amt,@disc_sd_pct,@disc_sd_amt,
            @disc_trade_mode,@disc_cd_mode,@disc_sd_mode,
            @gst_rate,@taxable,@tax_amount,@line_total)`
      ).run({
        invoice_id: invoiceId,
        item_id: l.item_id || null,
        batch_id: batchId,
        item_name: l.item_name || '',
        description: l.description || '',
        serials: (Array.isArray(l.serials) ? l.serials.join(', ') : (l.serials || '')).trim(),
        batch_no: batchNo || '',
        hsn: l.hsn || '',
        qty: Number(l.qty) || 0,
        unit: l.unit || '',
        unit_factor: Number(l._unitFactor) || 1,
        base_qty: Number(l._baseQty) || 0,
        price: Number(l.price) || 0,
        discount: Number(l.discount) || 0,
        disc_trade_pct: Number(l.disc_trade_pct) || 0, disc_trade_amt: l.disc_trade_amt || 0,
        disc_cd_pct: Number(l.disc_cd_pct) || 0, disc_cd_amt: l.disc_cd_amt || 0,
        disc_sd_pct: Number(l.disc_sd_pct) || 0, disc_sd_amt: l.disc_sd_amt || 0,
        disc_trade_mode: l.disc_trade_mode === 'amt' ? 'amt' : 'pct',
        disc_cd_mode: l.disc_cd_mode === 'amt' ? 'amt' : 'pct',
        disc_sd_mode: l.disc_sd_mode === 'amt' ? 'amt' : 'pct',
        gst_rate: Number(l.gst_rate) || 0,
        taxable: l.taxable,
        tax_amount: l.tax_amount,
        line_total: l.line_total,
      });

      // Serial registry: register on purchase, mark sold on sale.
      // Quotations never affect the serial registry.
      if (!noteKind && !isQuote && l.item_id && l.track_serials) {
        const serials = serialsLib.parseSerials(l.serials);
        if (serials.length) {
          if (type === 'purchase') serialsLib.registerPurchaseSerials(req.businessId, l.item_id, batchNo, invoiceId, serials);
          else serialsLib.markSerialsSold(req.businessId, l.item_id, invoiceId, serials);
        }
      }

      // Keep moving-average cost in sync whenever stock changes
      if (l.item_id) recalcAvgCost(l.item_id);
    }

    // Record payment if paid > 0
    if (paid > 0 && b.party_id) {
      db.prepare(
        `INSERT INTO payments (party_id, invoice_id, business_id, type, amount, mode, date, notes)
         VALUES (?,?,?,?,?,?,?,?)`
      ).run(
        b.party_id,
        invoiceId,
        req.businessId,
        type === 'sale' ? 'in' : 'out',
        paid,
        b.pay_mode || 'cash',
        b.date || new Date().toISOString().slice(0, 10),
        'Auto payment with invoice ' + invNo
      );
    }

    return invoiceId;
  });

  try {
    const id = tx();
    res.json(db.prepare('SELECT * FROM invoices WHERE id = ?').get(id));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Reverse an invoice's stock effect (used by delete + edit):
//   sale  → restore qty to its batches
//   purchase → remove qty from its batches (down to 0)
function reverseInvoiceStock(inv) {
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(inv.id);
  const affected = new Set();
  for (const it of items) {
    if (it.item_id) affected.add(it.item_id);
    if (!it.batch_id) continue;
    // Reverse in BASE units (base_qty). Old rows had no base_qty → fall back to qty.
    const baseQ = Number(it.base_qty) > 0 ? Number(it.base_qty) : (Number(it.qty) || 0);
    if (inv.type === 'sale') {
      db.prepare('UPDATE batches SET qty_available = qty_available + ? WHERE id = ?').run(baseQ, it.batch_id);
    } else {
      db.prepare('UPDATE batches SET qty_available = MAX(0, qty_available - ?) WHERE id = ?').run(baseQ, it.batch_id);
    }
  }
  return affected;
}

// Update an existing invoice: reverse the old stock/payment, then re-apply the
// new lines — keeping the same invoice id & number. Runs entirely in one
// transaction so a stock error rolls everything back.
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });

  const b = req.body || {};
  const type = existing.type; // type is immutable on edit
  const lines = Array.isArray(b.items) ? b.items : [];
  if (lines.length === 0) return res.status(400).json({ error: 'At least one line item required' });

  const features = getFeatures();
  const noteKind = existing.note_kind || '';
  const isNote = noteKind === 'credit' || noteKind === 'debit';
  const isQuote = type === 'quotation';
  const bizId = existing.business_id || req.businessId;

  try {
    const tx = db.transaction(() => {
      // 1) Reverse old stock + serials + remove old lines & auto-payment.
      const affected = reverseInvoiceStock(existing);
      serialsLib.reverseInvoiceSerials(existing);
      db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(existing.id);
      db.prepare("DELETE FROM payments WHERE invoice_id = ? AND notes LIKE 'Auto payment with invoice%'").run(existing.id);

      // 2) Recompute totals.
      let subtotal = 0, taxTotal = 0, total = 0;
      const computed = lines.map((l) => {
        const c = computeLine(l);
        const bq = lineBaseQty(l);
        subtotal += c.taxable; taxTotal += c.tax_amount; total += c.line_total;
        return { ...l, ...c, _baseQty: bq.base, _unitFactor: bq.factor };
      });
      const headerDiscount = resolveExtraDiscount(b, round2(subtotal) + round2(taxTotal));
      total = round2(total - headerDiscount);
      if (features.autoRoundOff) total = Math.round(total);

      // 3) Sale stock guard (batches were restored above, so check live avail).
      if (type === 'sale' && !isNote && features.negativeStock === false) {
        for (const l of computed) {
          if (!l.item_id) continue;
          const avail = db.prepare('SELECT COALESCE(SUM(qty_available),0) s FROM batches WHERE item_id=? AND business_id=?').get(l.item_id, bizId).s;
          const need = Number(l._baseQty) || 0;
          if (need > avail) {
            const item = db.prepare('SELECT id, unit, base_unit FROM items WHERE id=?').get(l.item_id);
            throw new Error(`Insufficient stock for "${l.item_name || 'item'}". Available ${unitsLib.humanizeQty(l.item_id, avail, item)}, requested ${l.qty} ${l.unit || ''} = ${need} ${unitsLib.baseUnitName(item)}.`);
          }
        }
      }

      const paid = isQuote ? 0 : Math.min(Math.max(Number(b.paid) || 0, 0), total);
      const status = isQuote
        ? (b.status === 'accepted' || b.status === 'rejected' || b.status === 'converted' ? b.status : (existing.status || 'open'))
        : (paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid');
      db.prepare(
        `UPDATE invoices SET party_id=@party_id, date=@date, subtotal=@subtotal, discount=@discount,
          tax_total=@tax_total, total=@total, paid=@paid, status=@status, notes=@notes,
          ref_invoice_no=@ref_invoice_no, ref_invoice_date=@ref_invoice_date, valid_until=@valid_until,
          ${INVOICE_DETAIL_SET} WHERE id=@id`
      ).run({
        id: existing.id,
        party_id: b.party_id || null,
        date: b.date || existing.date,
        valid_until: isQuote ? (b.valid_until !== undefined ? b.valid_until : existing.valid_until) : existing.valid_until,
        subtotal: round2(subtotal), discount: headerDiscount, tax_total: round2(taxTotal),
        total, paid, status, notes: b.notes || '',
        ref_invoice_no: b.ref_invoice_no || '', ref_invoice_date: b.ref_invoice_date || '',
        ...invoiceDetails(b),
      });

      // 4) Re-apply lines + stock (same logic as create).
      for (const l of computed) {
        if (type === 'purchase' && !noteKind && !l.item_id && l.item_name && String(l.item_name).trim()) {
          const nm = String(l.item_name).trim();
          const ex = db.prepare('SELECT id FROM items WHERE LOWER(name) = LOWER(?) LIMIT 1').get(nm);
          if (ex) l.item_id = ex.id;
          else {
            const it = db.prepare(`INSERT INTO items (name, sku, unit, hsn, gst_rate, purchase_price, sale_price, low_stock_alert) VALUES (?,?,?,?,?,?,?,?)`)
              .run(nm, '', 'PCS', l.hsn || '', Number(l.gst_rate) || 0, Number(l.price) || 0, Number(l.mrp) || 0, 0);
            l.item_id = it.lastInsertRowid;
          }
        }
        let batchId = l.batch_id || null;
        let batchNo = l.batch_no || '';
        const baseQty = Number(l._baseQty) || 0;
        const uf = (Number(l._unitFactor) || 1) > 0 ? (Number(l._unitFactor) || 1) : 1;
        const basePurchasePrice = round2((Number(l.price) || 0) / uf);
        const baseMrp = round2((Number(l.mrp) || 0) / uf);
        if (noteKind || isQuote) {
          // notes & quotations don't move stock
        } else if (type === 'purchase') {
          if (batchId) {
            db.prepare('UPDATE batches SET qty_available = qty_available + ?, qty_in = qty_in + ? WHERE id = ?').run(baseQty, baseQty, batchId);
          } else if (l.item_id) {
            const binfo = db.prepare(`INSERT INTO batches (item_id, business_id, batch_no, mfg_date, expiry_date, purchase_price, mrp, qty_in, qty_available) VALUES (?,?,?,?,?,?,?,?,?)`)
              .run(l.item_id, bizId, batchNo || 'NA', l.mfg_date || '', l.expiry_date || '', basePurchasePrice, baseMrp, baseQty, baseQty);
            batchId = binfo.lastInsertRowid;
          }
        } else {
          let remaining = baseQty;
          if (batchId) {
            const bt = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
            if (bt) { const take = Math.min(remaining, bt.qty_available); db.prepare('UPDATE batches SET qty_available = qty_available - ? WHERE id = ?').run(take, batchId); batchNo = bt.batch_no; remaining -= take; }
          } else if (l.item_id) {
            const avail = db.prepare(`SELECT * FROM batches WHERE item_id = ? AND business_id = ? AND qty_available > 0 ORDER BY (expiry_date = ''), expiry_date, id`).all(l.item_id, bizId);
            const used = [];
            for (const bt of avail) { if (remaining <= 0) break; const take = Math.min(remaining, bt.qty_available); db.prepare('UPDATE batches SET qty_available = qty_available - ? WHERE id = ?').run(take, bt.id); used.push(bt.batch_no); if (!batchId) batchId = bt.id; remaining -= take; }
            batchNo = used.join(', ');
          }
        }
        db.prepare(
          `INSERT INTO invoice_items (invoice_id, item_id, batch_id, item_name, description, serials, batch_no, hsn, qty, unit, unit_factor, base_qty, price, discount,
              disc_trade_pct, disc_trade_amt, disc_cd_pct, disc_cd_amt, disc_sd_pct, disc_sd_amt,
              disc_trade_mode, disc_cd_mode, disc_sd_mode,
              gst_rate, taxable, tax_amount, line_total)
           VALUES (@invoice_id,@item_id,@batch_id,@item_name,@description,@serials,@batch_no,@hsn,@qty,@unit,@unit_factor,@base_qty,@price,@discount,
              @disc_trade_pct,@disc_trade_amt,@disc_cd_pct,@disc_cd_amt,@disc_sd_pct,@disc_sd_amt,
              @disc_trade_mode,@disc_cd_mode,@disc_sd_mode,
              @gst_rate,@taxable,@tax_amount,@line_total)`
        ).run({
          invoice_id: existing.id, item_id: l.item_id || null, batch_id: batchId,
          item_name: l.item_name || '', description: l.description || '',
          serials: (Array.isArray(l.serials) ? l.serials.join(', ') : (l.serials || '')).trim(),
          batch_no: batchNo || '', hsn: l.hsn || '', qty: Number(l.qty) || 0,
          unit: l.unit || '', unit_factor: Number(l._unitFactor) || 1, base_qty: Number(l._baseQty) || 0,
          price: Number(l.price) || 0,
          discount: Number(l.discount) || 0,
          disc_trade_pct: Number(l.disc_trade_pct) || 0, disc_trade_amt: l.disc_trade_amt || 0,
          disc_cd_pct: Number(l.disc_cd_pct) || 0, disc_cd_amt: l.disc_cd_amt || 0,
          disc_sd_pct: Number(l.disc_sd_pct) || 0, disc_sd_amt: l.disc_sd_amt || 0,
          disc_trade_mode: l.disc_trade_mode === 'amt' ? 'amt' : 'pct',
          disc_cd_mode: l.disc_cd_mode === 'amt' ? 'amt' : 'pct',
          disc_sd_mode: l.disc_sd_mode === 'amt' ? 'amt' : 'pct',
          gst_rate: Number(l.gst_rate) || 0,
          taxable: l.taxable, tax_amount: l.tax_amount, line_total: l.line_total,
        });
        // Serial registry: register on purchase, mark sold on sale.
        if (!noteKind && !isQuote && l.item_id && l.track_serials) {
          const serials = serialsLib.parseSerials(l.serials);
          if (serials.length) {
            if (type === 'purchase') serialsLib.registerPurchaseSerials(bizId, l.item_id, batchNo, existing.id, serials);
            else {
              const v = serialsLib.validateSaleSerials(bizId, l.item_id, serials);
              if (!v.ok) throw new Error(`Serial issue for "${l.item_name || 'item'}": ${[...v.notInStock.map((s) => s + ' (sold)'), ...v.missing.map((s) => s + ' (unknown)')].join(', ')}`);
              serialsLib.markSerialsSold(bizId, l.item_id, existing.id, serials);
            }
          }
        }
        if (l.item_id) affected.add(l.item_id);
      }

      // 5) Re-create the auto-payment if paid > 0.
      if (paid > 0 && b.party_id) {
        db.prepare(`INSERT INTO payments (party_id, invoice_id, business_id, type, amount, mode, date, notes) VALUES (?,?,?,?,?,?,?,?)`)
          .run(b.party_id, existing.id, bizId, type === 'sale' ? 'in' : 'out', paid, b.pay_mode || 'cash', b.date || existing.date, 'Auto payment with invoice ' + existing.invoice_no);
      }

      affected.forEach((id) => recalcAvgCost(id));
      return existing.id;
    });
    const id = tx();
    res.json(db.prepare('SELECT * FROM invoices WHERE id = ?').get(id));
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// Delete invoice (restore stock for sales, remove batch qty for purchases)
router.delete('/:id', (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  const tx = db.transaction(() => {
    const affected = reverseInvoiceStock(inv);
    serialsLib.reverseInvoiceSerials(inv);
    db.prepare('DELETE FROM payments WHERE invoice_id = ?').run(inv.id);
    db.prepare('DELETE FROM invoices WHERE id = ?').run(inv.id);
    affected.forEach((id) => recalcAvgCost(id));
  });
  tx();
  res.json({ ok: true });
});

module.exports = router;
