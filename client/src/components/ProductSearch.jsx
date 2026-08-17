import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtN, Modal, useToast } from './ui';
import { useHotkeys } from '../keyboard';
import { useFeatures } from '../features';
import { api } from '../api/client';
import HsnSearch from './HsnSearch';

const UNITS = ['PCS', 'BOX', 'PKT', 'KG', 'GM', 'LTR', 'ML', 'BAG', 'DOZ', 'SET', 'PAIR', 'BTL', 'CTN'];

/**
 * Keyboard-friendly product type-ahead for voucher line entry.
 *
 * - Type to filter by name or SKU; a dropdown of matches appears.
 * - ArrowUp/ArrowDown to move, Enter to choose, Escape to clear the list.
 * - On select, calls onSelect(item).
 * - When `allowAdd` is set, an "＋ Add new product" row lets the user create an
 *   item on the fly (used in the purchase bill). On save it calls onCreate(item).
 *
 * Designed to drop into a voucher grid cell. Shows stock when showStock is set.
 */
export default function ProductSearch({ items, value, onSelect, onCreate, allowAdd = false, showStock = true, autoFocus = false, focusSignal }) {
  const [text, setText] = useState(value || '');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [adding, setAdding] = useState(null); // prefilled name string when quick-add open
  const boxRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { setText(value || ''); }, [value]);

  // Programmatic focus (e.g. after "Add Row") — focus & select the input.
  useEffect(() => {
    if (focusSignal && inputRef.current) {
      inputRef.current.focus();
      try { inputRef.current.select(); } catch (_) {}
    }
  }, [focusSignal]);

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return items.slice(0, 50);
    return items
      .filter((it) => it.name.toLowerCase().includes(q) || (it.sku || '').toLowerCase().includes(q))
      .slice(0, 50);
  }, [text, items]);

  useEffect(() => { if (hi >= matches.length + (allowAdd ? 1 : 0)) setHi(0); }, [matches.length, allowAdd]);

  // Close on outside click
  useEffect(() => {
    const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const choose = (it) => {
    if (!it) return;
    onSelect(it);
    setText(it.name);
    setOpen(false);
  };
  const openAdd = () => { setOpen(false); setAdding(text.trim()); };

  const onKey = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { setOpen(true); return; }
    const addIdx = allowAdd ? matches.length : -1; // add-new row sits after matches
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setHi((i) => Math.min(matches.length - (allowAdd ? 0 : 1), i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setHi((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') {
      if (!open) return;
      e.preventDefault(); e.stopPropagation();
      if (hi === addIdx) openAdd();
      else if (matches[hi]) choose(matches[hi]);
    } else if (e.key === 'Escape') {
      if (open) { e.stopPropagation(); setOpen(false); }
    }
  };

  // keep highlighted row visible
  useEffect(() => {
    const el = boxRef.current?.querySelector('.ps-opt.hi');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [hi, open]);

  return (
    <div className="ps-wrap" ref={boxRef}>
      <input
        ref={inputRef}
        className="ps-input"
        autoFocus={autoFocus}
        value={text}
        placeholder="Type product name / code…"
        onChange={(e) => { setText(e.target.value); setOpen(true); setHi(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
      />
      {open && (
        <div className="ps-pop">
          {matches.length === 0 && !allowAdd ? (
            <div className="ps-empty">No products match</div>
          ) : (
            matches.map((it, i) => (
              <div
                key={it.id}
                className={'ps-opt ' + (i === hi ? 'hi' : '')}
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => { e.preventDefault(); choose(it); }}
              >
                <span className="ps-name">{it.name}{it.sku ? <span className="ps-sku"> · {it.sku}</span> : ''}</span>
                {showStock && (
                  <span className={'ps-stock ' + (it.stock > 0 ? '' : 'zero')}>{fmtN(it.stock)} {it.unit}</span>
                )}
              </div>
            ))
          )}
          {allowAdd && (
            <div
              className={'ps-opt ps-add ' + (hi === matches.length ? 'hi' : '')}
              onMouseEnter={() => setHi(matches.length)}
              onMouseDown={(e) => { e.preventDefault(); openAdd(); }}
            >
              <span className="ps-name ps-add-label">＋ Add new product{text.trim() ? ` "${text.trim()}"` : ''}</span>
            </div>
          )}
        </div>
      )}

      {adding !== null && (
        <QuickItemModal
          initialName={adding}
          onClose={() => setAdding(null)}
          onSaved={(item) => {
            setAdding(null);
            if (onCreate) onCreate(item);   // let parent add it to its item list
            choose(item);                    // and select it into this line
          }}
        />
      )}
    </div>
  );
}

// Lightweight inline create form so a new product can be added mid-purchase.
// Rendered as its own overlay above the voucher modal.
function QuickItemModal({ initialName, onClose, onSaved }) {
  const toast = useToast();
  const { features } = useFeatures();
  const [f, setF] = useState({
    name: initialName || '', sku: '', unit: 'PCS', hsn: '', gst_rate: 18,
    purchase_price: 0, sale_price: 0, low_stock_alert: 0,
    description: '', track_serials: false,
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const firstRef = useRef(null);
  useEffect(() => { setTimeout(() => firstRef.current && firstRef.current.focus(), 30); }, []);

  // Esc must not bubble to the voucher modal; only modal-flagged handlers fire.
  useHotkeys({ escape: () => onClose() }, [], { modal: true, popup: true });

  // GST% stays user-controlled; HSN only fills the code (rates change by year).
  const pickHsn = (row) => { setF((cur) => ({ ...cur, hsn: row.hsn })); };
  const lookupHsnRate = async (code) => {
    if (!code || String(code).length < 4) return;
    try { await api.get('/lookup/hsn/' + encodeURIComponent(code)); } catch (_) {}
  };

  const save = async () => {
    if (!f.name.trim()) return toast('Product name is required');
    setBusy(true);
    try {
      const item = await api.post('/items', { ...f, name: f.name.trim() });
      toast('Product added');
      onSaved(item);
    } catch (e) { toast(e.message || 'Could not save'); } finally { setBusy(false); }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); e.stopPropagation(); save(); }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 1200 }}>
      <div className="modal sm" onKeyDown={onKeyDown}>
        <div className="modal-head">
          <span>Quick Add — New Product</span>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="modal-narrow entry-grid" style={{ gridTemplateColumns: '130px 1fr' }}>
            <label>Name *</label><input ref={firstRef} className="fld" value={f.name} onChange={set('name')} />
            <label>SKU / Code</label><input className="fld" value={f.sku} onChange={set('sku')} />
            <label>Unit</label>
            <select className="fld" value={f.unit} onChange={set('unit')}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select>
            <label>HSN</label>
            {features.autoHSN
              ? <HsnSearch value={f.hsn} onChange={(v) => setF((cur) => ({ ...cur, hsn: v }))} onPick={pickHsn} />
              : <input className="fld" value={f.hsn} onChange={set('hsn')} />}
            <label>GST Rate %</label><input className="fld" type="number" value={f.gst_rate} onChange={set('gst_rate')} onBlur={(e) => lookupHsnRate(f.hsn)} />
            <label>Purchase ₹</label><input className="fld" type="number" value={f.purchase_price} onChange={set('purchase_price')} />
            <label>Sale ₹</label><input className="fld" type="number" value={f.sale_price} onChange={set('sale_price')} />
            <label>Low-stock Alert</label><input className="fld" type="number" value={f.low_stock_alert} onChange={set('low_stock_alert')} />
            <label>Description</label><textarea className="fld" rows={2} value={f.description} onChange={set('description')} placeholder="Shown on bills (optional)" />
            <label>Serial Tracking</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={f.track_serials} onChange={(e) => setF({ ...f, track_serials: e.target.checked })} />
              Unique serial per unit (enter serials while billing)
            </label>
          </div>
        </div>
        <div className="modal-foot">
          <span className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>Enter = save · Esc = cancel</span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save & Select'}</button>
        </div>
      </div>
    </div>
  );
}
