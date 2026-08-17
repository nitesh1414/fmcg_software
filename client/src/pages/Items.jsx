import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { Modal, useToast, fmt, fmtN, expiryInfo } from '../components/ui';
import { ListScreen } from '../components/ListScreen';
import { useScreenSetup } from '../components/TallyFrame';
import { useHotkeys } from '../keyboard';
import { downloadCSV } from '../api/csv';
import { useFeatures } from '../features';
import HsnSearch from '../components/HsnSearch';

// App units shown in the item form. Each maps to an official GST UQC on export.
const UNITS = ['PCS', 'NOS', 'PIECE', 'PACK', 'BOX', 'CARTON', 'CASE', 'CRATE', 'PALLET', 'STRIP', 'BOTTLE', 'BTL', 'KG', 'GM', 'LTR', 'ML', 'MTR', 'PKT', 'DOZEN', 'PAIR', 'BAG', 'SET', 'ROLL', 'TON', 'TABLET', 'TUBE', 'SHEET', 'BUNDLE'];

export default function Items() {
  const toast = useToast();
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  const [cats, setCats] = useState([]);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [batchItem, setBatchItem] = useState(null);

  const load = () => { api.get('/items').then(setItems); api.get('/items/categories').then(setCats); };
  useEffect(() => { load(); }, []);

  const filtered = items.filter((i) =>
    !q || i.name.toLowerCase().includes(q.toLowerCase()) || (i.sku || '').toLowerCase().includes(q.toLowerCase())
  );

  const del = async (row) => {
    if (!confirm(`Delete item "${row.name}" and its batches?`)) return;
    await api.del('/items/' + row.id); toast('Item deleted'); load();
  };
  const exportCsv = () => downloadCSV('items', filtered, [
    { key: 'name', label: 'Item' }, { key: 'sku', label: 'SKU' }, { key: 'category_name', label: 'Category' },
    { key: 'unit', label: 'Unit' }, { key: 'hsn', label: 'HSN' }, { key: 'gst_rate', label: 'GST%' },
    { key: 'purchase_price', label: 'Purchase' }, { key: 'sale_price', label: 'Sale' },
    { key: 'stock', label: 'Stock' }, { key: 'low_stock_alert', label: 'LowAlert' },
  ]);

  useScreenSetup({
    title: 'Item / Stock Master', sub: `${filtered.length} items`,
    buttons: [
      { key: 'f5', label: 'F5', text: 'New Item', onClick: () => setEditing({ unit: 'PCS', gst_rate: 18 }) },
      { key: 'f2', label: 'F2', text: 'Edit', onClick: () => filtered.length && setEditing(filtered[0]) },
      { key: 'f7', label: 'F7', text: 'Batches', onClick: () => filtered.length && setBatchItem(filtered[0]) },
      { key: 'f8', label: 'F8/Del', text: 'Delete', onClick: () => filtered.length && del(filtered[0]) },
      { sep: true },
      { key: 'ctrl+e', label: 'Ctrl+E', text: 'Export CSV', onClick: exportCsv },
      { key: 'escape', label: 'Esc', text: 'Dashboard', onClick: () => nav('/') },
    ],
  }, [filtered]);
  useHotkeys({ escape: () => nav('/'), f5: () => setEditing({ unit: 'PCS', gst_rate: 18 }) }, [nav]);

  return (
    <>
      <div className="filterbar">
        <span className="kbd">Find</span>
        <input placeholder="Type to search items…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240 }} />
        <span className="muted">↑↓ move • Enter = Batches • F5 new • F2 edit • Edit / Delete on the row</span>
      </div>
      <ListScreen
        rows={filtered}
        onEnter={(r) => setBatchItem(r)}
        onDelete={del}
        deps={[q]}
        emptyIcon="📦" emptyText="No items. Press F5 to add."
        columns={[
          { key: 'name', label: 'Item Name', render: (r) => <><b>{r.name}</b>{r.sku ? <span className="muted"> · {r.sku}</span> : ''}</> },
          { key: 'category_name', label: 'Category', render: (r) => r.category_path || r.category_name || '—' },
          { key: 'hsn', label: 'HSN' },
          { key: 'gst_rate', label: 'GST%', align: 'right', render: (r) => r.gst_rate + '%' },
          { key: 'avg_cost', label: 'Avg Cost', align: 'right', render: (r) => fmt(r.avg_cost) },
          { key: 'sale_price', label: 'Sale', align: 'right', render: (r) => fmt(r.sale_price) },
          { key: 'stock', label: 'Stock', align: 'right', render: (r) => {
            const low = r.low_stock_alert > 0 && r.stock <= r.low_stock_alert;
            const base = r.base_unit || r.unit;
            return <span className={'badge ' + (low ? 'badge-danger' : r.stock > 0 ? 'badge-success' : 'badge-muted')} title={(r.stock_label && r.stock_label !== `${fmtN(r.stock)} ${base}`) ? r.stock_label : ''}>{fmtN(r.stock)} {base}{r.stock_label && r.stock_label !== `${fmtN(r.stock)} ${base}` ? <span style={{ fontWeight: 400, opacity: 0.85 }}> · {r.stock_label}</span> : ''}</span>;
          } },
          { key: 'act', label: '', align: 'right', render: (r) => (
            <span style={{ display: 'inline-flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
              <button className="btn btn-sm" onClick={() => setBatchItem(r)}>Batches</button>
              <button className="btn btn-sm" onClick={() => setEditing(r)}>Edit</button>
              <button className="btn btn-sm" style={{ color: 'var(--accent)' }} onClick={() => del(r)}>Delete</button>
            </span>
          ) },
        ]}
      />

      {editing && <ItemForm item={editing} cats={cats} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); toast('Item saved'); }} onCat={load} />}
      {batchItem && <BatchManager item={batchItem} onClose={() => { setBatchItem(null); load(); }} />}
    </>
  );
}

