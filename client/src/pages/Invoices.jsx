import { Fragment, useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, openPdf } from '../api/client';
import { Modal, useToast, StatusBadge, fmt, fmtN, today } from '../components/ui';
import { ListScreen } from '../components/ListScreen';
import { useScreenSetup, usePrint } from '../components/TallyFrame';
import { useHotkeys, useEnterNav } from '../keyboard';
import { downloadCSV } from '../api/csv';
import { useFeatures } from '../features';
import ProductSearch from '../components/ProductSearch';
import PartySearch from '../components/PartySearch';
import { BusinessInline } from '../components/BusinessSwitcher';
import { useBusiness } from '../business';
import { expiryInfo } from '../components/ui';

// Excel import pulls in the SheetJS library — load it only on demand so normal
// billing stays lightweight.
const PurchaseImport = lazy(() => import('../components/PurchaseImport'));

// Add N days to an ISO date string (yyyy-mm-dd).
function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Print respecting the F12 "in-app print preview" toggle.
function usePrintInvoice() {
  const preview = usePrint();
  const { features } = useFeatures();
  return (id, no) => {
    const path = '/pdf/invoice/' + id;
    if (features.printPreview && preview) preview(path, 'Voucher ' + (no || ''));
    else openPdf(path);
  };
}

export default function Invoices({ type }) {
  const toast = useToast();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const printInvoice = usePrintInvoice();
  const { features } = useFeatures();
  const isSale = type === 'sale';
  const isQuote = type === 'quotation';
  const [converting, setConverting] = useState(null); // quotation row being converted to a sale

  // Auto-deliver the bill PDF on WhatsApp right after a sale is saved, when the
  // "WhatsApp auto-send" setting is on. Silent if WhatsApp isn't linked.
  const maybeWhatsApp = async (id) => {
    if (!isSale || !id || !features.whatsappAutoSend) return;
    try {
      const st = await api.get('/whatsapp/status');
      if (!st || !st.available) return;
      if (st.status !== 'ready') { toast('WhatsApp not linked — open WhatsApp Connect to send bills'); return; }
      try {
        await api.post('/whatsapp/send-invoice', { invoice_id: id });
        toast('Bill sent on WhatsApp ✓');
      } catch (e) {
        if (e.code === 'NO_NUMBER' && features.whatsappAutoPrompt) {
          const num = prompt('No WhatsApp number saved for this customer.\nEnter a number to send the bill (or Cancel to skip):');
          if (num && num.trim()) {
            try { await api.post('/whatsapp/send-invoice', { invoice_id: id, number: num.trim() }); toast('Bill sent on WhatsApp ✓'); }
            catch (e2) { toast(e2.message || 'WhatsApp send failed'); }
          }
        } else { toast(e.message || 'WhatsApp send failed'); }
      }
    } catch (_) { /* status check failed — skip silently */ }
  };
  const [list, setList] = useState([]);
  const [creating, setCreating] = useState(false);
  const [noteCreating, setNoteCreating] = useState(null); // 'credit' | 'debit' | null

  // Deep link: /sales?new=credit|debit opens the note voucher
  useEffect(() => {
    const n = sp.get('new');
    if (n === 'credit' || n === 'debit') { setNoteCreating(n); setSp({}, { replace: true }); }
  }, [sp]);
  const [viewing, setViewing] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [range, setRange] = useState({ from: '', to: '' });

  const load = () => {
    let q = '/invoices?type=' + type;
    if (range.from) q += '&from=' + range.from;
    if (range.to) q += '&to=' + range.to;
    api.get(q).then(setList);
  };
  useEffect(() => { load(); }, [type, range]);
  // Refresh the list if the active business is changed (e.g. from a voucher).
  useEffect(() => {
    const h = () => load();
    window.addEventListener('rs-business-changed', h);
    return () => window.removeEventListener('rs-business-changed', h);
  }, [type, range]); // eslint-disable-line

  const del = async (row) => { if (!confirm('Delete ' + (isQuote ? 'quotation ' : 'invoice ') + row.invoice_no + '?' + (isQuote ? '' : ' Stock will be restored.'))) return; await api.del('/invoices/' + row.id); toast('Deleted'); load(); };
  const exportCsv = () => downloadCSV(isQuote ? 'quotations' : type + 's', list, [
    { key: 'invoice_no', label: isQuote ? 'Quotation' : 'Invoice' }, { key: 'date', label: 'Date' }, { key: 'party_name', label: 'Party' },
    { key: 'subtotal', label: 'Taxable' }, { key: 'tax_total', label: 'Tax' }, { key: 'total', label: 'Total' },
    ...(isQuote ? [{ key: 'valid_until', label: 'Valid Until' }] : [{ key: 'paid', label: 'Paid' }]), { key: 'status', label: 'Status' },
  ]);

  const totalAmt = list.reduce((s, i) => s + i.total, 0);
  const dueAmt = list.reduce((s, i) => s + (i.total - i.paid), 0);

  useScreenSetup({
    title: isQuote ? 'Quotations (F2)' : isSale ? 'Sales Voucher (F2)' : 'Purchase Voucher (F3)',
    sub: isQuote ? `${list.length} quotations · Total ${fmt(totalAmt)}` : `${list.length} vouchers · Total ${fmt(totalAmt)} · Due ${fmt(dueAmt)}`,
    buttons: isQuote ? [
      { key: 'f5', label: 'F5', text: 'New Quotation', onClick: () => setCreating(true) },
      { key: 'f2', label: 'F2', text: 'Edit', onClick: () => list.length && setEditingId(list[0].id) },
      { key: 'f8', label: 'F8/Del', text: 'Delete', onClick: () => list.length && del(list[0]) },
      { sep: true },
      { key: 'ctrl+e', label: 'Ctrl+E', text: 'Export CSV', onClick: exportCsv },
      { key: 'escape', label: 'Esc', text: 'Dashboard', onClick: () => nav('/') },
    ] : [
      { key: 'f5', label: 'F5', text: isSale ? 'New Sale' : 'New Purchase', onClick: () => setCreating(true) },
      { key: 'f2', label: 'F2', text: 'Edit', onClick: () => list.length && setEditingId(list[0].id) },
      { key: 'f6', label: 'F6', text: 'Credit Note', onClick: () => setNoteCreating('credit') },
      { key: 'f7', label: 'F7', text: 'Debit Note', onClick: () => setNoteCreating('debit') },
      { key: 'f8', label: 'F8/Del', text: 'Delete', onClick: () => list.length && del(list[0]) },
      { sep: true },
      { key: 'ctrl+e', label: 'Ctrl+E', text: 'Export CSV', onClick: exportCsv },
      { label: 'F12', text: 'Config', onClick: () => window.dispatchEvent(new CustomEvent('open-config')) },
      { key: 'escape', label: 'Esc', text: 'Dashboard', onClick: () => nav('/') },
    ],
  }, [list, totalAmt, dueAmt]);
  useHotkeys(isQuote
    ? { escape: () => nav('/'), f5: () => setCreating(true), f2: () => list.length && setEditingId(list[0].id) }
    : { escape: () => nav('/'), f5: () => setCreating(true), f2: () => list.length && setEditingId(list[0].id), f6: () => setNoteCreating('credit'), f7: () => setNoteCreating('debit') }, [nav, list]);

  return (
    <>
      <div className="filterbar">
        <span className="muted">Period</span>
        <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        <span className="muted">· ↑↓ move · Enter view · F5 new · F2 edit · F8 delete</span>
        <span style={{ marginLeft: 'auto' }}><BusinessInline label={isQuote ? 'Quoting as' : isSale ? 'Billing as' : 'Purchasing for'} /></span>
      </div>
      <ListScreen
        rows={list} onEnter={(r) => setViewing(r.id)} onDelete={del} deps={[range]}
        emptyIcon={isQuote ? '📝' : '🧾'} emptyText={isQuote ? 'No quotations. Press F5 to create one.' : 'No vouchers. Press F5 to create.'}
        extraHotkeys={{ 'ctrl+p': () => list[0] && printInvoice(list[0].id, list[0].invoice_no) }}
        columns={isQuote ? [
          { key: 'invoice_no', label: 'Quotation No', render: (r) => <b>{r.invoice_no}</b> },
          { key: 'date', label: 'Date' },
          { key: 'party_name', label: 'Customer', render: (r) => r.party_name || <span className="muted">Walk-in</span> },
          { key: 'valid_until', label: 'Valid Until', render: (r) => r.valid_until ? <ValidUntil date={r.valid_until} status={r.status} /> : <span className="muted">—</span> },
          { key: 'total', label: 'Total', align: 'right', render: (r) => fmt(r.total) },
          { key: 'status', label: 'Status', render: (r) => <QuoteStatusBadge status={r.status} /> },
          { key: 'act', label: '', align: 'right', render: (r) => (
            <span style={{ display: 'inline-flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
              <button className="btn btn-sm" onClick={() => setViewing(r.id)}>View</button>
              <button className="btn btn-sm" onClick={() => setEditingId(r.id)}>Edit</button>
              {r.status !== 'converted' && <button className="btn btn-sm" style={{ color: 'var(--teal-dark)', fontWeight: 600 }} onClick={() => setConverting(r)}>→ Sale</button>}
              <button className="btn btn-sm" style={{ color: 'var(--accent)' }} onClick={() => del(r)}>Delete</button>
            </span>
          ) },
        ] : [
          { key: 'invoice_no', label: 'Voucher No', render: (r) => <><b>{r.invoice_no}</b>{r.note_kind ? <span className={'badge ' + (r.note_kind === 'credit' ? 'badge-danger' : 'badge-warning')} style={{ marginLeft: 6 }}>{r.note_kind === 'credit' ? 'CN' : 'DN'}</span> : ''}</> },
          { key: 'date', label: 'Date' },
          { key: 'party_name', label: isSale ? 'Customer' : 'Supplier', render: (r) => r.party_name || <span className="muted">Walk-in</span> },
          { key: 'total', label: 'Total', align: 'right', render: (r) => fmt(r.total) },
          { key: 'paid', label: 'Paid', align: 'right', render: (r) => fmt(r.paid) },
          { key: 'due', label: 'Due', align: 'right', render: (r) => fmt(r.total - r.paid) },
          { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          { key: 'act', label: '', align: 'right', render: (r) => (
            <span style={{ display: 'inline-flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
              <button className="btn btn-sm" onClick={() => setViewing(r.id)}>View</button>
              <button className="btn btn-sm" onClick={() => setEditingId(r.id)}>Edit</button>
              <button className="btn btn-sm" style={{ color: 'var(--accent)' }} onClick={() => del(r)}>Delete</button>
            </span>
          ) },
        ]}
      />
      {creating && <VoucherForm type={type} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); load(); toast(isQuote ? 'Quotation saved' : 'Voucher saved'); if (id) { setViewing(id); maybeWhatsApp(id); } }} />}
      {noteCreating && <VoucherForm type={type} noteKind={noteCreating} onClose={() => setNoteCreating(null)} onSaved={(id) => { setNoteCreating(null); load(); toast((noteCreating === 'credit' ? 'Credit' : 'Debit') + ' note saved'); if (id) setViewing(id); }} />}
      {editingId && <VoucherForm type={type} editId={editingId} noteKind={(list.find((r) => r.id === editingId) || {}).note_kind || undefined} onClose={() => setEditingId(null)} onSaved={() => { setEditingId(null); load(); toast(isQuote ? 'Quotation updated' : 'Voucher updated'); }} />}
      {viewing && <VoucherView id={viewing} onClose={() => setViewing(null)} onEdit={(id) => { setViewing(null); setEditingId(id); }} onConvert={(row) => { setViewing(null); setConverting(row); }} />}
      {converting && <ConvertQuote quote={converting} onClose={() => setConverting(null)} onDone={() => { setConverting(null); load(); }} />}
    </>
  );
}

// Quotation status badge (open / accepted / rejected / converted).
function QuoteStatusBadge({ status }) {
  const map = { open: ['badge-warning', 'Open'], accepted: ['badge-success', 'Accepted'], rejected: ['badge-danger', 'Rejected'], converted: ['badge-primary', 'Converted'] };
  const [cls, label] = map[status] || map.open;
  return <span className={'badge ' + cls}>{label}</span>;
}

// Show a quote's validity date, flagged red once it has expired (unless converted).
function ValidUntil({ date, status }) {
  const expired = status !== 'converted' && date < today();
  return <span style={{ color: expired ? 'var(--accent)' : 'inherit', fontWeight: expired ? 600 : 400 }}>{date}{expired ? ' (expired)' : ''}</span>;
}

// Editable business selector inside the voucher — lets the user change which
// business (books) this bill posts to, right from the sale/purchase form.
// Hidden for single-business setups.
function BusinessPicker({ list, value, onChange, disabled }) {
  if (!list || list.length <= 1) return null;
  const active = list.filter((b) => b.active);
  return (
    <div className="entry-grid" style={{ gridTemplateColumns: '70px 1fr' }}>
      <label>Business</label>
      <select className="fld" data-noenter="1" value={value || ''} disabled={disabled} title={disabled ? 'Business cannot be changed on an existing voucher' : ''} onChange={(e) => onChange(e.target.value)} style={{ fontWeight: 600 }}>
        {active.map((b) => <option key={b.id} value={b.id}>{b.name}{b.is_default ? ' (default)' : ''}</option>)}
      </select>
    </div>
  );
}

// Bill-level discount row with a % / ₹ toggle and the resolved rupee amount.
// Inline per-line discount cell: two stacked correlated boxes (% on top, ₹
// below). Editing one updates the other. `which` = 'trade' | 'cd' | 'sd'.
function LineDiscCell({ line, which, idx, setLineDisc }) {
  // The side the user typed (mode) shows their raw value; the other side is
  // derived live from the line gross so both stay in sync — including after a
  // qty/rate change (a ₹ discount keeps its rupee value, % recomputes).
  const mode = line['disc_' + which + '_mode'] === 'amt' ? 'amt' : 'pct';
  const gross = (Number(line.qty) || 0) * (Number(line.price) || 0);
  let pct = line['disc_' + which + '_pct'];
  let amt = line['disc_' + which + '_amt'];
  if (mode === 'amt') pct = gross > 0 ? round2c((round2c(Math.min(Number(amt) || 0, gross)) / gross) * 100) : 0;
  else amt = gross > 0 ? round2c((gross * (Number(pct) || 0)) / 100) : 0;
  const norm = (v) => (v === 0 || v === '0' || v === '' || v == null ? '' : v);
  return (
    <div className="disc-stack">
      <div className="disc-in"><input type="number" min="0" step="0.01" value={norm(pct)} placeholder="0" title="Discount %"
        onChange={(e) => setLineDisc(idx, which, 'pct', e.target.value)} /><span>%</span></div>
      <div className="disc-in"><input type="number" min="0" step="0.01" value={norm(amt)} placeholder="0" title="Discount ₹"
        onChange={(e) => setLineDisc(idx, which, 'amt', e.target.value)} /><span>₹</span></div>
    </div>
  );
}

function blankLine() {
  return {
    item_id: '', item_name: '', description: '', serials: '', track_serials: 0, hsn: '',
    batch_id: '', batch_no: '', qty: 1, price: 0, discount: 0, gst_rate: 0, mrp: 0, expiry_date: '', _batches: [],
    // Unit Conversion Engine: chosen packaging unit + its factor (base units per
    // 1 of this unit). `_units` holds the item's ladder for the dropdown.
    unit: '', unit_factor: 1, _units: [], _baseUnit: '', _stockBase: null,
    // Per-line discounts (Trade, CD, SD). Each has a % and a ₹ box that stay in
    // sync; whichever side the user last edited is authoritative (mode).
    // Each is computed on the line gross (qty × rate).
    disc_trade_pct: 0, disc_trade_amt: 0, disc_cd_pct: 0, disc_cd_amt: 0, disc_sd_pct: 0, disc_sd_amt: 0,
    disc_trade_mode: 'pct', disc_cd_mode: 'pct', disc_sd_mode: 'pct',
    _showDisc: false,
  };
}

// Compute the resolved rupee amounts for a line's three discounts. Each of
// Trade, CD and SD is calculated on the GROSS (qty × rate) independently, then
// all three are subtracted. Each can be entered as a % OR a flat ₹ amount
// (mode); whichever the user typed is authoritative.
// e.g. gross 1000 with TD/CD/SD 10% each → 100 + 100 + 100 → taxable 700.
// Same result if TD/CD/SD are typed as ₹100 each.
function lineDiscAmounts(l) {
  const gross = (Number(l.qty) || 0) * (Number(l.price) || 0);
  const step = (which) => {
    const mode = l['disc_' + which + '_mode'];
    if (mode === 'amt') return round2c(Math.min(Math.max(Number(l['disc_' + which + '_amt']) || 0, 0), gross));
    const p = Number(l['disc_' + which + '_pct']) || 0;
    if (p <= 0) return 0;
    return round2c((gross * p) / 100);
  };
  const t = step('trade');
  const c = step('cd');
  const s = step('sd');
  const total = round2c(t + c + s);
  return { gross, trade: t, cd: c, sd: s, total, taxableBase: round2c(gross - total) };
}
const round2c = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Every discount (Trade, CD, SD) applies on the same base — the line gross.
function discBase(l) {
  return (Number(l.qty) || 0) * (Number(l.price) || 0);
}

// Serial-number capture for a serial-tracked line (e.g. CCTV cameras).
// One serial per unit; count should match the line quantity.
function SerialModal({ line, isSale, onClose, onSave }) {
  const qty = Math.max(1, Math.round(Number(line.qty) || 0));
  const initial = (line.serials || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  const [rows, setRows] = useState(() => {
    const arr = initial.slice(0, Math.max(qty, initial.length));
    while (arr.length < qty) arr.push('');
    return arr;
  });
  const [available, setAvailable] = useState(null); // in-stock serials for a sale (null=not loaded)

  // For SALES of a serial-tracked item, load which serials are in stock so we
  // can offer them and block picking a sold/unknown one.
  useEffect(() => {
    if (isSale && line.item_id) {
      api.get('/serials/in-stock?item_id=' + line.item_id).then((r) => setAvailable(r.map((x) => x.serial_no))).catch(() => setAvailable([]));
    }
  }, [isSale, line.item_id]);
  const availSet = useMemo(() => new Set((available || []).map((s) => s.toLowerCase())), [available]);

  const setRow = (i, v) => setRows((cur) => cur.map((s, j) => (j === i ? v : s)));
  const addRow = () => setRows((cur) => [...cur, '']);
  const rmRow = (i) => setRows((cur) => cur.filter((_, j) => j !== i));
  const filled = rows.map((s) => s.trim()).filter(Boolean);

  // Per-row validation state.
  const lowerCounts = filled.reduce((m, s) => { const k = s.toLowerCase(); m[k] = (m[k] || 0) + 1; return m; }, {});
  const rowState = (s) => {
    const v = s.trim(); if (!v) return null;
    const k = v.toLowerCase();
    if (lowerCounts[k] > 1) return { cls: 'dup', msg: 'Duplicate in this list' };
    if (isSale && available !== null && !availSet.has(k)) return { cls: 'bad', msg: 'Not in stock' };
    return { cls: 'ok', msg: '' };
  };
  const dupCount = Object.values(lowerCounts).filter((n) => n > 1).length;
  const notInStock = isSale && available !== null ? filled.filter((s) => !availSet.has(s.toLowerCase())) : [];

  const save = () => {
    if (dupCount > 0) return; // block duplicates within the line
    if (notInStock.length > 0) return; // block selling serials not in stock
    onSave(filled.join(', '));
  };
  const onPaste = (i) => (e) => {
    const txt = (e.clipboardData || window.clipboardData).getData('text');
    if (/[\n,]/.test(txt)) {
      e.preventDefault();
      const vals = txt.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      setRows((cur) => { const next = [...cur]; vals.forEach((v, k) => { next[i + k] = v; }); return next; });
    }
  };
  useHotkeys({ 'ctrl+a': save }, [rows, available], { modal: true, popup: true });

  const blocked = dupCount > 0 || notInStock.length > 0;
  return (
    <Modal size="lg" title={`Serial Numbers — ${line.item_name || 'Item'}`} onClose={onClose} onAccept={save}
      footer={<><span className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>{filled.length} of {qty} entered{blocked ? ' · fix highlighted serials' : ''}</span><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" data-accept="1" disabled={blocked} onClick={save}>Save Serials</button></>}>
      <div className="alert" style={{ background: '#fff7e6', border: '1px solid var(--border)', marginBottom: 10, fontSize: 12.5 }}>
        Enter one serial number per unit (Qty {qty}). Duplicates {isSale ? 'and serials not in stock ' : ''}are blocked. Tip: paste a list to fill many at once.
        {isSale && available !== null && <div style={{ marginTop: 4 }} className="muted">{available.length} serial(s) in stock for this item.</div>}
      </div>
      {blocked && (
        <div className="alert alert-danger" style={{ marginBottom: 10, fontSize: 12.5 }}>
          {dupCount > 0 && <div>⚠ Duplicate serial number(s) entered — each unit needs a unique serial.</div>}
          {notInStock.length > 0 && <div>⚠ Not in stock / already sold: <b>{notInStock.join(', ')}</b></div>}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {rows.map((s, i) => {
          const st = rowState(s);
          const border = st && st.cls === 'ok' ? '1px solid #16a34a' : st && st.cls !== 'ok' ? '1px solid var(--accent)' : undefined;
          return (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span className="muted" style={{ width: 22, textAlign: 'right', fontSize: 12 }}>{i + 1}.</span>
              <input className="fld" list={isSale ? 'serials-avail' : undefined} value={s} placeholder={'Serial ' + (i + 1)} onChange={(e) => setRow(i, e.target.value)} onPaste={onPaste(i)} style={{ flex: 1, border }} title={st ? st.msg : ''} />
              <button type="button" className="btn btn-sm" tabIndex={-1} onClick={() => rmRow(i)}>✕</button>
            </div>
          );
        })}
      </div>
      {isSale && available && (
        <datalist id="serials-avail">{available.map((s) => <option key={s} value={s} />)}</datalist>
      )}
      <button type="button" className="btn btn-sm" style={{ marginTop: 10 }} onClick={addRow}>＋ Add serial</button>
    </Modal>
  );
}

// Optional tax-invoice detail fields (Consignee/Ship-to, dispatch, order refs,
// e-Invoice IRN…). Collapsed by default; each group is shown only when the
// matching F12 → Bill Format toggle is ON. Nothing here is mandatory.
function InvoiceDetails({ head, setHead, features, open, setOpen }) {
  const on = (k, def = true) => (features[k] === undefined ? def : !!features[k]);
  const set = (k) => (e) => setHead((h) => ({ ...h, [k]: e.target.value }));
  const F = (label, k, type = 'text', ph = '') => (
    <div className="fld-wrap"><label>{label}</label><input className="fld" type={type} value={head[k] || ''} onChange={set(k)} placeholder={ph} /></div>
  );
  // Which groups are enabled — if none, don't render the panel at all.
  const anyBuyer = on('billOrderRef') || on('billEwayNo') || on('billPlaceOfSupply');
  const anyDispatch = on('billDispatch');
  const anyConsignee = on('billConsignee');
  const anyEinv = on('billEInvoice');
  if (!(anyBuyer || anyDispatch || anyConsignee || anyEinv)) return null;

  // Count filled optional fields for the collapsed summary chip.
  const keys = ['consignee_name','consignee_address','consignee_gstin','consignee_state','place_of_supply','eway_no','pay_terms','po_no','po_date','other_ref','dispatch_doc','delivery_note','delivery_note_date','dispatched_through','destination','terms_delivery','irn','ack_no','ack_date'];
  const filled = keys.filter((k) => head[k] && String(head[k]).trim()).length;

  return (
    <div className="inv-details">
      <button type="button" className="inv-details-toggle" onClick={() => setOpen(!open)} data-noenter="1" tabIndex={-1}>
        <span>{open ? '▾' : '▸'} Invoice Details <span className="muted" style={{ fontWeight: 400 }}>· optional (Ship-to, dispatch, e-Way, e-Invoice…)</span></span>
        {filled > 0 && <span className="badge badge-success" style={{ marginLeft: 8 }}>{filled} filled</span>}
      </button>
      {open && (
        <div className="inv-details-body">
          {anyConsignee && (
            <div className="fcard">
              <div className="fcard-head"><span className="fc-ico">🚚</span> Consignee (Ship to) <span className="fc-sub">leave blank to use the customer</span></div>
              <div className="fgrid">
                {F('Name', 'consignee_name')}
                {F('GSTIN', 'consignee_gstin')}
                <div className="fld-wrap fwide"><label>Address</label><input className="fld" value={head.consignee_address || ''} onChange={set('consignee_address')} /></div>
                {F('State', 'consignee_state')}
                {on('billPlaceOfSupply') && F('Place of Supply', 'place_of_supply')}
              </div>
            </div>
          )}
          {(anyBuyer) && (
            <div className="fcard">
              <div className="fcard-head"><span className="fc-ico">📄</span> Order &amp; References</div>
              <div className="fgrid">
                {on('billOrderRef') && F("Buyer's Order No.", 'po_no')}
                {on('billOrderRef') && F('Order Date', 'po_date', 'date')}
                {on('billOrderRef') && F('Reference No. & Date', 'other_ref')}
                {on('billEwayNo') && F('e-Way Bill No.', 'eway_no')}
                {F('Mode/Terms of Payment', 'pay_terms')}
              </div>
            </div>
          )}
          {anyDispatch && (
            <div className="fcard">
              <div className="fcard-head"><span className="fc-ico">📦</span> Dispatch / Transport</div>
              <div className="fgrid">
                {F('Delivery Note', 'delivery_note')}
                {F('Delivery Note Date', 'delivery_note_date', 'date')}
                {F('Dispatch Doc No.', 'dispatch_doc')}
                {F('Dispatched through', 'dispatched_through')}
                {F('Destination', 'destination')}
                {F('Terms of Delivery', 'terms_delivery')}
              </div>
            </div>
          )}
          {anyEinv && (
            <div className="fcard">
              <div className="fcard-head"><span className="fc-ico">🔗</span> e-Invoice (IRN) <span className="fc-sub">enter after generating on the GST portal</span></div>
              <div className="fgrid">
                <div className="fld-wrap fwide"><label>IRN</label><input className="fld" value={head.irn || ''} onChange={set('irn')} /></div>
                {F('Ack No.', 'ack_no')}
                {F('Ack Date', 'ack_date', 'date')}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function VoucherForm({ type, onClose, onSaved, noteKind, editId, initialData }) {
  const toast = useToast();
  const { features } = useFeatures();
  const { list: bizList, activeId: bizId, multi: multiBiz, setActive: setBiz } = useBusiness();
  const isSale = type === 'sale';
  const isQuote = type === 'quotation';
  const isNote = noteKind === 'credit' || noteKind === 'debit';
  const isEdit = !!editId;
  // Quotations & sales both pick a customer and use sale prices.
  const custSide = isSale || isQuote;
  const noteLabel = noteKind === 'credit' ? 'Credit Note' : noteKind === 'debit' ? 'Debit Note' : '';
  const enterNav = useEnterNav();
  const [items, setItems] = useState([]);
  const [parties, setParties] = useState([]);
  const [head, setHead] = useState({
    party_id: '', date: today(), discount: 0, paid: 0, pay_mode: features.defaultPayMode || 'cash', notes: '', ref_invoice_no: '', ref_invoice_date: '',
    extra_disc_val: 0, extra_disc_mode: 'pct',
    // Quotation validity: default 15 days from today.
    valid_until: type === 'quotation' ? addDays(today(), 15) : '',
    // Optional tax-invoice detail fields (all blank; never mandatory).
    consignee_name: '', consignee_address: '', consignee_gstin: '', consignee_state: '',
    place_of_supply: '', eway_no: '', pay_terms: '', po_no: '', po_date: '', other_ref: '',
    dispatch_doc: '', delivery_note: '', delivery_note_date: '', dispatched_through: '', destination: '', terms_delivery: '',
    irn: '', ack_no: '', ack_date: '',
  });
  const [showDetails, setShowDetails] = useState(false);
  const [lines, setLines] = useState([blankLine()]);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [soldWarning, setSoldWarning] = useState(null); // {items:[{name,sold}], ...} when editing a purchase whose stock was partly sold
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [serialFor, setSerialFor] = useState(null); // line index whose serials modal is open

  // Append imported purchase lines (replacing the initial empty row if unused).
  const importLines = (imported) => {
    setLines((cur) => {
      const kept = cur.filter((l) => l.item_name && String(l.item_name).trim());
      return [...kept, ...imported.map((l) => ({ ...blankLine(), ...l }))];
    });
    setImportOpen(false);
  };

  // Feature-driven column visibility (set via F12)
  // Quotations don't reserve stock, so the batch/expiry picker is hidden.
  const showBatch = features.enableBatch && !isQuote;
  const showDisc = features.enableDiscount;
  const showGST = features.enableGST;
  // Discount entry style: 'tcs' = Trade/CD/SD columns (default), 'pct' = single % column.
  const discMode = features.discountMode === 'pct' ? 'pct' : 'tcs';
  const showTCS = showDisc && discMode === 'tcs';
  const showPctDisc = showDisc && discMode === 'pct';

  // Load items (with business-scoped stock) + parties. Re-runs when the active
  // business changes so the voucher reflects the selected firm's stock.
  useEffect(() => {
    api.get('/items').then(setItems);
    api.get('/parties?type=' + (custSide ? 'customer' : 'supplier')).then(setParties);
  }, [bizId]);

  // Hydrate each line's packaging ladder (`_units`) from the loaded item master
  // — needed after edit-load (lines arrive without `_units`) so the unit picker
  // and base-qty preview work.
  useEffect(() => {
    if (!items.length) return;
    setLines((cur) => cur.map((l) => {
      if (!l.item_id || (l._units && l._units.length)) return l;
      const it = items.find((x) => x.id === Number(l.item_id));
      if (!it || !Array.isArray(it.units) || !it.units.length) return l;
      return { ...l, _units: it.units, _baseUnit: it.base_unit || it.unit || '', unit: l.unit || (it.base_unit || it.unit || ''), _stockBase: it.stock != null ? Number(it.stock) : l._stockBase };
    }));
  }, [items]);

  // Prefill from a source document (e.g. converting a quotation to a sale).
  // Only runs on create (no editId) and only once.
  useEffect(() => {
    if (editId || !initialData) return;
    if (initialData.party_id != null) setHead((h) => ({ ...h, party_id: initialData.party_id || '', notes: initialData.notes || h.notes, extra_disc_val: initialData.extra_disc_val || 0, extra_disc_mode: initialData.extra_disc_mode || 'pct' }));
    if (Array.isArray(initialData.items) && initialData.items.length) {
      setLines(initialData.items.map((it) => ({
        ...blankLine(),
        item_id: it.item_id || '', item_name: it.item_name || '', description: it.description || '',
        hsn: it.hsn || '', qty: it.qty, price: it.price, gst_rate: it.gst_rate,
        unit: it.unit || '', unit_factor: Number(it.unit_factor) || 1,
        disc_trade_pct: it.disc_trade_pct || 0, disc_trade_amt: it.disc_trade_amt || 0,
        disc_cd_pct: it.disc_cd_pct || 0, disc_cd_amt: it.disc_cd_amt || 0,
        disc_sd_pct: it.disc_sd_pct || 0, disc_sd_amt: it.disc_sd_amt || 0,
        disc_trade_mode: it.disc_trade_mode === 'amt' ? 'amt' : 'pct',
        disc_cd_mode: it.disc_cd_mode === 'amt' ? 'amt' : 'pct',
        disc_sd_mode: it.disc_sd_mode === 'amt' ? 'amt' : 'pct',
        discount: it.discount || 0,
      })));
    }
  }, [initialData, editId]); // eslint-disable-line

  // Edit mode: load the existing invoice and prefill head + lines.
  useEffect(() => {
    if (!editId) return;
    api.get('/invoices/' + editId).then((inv) => {
      setInvoiceNo(inv.invoice_no || '');
      setHead({
        party_id: inv.party_id || '',
        date: inv.date || today(),
        discount: inv.discount || 0,
        paid: inv.paid || 0,
        pay_mode: features.defaultPayMode || 'cash',
        notes: inv.notes || '',
        ref_invoice_no: inv.ref_invoice_no || '',
        ref_invoice_date: inv.ref_invoice_date || '',
        extra_disc_val: inv.discount || 0, extra_disc_mode: 'amt',
        valid_until: inv.valid_until || '',
        consignee_name: inv.consignee_name || '', consignee_address: inv.consignee_address || '', consignee_gstin: inv.consignee_gstin || '', consignee_state: inv.consignee_state || '',
        place_of_supply: inv.place_of_supply || '', eway_no: inv.eway_no || '', pay_terms: inv.pay_terms || '', po_no: inv.po_no || '', po_date: inv.po_date || '', other_ref: inv.other_ref || '',
        dispatch_doc: inv.dispatch_doc || '', delivery_note: inv.delivery_note || '', delivery_note_date: inv.delivery_note_date || '', dispatched_through: inv.dispatched_through || '', destination: inv.destination || '', terms_delivery: inv.terms_delivery || '',
        irn: inv.irn || '', ack_no: inv.ack_no || '', ack_date: inv.ack_date || '',
      });
      // Auto-expand the details panel if the invoice already has any of them.
      if (inv.consignee_name || inv.eway_no || inv.po_no || inv.dispatch_doc || inv.irn || inv.place_of_supply || inv.dispatched_through || inv.destination) setShowDetails(true);
      setLines((inv.items || []).map((it) => ({
        ...blankLine(),
        item_id: it.item_id || '',
        item_name: it.item_name || '',
        description: it.description || '',
        serials: it.serials || '',
        hsn: it.hsn || '',
        batch_id: it.batch_id || '',
        batch_no: it.batch_no || '',
        qty: it.qty, price: it.price, discount: it.discount, gst_rate: it.gst_rate,
        unit: it.unit || '', unit_factor: Number(it.unit_factor) || 1,
        disc_trade_pct: it.disc_trade_pct || 0, disc_trade_amt: it.disc_trade_amt || 0,
        disc_cd_pct: it.disc_cd_pct || 0, disc_cd_amt: it.disc_cd_amt || 0,
        disc_sd_pct: it.disc_sd_pct || 0, disc_sd_amt: it.disc_sd_amt || 0,
        disc_trade_mode: it.disc_trade_mode === 'amt' ? 'amt' : 'pct',
        disc_cd_mode: it.disc_cd_mode === 'amt' ? 'amt' : 'pct',
        disc_sd_mode: it.disc_sd_mode === 'amt' ? 'amt' : 'pct',
        expiry_date: '',
        _showDesc: !!(it.description || it.serials),
        _showDisc: !!((it.disc_trade_amt || 0) + (it.disc_cd_amt || 0) + (it.disc_sd_amt || 0)),
      })));
      // Warn if this is a purchase whose received stock has already been (partly) sold.
      if (inv.type === 'purchase') {
        const sold = (inv.items || [])
          .filter((it) => (it.batch_sold || 0) > 0)
          .map((it) => ({ name: it.item_name, sold: it.batch_sold, batch: it.batch_no }));
        setSoldWarning(sold.length ? sold : null);
      }
    }).catch((e) => toast(e.message || 'Could not load voucher'));
  }, [editId]);

  // Switch which business this voucher posts to (no page reload). Clears any
  // chosen batches/stock on existing lines since they belong to the old firm.
  const changeBusiness = (id) => {
    if (!id || id === bizId) return;
    setBiz(Number(id));
    setLines((cur) => cur.map((l) => ({ ...l, batch_id: '', batch_no: '', _batches: [] })));
    const b = bizList.find((x) => x.id === Number(id));
    toast('Business changed to ' + (b ? b.name : ''));
  };

  // Pick the price for a unit row given sale/purchase context (falls back to
  // base × factor when a unit has no explicit price set).
  const unitPrice = (u, ladder) => {
    const p = custSide ? Number(u.sale_price) : Number(u.purchase_price);
    if (p > 0) return p;
    const base = ladder.find((x) => x.is_base) || ladder[0];
    const bp = base ? (custSide ? Number(base.sale_price) : Number(base.purchase_price)) : 0;
    return round2c((bp || 0) * (Number(u.factor) || 1));
  };

  const pickItem = (idx, it) => {
    setLines((cur) => cur.map((l, i) => {
      if (i !== idx) return l;
      if (!it) return { ...blankLine() };
      const ladder = Array.isArray(it.units) && it.units.length ? it.units : [{ unit_name: it.base_unit || it.unit || 'PCS', factor: 1, is_base: 1, purchase_price: it.purchase_price, sale_price: it.sale_price }];
      const baseRow = ladder.find((u) => u.is_base) || ladder[0];
      const price = unitPrice(baseRow, ladder);
      return { ...l, item_id: it.id, item_name: it.name, description: it.description || l.description || '', track_serials: it.track_serials ? 1 : 0, serials: '', hsn: it.hsn, gst_rate: it.gst_rate, price, batch_id: '', batch_no: '', expiry_date: '', unit: baseRow.unit_name, unit_factor: Number(baseRow.factor) || 1, _units: ladder, _baseUnit: it.base_unit || baseRow.unit_name, _stockBase: it.stock != null ? Number(it.stock) : null };
    }));
    if (it && isSale) {
      // Load only batches that still have unsold stock (qty_available > 0),
      // ordered nearest-expiry first, so the user sees expiry dates.
      api.get('/items/' + it.id).then((full) => {
        const avail = (full.batches || []).filter((b) => b.qty_available > 0);
        setLines((cur) => cur.map((l, i) => (i === idx ? { ...l, _batches: avail } : l)));
      });
    }
  };

  // Change the packaging unit on a line → update factor + auto-fill unit price.
  const setLineUnit = (idx, unitName) => setLines((cur) => cur.map((l, i) => {
    if (i !== idx) return l;
    const ladder = l._units || [];
    const u = ladder.find((x) => x.unit_name === unitName) || ladder.find((x) => x.is_base) || ladder[0];
    if (!u) return { ...l, unit: unitName };
    return { ...l, unit: u.unit_name, unit_factor: Number(u.factor) || 1, price: unitPrice(u, ladder) };
  }));

  const [focusRow, setFocusRow] = useState({ idx: 0, n: 0 });
  const setLine = (idx, k, v) => setLines((cur) => cur.map((l, i) => (i === idx ? { ...l, [k]: v } : l)));
  // Set one side of a per-line discount (% or ₹) and keep the other in sync.
  // Both Trade, CD and SD compute on the same base — the line gross (qty×rate).
  // The side the user typed becomes authoritative (mode = 'pct' | 'amt') so the
  // entered value is used exactly (rupee amounts aren't lost to % round-trips).
  // `which` = 'trade' | 'cd' | 'sd'; `side` = 'pct' | 'amt'.
  const setLineDisc = (idx, which, side, raw) => setLines((cur) => cur.map((l, i) => {
    if (i !== idx) return l;
    const next = { ...l };
    const base = discBase(next);
    const v = Number(raw) || 0;
    next['disc_' + which + '_mode'] = side; // remember which side the user edited
    if (side === 'pct') {
      next['disc_' + which + '_pct'] = raw;
      next['disc_' + which + '_amt'] = base > 0 ? round2c((base * v) / 100) : 0;
    } else {
      const amt = Math.min(v, base);
      next['disc_' + which + '_amt'] = raw;
      next['disc_' + which + '_pct'] = base > 0 ? round2c((amt / base) * 100) : 0;
    }
    return next;
  }));
  const addLine = () => setLines((cur) => {
    const next = [...cur, blankLine()];
    // Focus the Item field of the newly-added (last) row.
    setTimeout(() => setFocusRow({ idx: next.length - 1, n: Date.now() }), 0);
    return next;
  });
  const rmLine = (idx) => setLines((cur) => cur.length === 1 ? cur : cur.filter((_, i) => i !== idx));

  // Resolved discount amount for a line, honouring the configured mode.
  const lineDiscAmt = (l) => {
    if (showTCS) return lineDiscAmounts(l).total;
    if (showPctDisc) { const gross = (Number(l.qty) || 0) * (Number(l.price) || 0); return round2c((gross * (Number(l.discount) || 0)) / 100); }
    return 0;
  };
  const calc = (l) => {
    const gross = (Number(l.qty) || 0) * (Number(l.price) || 0);
    let taxable = gross;
    if (showTCS) taxable = lineDiscAmounts(l).taxableBase;
    else if (showPctDisc) taxable = round2c(gross - round2c((gross * (Number(l.discount) || 0)) / 100));
    const tax = showGST ? (taxable * (Number(l.gst_rate) || 0)) / 100 : 0;
    return { taxable, tax, total: taxable + tax };
  };
  const totals = lines.reduce((a, l) => { const c = calc(l); a.taxable += c.taxable; a.tax += c.tax; a.total += c.total; return a; }, { taxable: 0, tax: 0, total: 0 });
  const lineDiscTotal = lines.reduce((s, l) => s + lineDiscAmt(l), 0);
  const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  // One optional bill-level "Extra Discount" (% or ₹) on the running total.
  const extraBase = r2(totals.total);
  const ev = Number(head.extra_disc_val) || 0;
  const extraAmt = ev > 0 ? (head.extra_disc_mode === 'pct' ? r2((extraBase * ev) / 100) : r2(Math.min(ev, extraBase))) : 0;
  const grandRaw = totals.total - extraAmt;
  // Single rounded value used for Grand Total, Balance and what we send to the server,
  // so "received = total" never leaves a paise remainder.
  const grand = features.autoRoundOff ? Math.round(grandRaw) : Math.round((grandRaw + Number.EPSILON) * 100) / 100;
  const roundOff = Math.round((grand - grandRaw + Number.EPSILON) * 100) / 100;
  const balance = Math.round((grand - (Number(head.paid) || 0) + Number.EPSILON) * 100) / 100;

  const save = async (allowDuplicate) => {
    const valid = lines.filter((l) => l.item_name && Number(l.qty) > 0);
    if (valid.length === 0) return toast('Add at least one item');
    if (!isQuote && Number(head.paid) > grand + 0.001) return toast(`${isSale ? 'Received' : 'Paid'} amount cannot be greater than Grand Total (${fmt(grand)})`);
    setBusy(true);
    try {
      // Normalise each line's discount fields to the active mode so the server
      // computes the right value (TCS columns vs. a single % discount).
      const cleanItems = valid.map((l) => {
        if (showTCS) return { ...l, discount: 0 };
        if (showPctDisc) return { ...l, disc_trade_pct: 0, disc_trade_amt: 0, disc_cd_pct: 0, disc_cd_amt: 0, disc_sd_pct: 0, disc_sd_amt: 0 };
        return { ...l, discount: 0, disc_trade_pct: 0, disc_trade_amt: 0, disc_cd_pct: 0, disc_cd_amt: 0, disc_sd_pct: 0, disc_sd_amt: 0 };
      });
      const payload = { type, ...head, paid: isQuote ? 0 : Math.min(Number(head.paid) || 0, grand), note_kind: noteKind || '', party_id: head.party_id || null, items: cleanItems, allowDuplicate: allowDuplicate ? 1 : 0 };
      const r = isEdit
        ? await api.put('/invoices/' + editId, payload)
        : await api.post('/invoices', payload);
      onSaved(r.id);
    } catch (e) {
      if (e.code === 'DUPLICATE_BATCH' || e.code === 'DUPLICATE_SERIAL') {
        if (confirm('⚠ Duplicate alert!\n\n' + e.message + '\n\nSave purchase anyway?')) { setBusy(false); return save(true); }
      } else if (e.code === 'SERIAL_UNAVAILABLE') {
        toast(e.message || 'A serial number is not available for sale');
      } else toast(e.message);
    } finally { setBusy(false); }
  };

  useHotkeys({ 'alt+n': () => addLine(), 'ctrl+a': () => save() }, [lines, head], { modal: true });

  return (
    <Modal size="full" title={(isNote ? noteLabel : (isQuote ? 'Quotation' : isSale ? 'Sales Voucher' : 'Purchase Voucher')) + (isEdit ? ' — Edit ' + invoiceNo : ' — Create')} onClose={onClose} onAccept={save}
      footer={<><span className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>Enter = next field · Alt+N = add row · Ctrl+A = accept · Esc = cancel</span><button className="btn" onClick={onClose}>Esc</button><button className="btn btn-primary" data-accept="1" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Accept (Ctrl+A)'}</button></>}>
      <div onKeyDown={enterNav}>
        {isNote && (
          <div className="alert" style={{ background: '#fff7e6', border: '1px solid var(--border)', marginBottom: 10 }}>
            {noteKind === 'credit' ? 'Credit Note' : 'Debit Note'} — financial adjustment against an earlier invoice. <b>Does not change stock.</b> Reported in GSTR-1 Table 9 (CDNR/CDNUR).
          </div>
        )}
        {soldWarning && (
          <div className="alert" style={{ background: '#fdecea', border: '1px solid #f5c2c0', color: '#7a271a', marginBottom: 10 }}>
            ⚠ <b>Some stock from this purchase has already been sold.</b> Reducing quantity below the sold amount can leave stock negative, and edits may not fully reverse cleanly.
            <ul style={{ margin: '6px 0 0 18px', fontSize: 12.5 }}>
              {soldWarning.map((s, i) => (
                <li key={i}><b>{s.name}</b>{s.batch ? ` (batch ${s.batch})` : ''} — {fmtN(s.sold)} already sold</li>
              ))}
            </ul>
          </div>
        )}
        <div className="voucher-meta">
          <div className="entry-grid" style={{ gridTemplateColumns: '110px 1fr', maxWidth: '100%' }}>
            <label>{custSide ? 'Customer' : 'Supplier'}</label>
            <PartySearch
              parties={parties}
              value={head.party_id}
              type={custSide ? 'customer' : 'supplier'}
              allowWalkIn={custSide}
              onSelect={(p) => setHead({ ...head, party_id: p ? p.id : '' })}
              onCreated={(p) => setParties((cur) => [p, ...cur])}
            />
          </div>
          <div className="entry-grid" style={{ gridTemplateColumns: '70px 1fr' }}>
            <label>Date</label><input className="fld" type="date" value={head.date} onChange={(e) => setHead({ ...head, date: e.target.value })} />
          </div>
          {isQuote && (
            <div className="entry-grid" style={{ gridTemplateColumns: '90px 1fr' }}>
              <label>Valid Until</label><input className="fld" type="date" value={head.valid_until} onChange={(e) => setHead({ ...head, valid_until: e.target.value })} />
            </div>
          )}
          <BusinessPicker list={bizList} value={bizId} onChange={changeBusiness} disabled={isEdit} />
        </div>

        {isNote && (
          <div className="voucher-meta" style={{ marginTop: 6 }}>
            <div className="entry-grid" style={{ gridTemplateColumns: '110px 1fr', maxWidth: '100%' }}>
              <label>Orig. Invoice No</label>
              <input className="fld" value={head.ref_invoice_no} onChange={(e) => setHead({ ...head, ref_invoice_no: e.target.value })} placeholder="e.g. INV-0001" />
            </div>
            <div className="entry-grid" style={{ gridTemplateColumns: '90px 1fr' }}>
              <label>Orig. Date</label><input className="fld" type="date" value={head.ref_invoice_date} onChange={(e) => setHead({ ...head, ref_invoice_date: e.target.value })} />
            </div>
          </div>
        )}

        {!isNote && (
          <InvoiceDetails head={head} setHead={setHead} features={features} open={showDetails} setOpen={setShowDetails} />
        )}

        <table className="line-grid">
          <thead>
            <tr>
              <th style={{ minWidth: 220 }}>Item</th>
              {showBatch && <th style={{ minWidth: isSale ? 150 : 200 }}>Batch{isSale ? '' : ' / Expiry'}</th>}
              <th style={{ width: 56 }} className="text-right">Qty</th>
              <th style={{ width: 92 }}>Unit</th>
              <th style={{ width: 80 }} className="text-right">Rate</th>
              {showTCS && <th style={{ width: 92 }} className="text-center" title="Trade Discount (% / ₹)">Trade</th>}
              {showTCS && <th style={{ width: 92 }} className="text-center" title="Cash Discount (% / ₹)">CD</th>}
              {showTCS && <th style={{ width: 92 }} className="text-center" title="Special Discount (% / ₹)">SD</th>}
              {showPctDisc && <th style={{ width: 64 }} className="text-right" title="Discount %">Disc %</th>}
              {showGST && <th style={{ width: 54 }} className="text-right">GST%</th>}
              <th style={{ width: 100 }} className="text-right">Amount</th>
              <th style={{ width: 30 }}></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => {
              const c = calc(l);
              const colSpan = 3 + (showBatch ? 1 : 0) + (showGST ? 1 : 0) + 1; // Qty,Rate,Amount,x + optional
              return (
                <Fragment key={idx}>
                <tr>
                  <td>
                    <ProductSearch
                      items={items}
                      value={l.item_name}
                      showStock={features.showStockInVoucher}
                      allowAdd={!isSale && !isNote}
                      onCreate={(it) => setItems((cur) => [it, ...cur])}
                      onSelect={(it) => pickItem(idx, it)}
                      focusSignal={focusRow.idx === idx ? focusRow.n : 0}
                    />
                    {(l._showDesc || l.description) ? (
                      <input
                        className="fld line-desc"
                        placeholder="Description (optional) — shows small on bill"
                        value={l.description}
                        onChange={(e) => setLine(idx, 'description', e.target.value)}
                        style={{ marginTop: 3, fontSize: 11, padding: '3px 6px' }}
                      />
                    ) : (
                      <button type="button" className="linkbtn" tabIndex={-1}
                        style={{ fontSize: 10.5, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0' }}
                        onClick={() => setLine(idx, '_showDesc', true)}>+ add description</button>
                    )}
                    {l.item_id ? (() => {
                      const serialCount = (l.serials || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).length;
                      const wanted = Math.max(0, Math.round(Number(l.qty) || 0));
                      const show = l.track_serials || serialCount > 0;
                      if (!show) return (
                        <button type="button" className="linkbtn" tabIndex={-1}
                          style={{ fontSize: 10.5, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', marginLeft: 10 }}
                          onClick={() => setSerialFor(idx)}>+ add serial numbers</button>
                      );
                      const ok = serialCount === wanted;
                      return (
                        <button type="button" className="linkbtn" tabIndex={-1}
                          style={{ fontSize: 10.5, color: ok ? 'var(--teal-dark)' : '#b45309', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', marginLeft: 10, fontWeight: 600 }}
                          onClick={() => setSerialFor(idx)}>🔢 Serials ({serialCount}/{wanted})</button>
                      );
                    })() : null}
                  </td>
                  {showBatch && (
                    <td>
                      {isSale ? (
                        <select value={l.batch_id} onChange={(e) => { const b = (l._batches || []).find((x) => String(x.id) === e.target.value); setLine(idx, 'batch_id', e.target.value); setLine(idx, 'batch_no', b ? b.batch_no : ''); setLine(idx, 'expiry_date', b ? b.expiry_date : ''); }}>
                          <option value="">Auto (FEFO)</option>
                          {(l._batches || []).map((b) => {
                            const ex = expiryInfo(b.expiry_date);
                            const exLabel = b.expiry_date ? ` · exp ${b.expiry_date}${ex && ex.days < 0 ? ' (EXPIRED)' : ex && ex.days <= 30 ? ' (' + ex.days + 'd)' : ''}` : ' · no expiry';
                            return <option key={b.id} value={b.id}>{b.batch_no} — {fmtN(b.qty_available)} left{exLabel}</option>;
                          })}
                        </select>
                      ) : (
                        <div className="batch-cell">
                          <input placeholder="Batch / Serial" value={l.batch_no} onChange={(e) => setLine(idx, 'batch_no', e.target.value)} />
                          <input type="date" title="Expiry date" value={l.expiry_date} onChange={(e) => setLine(idx, 'expiry_date', e.target.value)} />
                        </div>
                      )}
                      {isSale && l.batch_id && l.expiry_date && (() => {
                        const ex = expiryInfo(l.expiry_date);
                        return <div className={ex && ex.days < 0 ? 'batch-opt-expired' : 'batch-opt-exp'} style={{ padding: '0 6px' }}>Exp: {l.expiry_date}{ex && ex.days < 0 ? ' — EXPIRED!' : ex && ex.days <= 30 ? ` — ${ex.days}d left` : ''}</div>;
                      })()}
                    </td>
                  )}
                  <td>
                    <input type="number" value={l.qty} onChange={(e) => setLine(idx, 'qty', e.target.value)} className="text-right" />
                    {l.item_id && (l._units && l._units.length > 1) && Number(l.unit_factor) > 1 && (
                      <div className="muted" style={{ fontSize: 10, textAlign: 'right' }}>= {fmtN(round2c((Number(l.qty) || 0) * (Number(l.unit_factor) || 1)))} {l._baseUnit}</div>
                    )}
                  </td>
                  <td>
                    {l.item_id && l._units && l._units.length > 1 ? (
                      <select value={l.unit} onChange={(e) => setLineUnit(idx, e.target.value)}>
                        {l._units.map((u) => <option key={u.unit_name} value={u.unit_name}>{u.unit_name}{Number(u.factor) > 1 ? ` (×${fmtN(u.factor)})` : ''}</option>)}
                      </select>
                    ) : (
                      <span className="muted" style={{ fontSize: 12 }}>{l.unit || l._baseUnit || ''}</span>
                    )}
                  </td>
                  <td><input type="number" value={l.price} onChange={(e) => setLine(idx, 'price', e.target.value)} className="text-right" /></td>
                  {showTCS && <td className="disc-cell"><LineDiscCell line={l} which="trade" idx={idx} setLineDisc={setLineDisc} /></td>}
                  {showTCS && <td className="disc-cell"><LineDiscCell line={l} which="cd" idx={idx} setLineDisc={setLineDisc} /></td>}
                  {showTCS && <td className="disc-cell"><LineDiscCell line={l} which="sd" idx={idx} setLineDisc={setLineDisc} /></td>}
                  {showPctDisc && <td><input type="number" min="0" max="100" step="0.01" value={l.discount || ''} placeholder="0" onChange={(e) => setLine(idx, 'discount', e.target.value)} className="text-right" /></td>}
                  {showGST && <td><input type="number" value={l.gst_rate} onChange={(e) => setLine(idx, 'gst_rate', e.target.value)} className="text-right" /></td>}
                  <td className="text-right num" style={{ padding: '0 6px' }}>{fmt(c.total)}</td>
                  <td className="text-center"><button type="button" className="btn btn-sm" onClick={() => rmLine(idx)} tabIndex={-1}>✕</button></td>
                </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-sm" onClick={addLine}>＋ Add Row (Alt+N)</button>
          {!isSale && !isNote && (
            <button type="button" className="btn btn-sm" onClick={() => setImportOpen(true)}>⬆ Import from Excel</button>
          )}
        </div>
        {importOpen && (
          <Suspense fallback={null}>
            <PurchaseImport items={items} onClose={() => setImportOpen(false)} onImport={importLines} />
          </Suspense>
        )}
        {serialFor !== null && lines[serialFor] && (
          <SerialModal
            line={lines[serialFor]}
            isSale={isSale}
            onClose={() => setSerialFor(null)}
            onSave={(serials) => { setLine(serialFor, 'serials', serials); setSerialFor(null); }}
          />
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, marginTop: 14 }}>
          <div>
            <div className="entry-sec">Narration</div>
            <textarea className="fld" rows={3} value={head.notes} onChange={(e) => setHead({ ...head, notes: e.target.value })} />
          </div>
          <div className="totbox">
            {showDisc && lineDiscTotal > 0 && <div className="totrow" style={{ fontSize: 12.5 }}><span className="muted">Item Discounts</span><span className="num" style={{ color: 'var(--accent)' }}>− {fmt(lineDiscTotal)}</span></div>}
            <div className="totrow"><span>{showGST ? 'Taxable' : 'Subtotal'}</span><span className="num">{fmt(totals.taxable)}</span></div>
            {showGST && <div className="totrow"><span>CGST</span><span className="num">{fmt(totals.tax / 2)}</span></div>}
            {showGST && <div className="totrow"><span>SGST</span><span className="num">{fmt(totals.tax / 2)}</span></div>}
            <div className="totrow" title="Optional extra discount on the whole bill">
              <span>Extra Disc</span>
              <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input className="fld" type="number" min="0" value={head.extra_disc_val} onChange={(e) => setHead({ ...head, extra_disc_val: e.target.value })} style={{ width: 60, textAlign: 'right' }} />
                <select className="fld" value={head.extra_disc_mode} onChange={(e) => setHead({ ...head, extra_disc_mode: e.target.value })} style={{ width: 44, padding: '2px 2px' }}>
                  <option value="pct">%</option>
                  <option value="amt">₹</option>
                </select>
                <span className="num muted" style={{ minWidth: 56, textAlign: 'right' }}>{extraAmt > 0 ? '− ' + fmt(extraAmt) : '—'}</span>
              </span>
            </div>
            {features.autoRoundOff && Math.abs(roundOff) >= 0.005 && (
              <div className="totrow"><span>Round Off</span><span className="num">{roundOff > 0 ? '+' : ''}{fmt(roundOff)}</span></div>
            )}
            <div className="totrow grand"><span>Grand Total</span><span className="num">{fmt(grand)}</span></div>
            {isQuote ? (
              <div className="totrow" style={{ fontSize: 12, color: 'var(--muted)' }}>
                <span>Quotation — no payment recorded</span><span />
              </div>
            ) : (<>
            <div className="totrow"><span>{isSale ? 'Received' : 'Paid'}</span>
              <span style={{ display: 'flex', gap: 4 }}>
                <button type="button" className="btn btn-sm" title="Set full amount" onClick={() => setHead({ ...head, paid: grand })}>Full</button>
                <input className="fld" type="number" min="0" max={grand} value={head.paid}
                  onChange={(e) => {
                    // Received/Paid can never exceed the Grand Total.
                    let v = e.target.value;
                    if (v !== '' && Number(v) > grand) v = grand;
                    if (v !== '' && Number(v) < 0) v = 0;
                    setHead({ ...head, paid: v });
                  }}
                  style={{ width: 90, textAlign: 'right' }} />
              </span>
            </div>
            {Number(head.paid) > grand && (
              <div className="totrow" style={{ color: 'var(--accent)', fontSize: 12 }}>
                <span>⚠ {isSale ? 'Received' : 'Paid'} cannot exceed Grand Total</span><span />
              </div>
            )}
            <div className="totrow"><span>Mode</span>
              <select className="fld" value={head.pay_mode} onChange={(e) => setHead({ ...head, pay_mode: e.target.value })} style={{ width: 110 }}>
                <option value="cash">Cash</option><option value="upi">UPI</option><option value="bank">Bank</option><option value="cheque">Cheque</option>
              </select>
            </div>
            <div className="totrow grand"><span>Balance</span><span className="num">{fmt(balance)}</span></div>
            </>)}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// Convert a quotation into a Sales Voucher: prefill a new sale from the quote's
// lines, and once saved, mark the quotation as converted + link the two.
function ConvertQuote({ quote, onClose, onDone }) {
  const toast = useToast();
  const [full, setFull] = useState(null);
  useEffect(() => { api.get('/invoices/' + quote.id).then(setFull).catch(() => onClose()); }, [quote.id]);
  if (!full) return <Modal title="Convert to Sale" onClose={onClose}><div className="muted">Loading quotation…</div></Modal>;
  const initialData = {
    party_id: full.party_id || '',
    notes: full.notes || '',
    extra_disc_val: full.discount || 0,
    extra_disc_mode: 'amt',
    items: full.items || [],
  };
  return (
    <VoucherForm
      type="sale"
      initialData={initialData}
      onClose={onClose}
      onSaved={async (newId) => {
        try { await api.post('/invoices/' + quote.id + '/mark-converted', { invoice_id: newId }); }
        catch (_) { /* non-fatal: sale was still created */ }
        toast('Quotation converted to sale ✓');
        onDone(newId);
      }}
    />
  );
}

// Send the current invoice's bill PDF to a customer on WhatsApp.
function WhatsAppSend({ inv, onClose }) {
  const toast = useToast();
  const nav = useNavigate();
  const [st, setSt] = useState(null);
  const [number, setNumber] = useState((inv.party_phone || '').trim());
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get('/whatsapp/status').then(setSt).catch(() => setSt({ available: false })); }, []);
  useHotkeys({ escape: () => onClose() }, [], { modal: true, popup: true });

  const ready = st && st.status === 'ready';
  const send = async () => {
    if (!number.trim()) return toast('Enter a mobile number');
    setBusy(true);
    try {
      await api.post('/whatsapp/send-invoice', { invoice_id: inv.id, number: number.trim() });
      toast('Bill sent on WhatsApp ✓');
      onClose();
    } catch (e) { toast(e.message || 'Could not send'); } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 1200 }}>
      <div className="modal sm">
        <div className="modal-head"><span>🟢 Send Bill on WhatsApp</span><button className="close-x" onClick={onClose} title="Close (Esc)">×</button></div>
        <div className="modal-body"><div className="modal-narrow">
          {!st ? <div className="muted">Checking WhatsApp…</div> : !st.available ? (
            <div className="alert alert-danger">WhatsApp isn't installed on this server.</div>
          ) : !ready ? (
            <div>
              <div className="alert" style={{ background: '#fff7e6', border: '1px solid var(--border)' }}>
                WhatsApp isn't linked yet. Link a device once, then send bills anytime.
              </div>
              <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={() => { onClose(); nav('/whatsapp'); }}>Go to WhatsApp Connect →</button>
            </div>
          ) : (
            <>
              <p style={{ marginBottom: 10 }}>Send <b>{inv.invoice_no}</b> ({fmt(inv.total)}) to <b>{inv.party_name || 'customer'}</b>:</p>
              <label className="muted" style={{ fontSize: 12 }}>Customer mobile number</label>
              <input className="fld" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. 98220 11223" autoFocus style={{ marginTop: 4 }} />
              <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>10-digit numbers are sent to +91 (India) by default. Include country code for others.</p>
            </>
          )}
        </div></div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          {ready && <button className="btn btn-primary" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send PDF'}</button>}
        </div>
      </div>
    </div>
  );
}

function VoucherView({ id, onClose, onEdit, onConvert }) {
  const toast = useToast();
  const [inv, setInv] = useState(null);
  const [waFor, setWaFor] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const printInvoice = usePrintInvoice();
  const doPrint = () => printInvoice(id, inv && inv.invoice_no);
  useEffect(() => { api.get('/invoices/' + id).then(setInv); }, [id]);
  useHotkeys({ 'ctrl+p': doPrint, 'alt+p': doPrint, f2: () => onEdit && onEdit(id) }, [id, inv], { modal: true });
  if (!inv) return <Modal title="Voucher" onClose={onClose}><div className="muted">Loading…</div></Modal>;
  const isQuote = inv.type === 'quotation';
  const isSale = inv.type === 'sale';
  const custLabel = inv.type === 'purchase' ? 'Supplier' : 'Customer';
  // Download the same invoice as another document type (challan/memo/proforma).
  const openDoc = (kind) => {
    setDocsOpen(false);
    openPdf('/pdf/invoice/' + id + (kind && kind !== 'tax' ? '?doc=' + kind : '')).catch((e) => toast(e.message || 'Could not open'));
  };
  return (
    <Modal size="lg" title={(isQuote ? 'Quotation ' : 'Voucher ') + inv.invoice_no} onClose={onClose} onAccept={onClose}
      footer={<><span className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>F2 = Edit · Ctrl+P = Print</span>{isQuote && onConvert && inv.status !== 'converted' && <button className="btn" style={{ color: 'var(--teal-dark)', fontWeight: 700 }} onClick={() => onConvert(inv)}>→ Convert to Sale</button>}{onEdit && <button className="btn" onClick={() => onEdit(id)}>✎ Edit (F2)</button>}{isSale && (
        <span style={{ position: 'relative', display: 'inline-block' }}>
          <button className="btn" onClick={() => setDocsOpen((o) => !o)}>📄 Documents ▾</button>
          {docsOpen && (
            <div className="doc-menu" onMouseLeave={() => setDocsOpen(false)}>
              <button className="doc-menu-item" onClick={() => openDoc('tax')}>🧾 Tax Invoice</button>
              <button className="doc-menu-item" onClick={() => openDoc('challan')}>🚚 Delivery Challan</button>
              <button className="doc-menu-item" onClick={() => openDoc('memo')}>📝 Delivery Memo</button>
              <button className="doc-menu-item" onClick={() => openDoc('proforma')}>📑 Proforma Invoice</button>
            </div>
          )}
        </span>
      )}<button className="btn" style={{ color: '#128C7E', fontWeight: 600 }} onClick={() => setWaFor(true)}>🟢 Send on WhatsApp</button><button className="btn" onClick={doPrint}>Print / Preview (Ctrl+P)</button><button className="btn btn-primary" onClick={onClose}>Close (Esc)</button>{waFor && <WhatsAppSend inv={inv} onClose={() => setWaFor(false)} />}</>}>
      {isQuote && (
        <div className="alert" style={{ background: '#fff7e6', border: '1px solid var(--border)', marginBottom: 10, fontSize: 13 }}>
          <b>Quotation</b> — an estimate for the customer. It does not affect stock, payments or GST.{inv.valid_until ? ` Valid until ${inv.valid_until}.` : ''} {inv.status === 'converted' ? 'This quotation has been converted to a sale.' : 'Use “Convert to Sale” to bill it.'}
        </div>
      )}
      <div className="voucher-meta">
        <div><div className="muted" style={{ fontSize: 12 }}>{custLabel}</div><b style={{ fontSize: 15 }}>{inv.party_name || 'Walk-in'}</b>{inv.party_gstin && <div className="muted">{inv.party_gstin}</div>}</div>
        <div className="text-right"><div className="muted" style={{ fontSize: 12 }}>Date</div>{inv.date}<div style={{ marginTop: 4 }}>{isQuote ? <QuoteStatusBadge status={inv.status} /> : <StatusBadge status={inv.status} />}</div></div>
      </div>
      <table className="tbl">
        <thead><tr><th>Item</th><th>Batch</th><th>HSN</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">GST</th><th className="text-right">Amount</th></tr></thead>
        <tbody>{inv.items.map((it) => { const ld = (Number(it.disc_trade_amt) || 0) + (Number(it.disc_cd_amt) || 0) + (Number(it.disc_sd_amt) || 0); const pd = (Number(it.discount) || 0) > 0 ? round2c(((Number(it.qty) || 0) * (Number(it.price) || 0) * (Number(it.discount) || 0)) / 100) : 0; return <tr key={it.id}><td>{it.item_name}{it.description ? <div className="muted" style={{ fontSize: 11 }}>{it.description}</div> : null}{it.serials ? <div className="muted" style={{ fontSize: 11 }}>S/N: {it.serials}</div> : null}{ld > 0 ? <div className="muted" style={{ fontSize: 11 }}>Disc: −{fmt(ld)} (T {fmt(it.disc_trade_amt)} · CD {fmt(it.disc_cd_amt)} · SD {fmt(it.disc_sd_amt)})</div> : pd > 0 ? <div className="muted" style={{ fontSize: 11 }}>Disc: {it.discount}% (−{fmt(pd)})</div> : null}</td><td>{it.batch_no || '—'}</td><td>{it.hsn || '—'}</td><td className="text-right num">{fmtN(it.qty)}</td><td className="text-right num">{fmt(it.price)}</td><td className="text-right num">{it.gst_rate}%</td><td className="text-right num">{fmt(it.line_total)}</td></tr>; })}</tbody>
      </table>
      {(() => { const itemDisc = inv.items.reduce((s, it) => s + (Number(it.disc_trade_amt) || 0) + (Number(it.disc_cd_amt) || 0) + (Number(it.disc_sd_amt) || 0) + ((Number(it.discount) || 0) > 0 ? round2c(((Number(it.qty) || 0) * (Number(it.price) || 0) * (Number(it.discount) || 0)) / 100) : 0), 0); return (
      <div className="totbox" style={{ maxWidth: 300, marginLeft: 'auto', marginTop: 12 }}>
        {itemDisc > 0 && <div className="totrow"><span className="muted">Item Discounts</span><span className="num">-{fmt(itemDisc)}</span></div>}
        <div className="totrow"><span>Subtotal</span><span className="num">{fmt(inv.subtotal)}</span></div>
        <div className="totrow"><span>CGST</span><span className="num">{fmt(inv.tax_total / 2)}</span></div>
        <div className="totrow"><span>SGST</span><span className="num">{fmt(inv.tax_total / 2)}</span></div>
        {inv.discount > 0 && <div className="totrow"><span>Extra Discount</span><span className="num">-{fmt(inv.discount)}</span></div>}
        <div className="totrow grand"><span>Grand Total</span><span className="num">{fmt(inv.total)}</span></div>
        {!isQuote && <div className="totrow"><span>Paid</span><span className="num">{fmt(inv.paid)}</span></div>}
        {!isQuote && <div className="totrow grand"><span>Balance Due</span><span className="num">{fmt(inv.total - inv.paid)}</span></div>}
        {isQuote && inv.valid_until && <div className="totrow"><span className="muted">Valid Until</span><span>{inv.valid_until}</span></div>}
      </div>
      ); })()}
    </Modal>
  );
}