// A packaging ladder row: base unit (factor 1) + optional larger units.
function blankUnitRow(name = '') { return { unit_name: name, factor: '', purchase_price: '', sale_price: '', barcode: '' }; }

function ItemForm({ item, cats, onClose, onSaved, onCat }) {
  const toast = useToast();
  const { features } = useFeatures();
  const isNew = !item.id;
  const [f, setF] = useState({
    name: item.name || '', sku: item.sku || '', brand: item.brand || '', category_id: item.category_id || '',
    hsn: item.hsn || '', gst_rate: item.gst_rate ?? 18, cess_rate: item.cess_rate ?? 0,
    mrp: item.mrp ?? '', tax_inclusive: !!item.tax_inclusive,
    low_stock_alert: item.low_stock_alert ?? 0, min_stock: item.min_stock ?? 0, max_stock: item.max_stock ?? 0,
    opening_stock: '', image: item.image || '',
    description: item.description || '', track_serials: !!item.track_serials,
  });
  // Packaging ladder. Row 0 is always the BASE unit (factor forced to 1).
  const [uRows, setURows] = useState(() => {
    const existing = Array.isArray(item.units) && item.units.length ? item.units : null;
    if (existing) {
      const sorted = existing.slice().sort((a, b) => (b.is_base - a.is_base) || (a.factor - b.factor));
      return sorted.map((u) => ({ unit_name: u.unit_name, factor: u.factor, purchase_price: u.purchase_price || '', sale_price: u.sale_price || '', barcode: u.barcode || '' }));
    }
    return [{ unit_name: item.base_unit || item.unit || 'PCS', factor: 1, purchase_price: item.purchase_price ?? '', sale_price: item.sale_price ?? '', barcode: '' }];
  });
  const setU = (i, k, v) => setURows((cur) => cur.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const addU = () => setURows((cur) => [...cur, blankUnitRow()]);
  const rmU = (i) => setURows((cur) => (i === 0 ? cur : cur.filter((_, idx) => idx !== i)));
  const [newCat, setNewCat] = useState('');
  const [newCatParent, setNewCatParent] = useState('');
  const [gstHint, setGstHint] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const baseUnit = (uRows[0]?.unit_name || 'base').trim() || 'base';

  const pickHsn = (row) => {
    setF((cur) => ({ ...cur, hsn: row.hsn }));
    if (row.gst != null && Number(row.gst) !== Number(f.gst_rate)) setGstHint(row.gst); else setGstHint(null);
  };
  const lookupHsnRate = async (code) => {
    if (!features.autoHSN || !code || code.length < 4) return;
    try {
      const info = await api.get('/lookup/hsn/' + encodeURIComponent(code));
      if (info && info.gst != null && Number(info.gst) !== Number(f.gst_rate)) setGstHint(info.gst);
    } catch (_) { /* not in local list */ }
  };
  const applyGstHint = () => { if (gstHint != null) { setF((cur) => ({ ...cur, gst_rate: gstHint })); setGstHint(null); } };

  const pickImage = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 1_200_000) { toast('Image too large — please use one under ~1 MB'); e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => setF((cur) => ({ ...cur, image: reader.result }));
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const save = async () => {
    if (!f.name.trim()) return toast('Item name is required');
    const units = uRows
      .map((r, i) => ({
        unit_name: (r.unit_name || '').trim(),
        factor: i === 0 ? 1 : (Number(r.factor) || 0),
        purchase_price: Number(r.purchase_price) || 0,
        sale_price: Number(r.sale_price) || 0,
        barcode: (r.barcode || '').trim(),
      }))
      .filter((r) => r.unit_name);
    if (!units.length || !units[0].unit_name) return toast('Base unit name is required');
    for (let i = 1; i < units.length; i++) {
      if (units[i].factor <= 0) return toast(`Unit "${units[i].unit_name}" needs how many ${units[0].unit_name} it equals`);
    }
    const baseRow = units[0];
    const body = {
      ...f, category_id: f.category_id || null,
      units, base_unit: baseRow.unit_name, unit: baseRow.unit_name,
      purchase_price: baseRow.purchase_price, sale_price: baseRow.sale_price,
    };
    try {
      if (item.id) await api.put('/items/' + item.id, body); else await api.post('/items', body);
      onSaved();
    } catch (e) { toast(e.message || 'Could not save item'); }
  };
  const addCat = async () => {
    if (!newCat.trim()) return;
    const c = await api.post('/items/categories', { name: newCat.trim(), parent_id: newCatParent || null });
    setNewCat(''); setNewCatParent(''); onCat(); if (c && c.id) setF((cur) => ({ ...cur, category_id: c.id })); toast('Category added');
  };

  return (
    <Modal title={item.id ? 'Item Master — Alter' : 'Item Master — Create'} onClose={onClose} onAccept={save}
      footer={<><span className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>Ctrl+A = save · Esc = cancel</span><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" data-accept="1" onClick={save}>💾 Save Item</button></>}>
      <div className="form-cards">

        {/* Basic details */}
        <div className="fcard">
          <div className="fcard-head"><span className="fc-ico">📦</span> Basic Details</div>
          <div className="fgrid">
            <div className="fld-wrap fwide"><label>Item Name *</label><input className="fld" value={f.name} onChange={set('name')} autoFocus placeholder="e.g. Parle-G Biscuit 100g" /></div>
            <div className="fld-wrap"><label>SKU / Code</label><input className="fld" value={f.sku} onChange={set('sku')} /></div>
            <div className="fld-wrap"><label>Brand / Mfr</label><input className="fld" value={f.brand} onChange={set('brand')} /></div>
            <div className="fld-wrap f2"><label>Category</label>
              <select className="fld" value={f.category_id} onChange={set('category_id')}>
                <option value="">— None —</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.path || c.name}</option>)}
              </select>
            </div>
            <div className="fld-wrap fwide"><label>Description</label>
              <textarea className="fld" rows={2} value={f.description} onChange={set('description')} placeholder="Default description shown on bills (optional)" />
            </div>
          </div>
        </div>

        {/* Item photo */}
        <div className="fcard">
          <div className="fcard-head"><span className="fc-ico">🖼️</span> Item Photo <span className="fc-sub">optional</span></div>
          <div className="img-tile">
            {f.image ? <img src={f.image} alt="item" /> : <span className="ph">No image<br />PNG / JPG, under 1 MB</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <label className="btn btn-sm" style={{ cursor: 'pointer' }}>{f.image ? 'Change' : 'Upload'}
              <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={pickImage} />
            </label>
            {f.image && <button type="button" className="btn btn-sm" style={{ color: 'var(--accent)' }} onClick={() => setF({ ...f, image: '' })}>Remove</button>}
          </div>
        </div>

        {/* Tax / GST */}
        <div className="fcard">
          <div className="fcard-head"><span className="fc-ico">🧾</span> Tax &amp; GST</div>
          <div className="fgrid">
            <div className="fld-wrap"><label>HSN / SAC Code</label>
              {features.autoHSN
                ? <HsnSearch value={f.hsn} onChange={(v) => setF((cur) => ({ ...cur, hsn: v }))} onPick={pickHsn} />
                : <input className="fld" value={f.hsn} onChange={set('hsn')} />}
            </div>
            <div className="fld-wrap"><label>GST Rate %</label>
              <input className="fld" type="number" step="0.01" value={f.gst_rate} onChange={set('gst_rate')} onBlur={() => lookupHsnRate(f.hsn)} />
              {gstHint != null && (
                <span className="hint">Suggested: <b>{gstHint}%</b> <button type="button" className="btn btn-sm" style={{ padding: '0 6px' }} onClick={applyGstHint}>Apply</button></span>
              )}
            </div>
            <div className="fld-wrap"><label>Cess %</label><input className="fld" type="number" step="0.01" value={f.cess_rate} onChange={set('cess_rate')} /></div>
            <label className="fld-check fwide"><input type="checkbox" checked={f.tax_inclusive} onChange={(e) => setF({ ...f, tax_inclusive: e.target.checked })} /> Prices are <b style={{ margin: '0 4px' }}>tax-inclusive</b> (GST already included in the rate)</label>
          </div>
        </div>

        {/* Pricing */}
        <div className="fcard">
          <div className="fcard-head"><span className="fc-ico">₹</span> Pricing <span className="fc-sub">base unit ({baseUnit})</span></div>
          <div className="fgrid">
            <div className="fld-wrap"><label>Purchase ₹</label><input className="fld" type="number" value={uRows[0]?.purchase_price} onChange={(e) => setU(0, 'purchase_price', e.target.value)} /></div>
            <div className="fld-wrap"><label>Sale ₹</label><input className="fld" type="number" value={uRows[0]?.sale_price} onChange={(e) => setU(0, 'sale_price', e.target.value)} /></div>
            <div className="fld-wrap"><label>MRP ₹</label><input className="fld" type="number" value={f.mrp} onChange={set('mrp')} /></div>
            <div className="fld-wrap"><label>Barcode</label><input className="fld" value={uRows[0]?.barcode} onChange={(e) => setU(0, 'barcode', e.target.value)} placeholder="Scan / type" /></div>
          </div>
          <span className="hint" style={{ display: 'block', marginTop: 6 }}>Per-packaging prices &amp; barcodes are set in “Units &amp; Packaging” below.</span>
        </div>

        {/* Stock levels */}
        <div className="fcard">
          <div className="fcard-head"><span className="fc-ico">📊</span> Stock Levels <span className="fc-sub">in {baseUnit}</span></div>
          <div className="fgrid">
            {isNew && <div className="fld-wrap"><label>Opening Stock</label><input className="fld" type="number" value={f.opening_stock} onChange={set('opening_stock')} placeholder="0" /><span className="hint">Seeds a batch on save</span></div>}
            <div className="fld-wrap"><label>Low-stock Alert</label><input className="fld" type="number" value={f.low_stock_alert} onChange={set('low_stock_alert')} /></div>
            <div className="fld-wrap"><label>Min / Reorder</label><input className="fld" type="number" value={f.min_stock} onChange={set('min_stock')} /></div>
            <div className="fld-wrap"><label>Max Stock</label><input className="fld" type="number" value={f.max_stock} onChange={set('max_stock')} /></div>
          </div>
          <label className="fld-check" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={f.track_serials} onChange={(e) => setF({ ...f, track_serials: e.target.checked })} />
            Serial-tracked (unique serial per unit — e.g. CCTV camera; enter serials while billing)
          </label>
        </div>

        {/* Units & packaging — full width */}
        <div className="fcard span-2">
          <div className="fcard-head"><span className="fc-ico">🧩</span> Units &amp; Packaging <span className="fc-sub">sell/purchase in any unit — stock kept in the base unit</span></div>
          <UnitLadderEditor rows={uRows} setU={setU} addU={addU} rmU={rmU} />
        </div>

        {/* Quick add category — full width */}
        <div className="fcard span-2">
          <div className="fcard-head"><span className="fc-ico">🗂️</span> Quick Add Category <span className="fc-sub">multi-level</span></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select className="fld" data-noenter="1" value={newCatParent} onChange={(e) => setNewCatParent(e.target.value)} style={{ flex: '1 1 220px', minWidth: 0 }}>
              <option value="">— Top level (no parent) —</option>
              {cats.map((c) => <option key={c.id} value={c.id}>under: {c.path || c.name}</option>)}
            </select>
            <input className="fld" data-noenter="1" value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New sub-category name" style={{ flex: '1 1 220px', minWidth: 0 }} />
            <button className="btn" onClick={addCat} data-enterstop="1">Add</button>
          </div>
        </div>

      </div>
    </Modal>
  );
}

// Packaging ladder editor: base unit (factor locked to 1) + larger units with
// their conversion factor (how many base units each equals), per-unit prices
// and barcodes. Powers the Unit Conversion Engine.
function UnitLadderEditor({ rows, setU, addU, rmU }) {
  const base = (rows[0]?.unit_name || 'base').trim() || 'base';
  // Running factor helper so the user sees "= N base units" live.
  return (
    <div>
      <div className="table-wrap">
      <table className="line-grid" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th style={{ minWidth: 120 }}>Unit</th>
            <th style={{ width: 150 }} className="text-right">Conversion</th>
            <th style={{ width: 100 }} className="text-right">Purchase ₹</th>
            <th style={{ width: 100 }} className="text-right">Sale ₹</th>
            <th style={{ minWidth: 130 }}>Barcode</th>
            <th style={{ width: 30 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <input className="fld" list="unit-list" value={r.unit_name} placeholder={i === 0 ? 'Base unit e.g. Piece' : 'e.g. Box'}
                  onChange={(e) => setU(i, 'unit_name', e.target.value)} />
                {i === 0 && <div className="muted" style={{ fontSize: 10.5 }}>Base unit (stock counted in this)</div>}
              </td>
              <td className="text-right">
                {i === 0 ? (
                  <span className="muted" style={{ fontSize: 12 }}>1 (base)</span>
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                    1 {r.unit_name || 'unit'} =
                    <input type="number" min="0" step="0.001" className="fld text-right" style={{ width: 64 }} value={r.factor}
                      placeholder="0" onChange={(e) => setU(i, 'factor', e.target.value)} />
                    <span className="muted" style={{ fontSize: 11 }}>{base}</span>
                  </span>
                )}
              </td>
              <td><input type="number" className="fld text-right" value={r.purchase_price} placeholder="0" onChange={(e) => setU(i, 'purchase_price', e.target.value)} /></td>
              <td><input type="number" className="fld text-right" value={r.sale_price} placeholder="0" onChange={(e) => setU(i, 'sale_price', e.target.value)} /></td>
              <td><input className="fld" value={r.barcode} placeholder="Scan / type" onChange={(e) => setU(i, 'barcode', e.target.value)} /></td>
              <td className="text-center">{i === 0 ? '' : <button type="button" className="btn btn-sm" onClick={() => rmU(i)} tabIndex={-1}>✕</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <datalist id="unit-list">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
      <div style={{ marginTop: 8 }}>
        <button type="button" className="btn btn-sm" onClick={addU}>＋ Add Packaging Level (Pack / Box / Carton…)</button>
        <span className="muted" style={{ fontSize: 11.5, marginLeft: 10 }}>e.g. 1 Pack = 10 Piece, 1 Box = 120 Piece, 1 Carton = 2400 Piece</span>
      </div>
    </div>
  );
}

function BatchManager({ item, onClose }) {
  const toast = useToast();
  const [batches, setBatches] = useState([]);
  const [adding, setAdding] = useState(false);
  const blank = { batch_no: '', mfg_date: '', expiry_date: '', purchase_price: item.purchase_price, mrp: item.sale_price, qty_in: 0 };
  const [nb, setNb] = useState(blank);

  const load = () => api.get('/items/' + item.id + '/batches').then(setBatches);
  useEffect(() => { load(); }, []);

  const addBatch = async (force) => {
    if (!nb.batch_no) return toast('Batch number required');
    try {
      await api.post('/items/' + item.id + '/batches' + (force === true ? '?force=1' : ''), nb);
      setAdding(false); setNb(blank); load(); toast('Batch added (stock-in)');
    } catch (e) {
      if (e.code === 'DUPLICATE_BATCH') {
        if (confirm('⚠ Duplicate Serial/Batch alert!\n\n' + e.message + '\n\nAdd anyway?')) addBatch(true);
      } else toast(e.message);
    }
  };
  const delBatch = async (id) => { if (!confirm('Delete this batch?')) return; await api.del('/items/batches/' + id); load(); toast('Batch deleted'); };
  const set = (k) => (e) => setNb({ ...nb, [k]: e.target.value });

  // Live duplicate serial/batch check while typing
  const [dupWarn, setDupWarn] = useState(null);
  useEffect(() => {
    const bn = (nb.batch_no || '').trim();
    if (!bn || bn.toUpperCase() === 'NA') { setDupWarn(null); return; }
    const t = setTimeout(() => {
      api.get('/items/batches/check/' + encodeURIComponent(bn))
        .then((r) => setDupWarn(r.duplicate ? r.matches : null)).catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [nb.batch_no]);

  useHotkeys({ f5: () => setAdding(true) }, [], { modal: true });

  return (
    <Modal size="lg" title={`Batches — ${item.name}`} onClose={onClose} onAccept={() => (adding ? addBatch() : onClose())}
      footer={<><span className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>F5 = add batch • Sales auto-pick nearest expiry (FEFO)</span><button className="btn btn-primary" onClick={onClose}>Done (Esc)</button></>}>
      {!adding && <button className="btn btn-primary btn-sm" style={{ marginBottom: 10 }} onClick={() => setAdding(true)}>F5 — Add Batch</button>}
      {adding && (
        <div className="totbox" style={{ marginBottom: 12 }}>
          {dupWarn && (
            <div className="alert alert-danger" style={{ margin: '0 0 10px' }}>
              ⚠ Duplicate Serial/Batch — "{nb.batch_no}" already exists ({dupWarn.map((d) => d.item_name).join(', ')}). You can still add, but verify it isn't an error.
            </div>
          )}
          <div className="entry-grid two">
            <label>Batch/Serial No</label><input className="fld" autoFocus value={nb.batch_no} onChange={set('batch_no')} />
            <label>Mfg Date</label><input className="fld" type="date" value={nb.mfg_date} onChange={set('mfg_date')} />
            <label>Expiry</label><input className="fld" type="date" value={nb.expiry_date} onChange={set('expiry_date')} />
            <label>Purchase ₹</label><input className="fld" type="number" value={nb.purchase_price} onChange={set('purchase_price')} />
            <label>MRP ₹</label><input className="fld" type="number" value={nb.mrp} onChange={set('mrp')} />
            <label>Qty In</label><input className="fld" type="number" value={nb.qty_in} onChange={set('qty_in')} />
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setAdding(false)}>Cancel</button>
            <button className="btn btn-primary" data-accept="1" onClick={addBatch}>Accept (Ctrl+A)</button>
          </div>
        </div>
      )}
      {batches.length === 0 ? <div className="empty"><div className="big">🏷️</div>No batches yet</div> : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Batch</th><th>Mfg</th><th>Expiry</th><th className="text-right">Purch</th><th className="text-right">MRP</th><th className="text-right">Avail/In</th><th></th></tr></thead>
            <tbody>
              {batches.map((b) => {
                const ex = expiryInfo(b.expiry_date);
                return (
                  <tr key={b.id}>
                    <td><b>{b.batch_no}</b></td><td>{b.mfg_date || '—'}</td>
                    <td>{ex ? <span className={'badge ' + ex.cls}>{ex.label}</span> : '—'}</td>
                    <td className="text-right num">{fmt(b.purchase_price)}</td>
                    <td className="text-right num">{fmt(b.mrp)}</td>
                    <td className="text-right num"><b>{fmtN(b.qty_available)}</b> / {fmtN(b.qty_in)}</td>
                    <td className="text-right"><button className="btn btn-sm btn-danger" onClick={() => delBatch(b.id)}>Del</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
