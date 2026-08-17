import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { useToast } from './ui';
import { useHotkeys } from '../keyboard';

/**
 * Searchable party (customer / supplier) picker for the voucher head, with an
 * inline "＋ Add new" so a walk-in customer / new supplier can be created
 * without leaving the bill.
 *
 * Props:
 *  - parties:   array of party objects (already filtered by type by the parent)
 *  - value:     currently-selected party id ('' = none / walk-in)
 *  - type:      'customer' | 'supplier'
 *  - allowWalkIn: show a "Walk-in" clear option (sales)
 *  - onSelect(party|null): called with the chosen party (null = walk-in/cleared)
 *  - onCreated(party):     called after a new party is created (parent adds it
 *                          to its list); selection is handled via onSelect too.
 */
export default function PartySearch({ parties, value, type = 'customer', allowWalkIn = false, allowAdd = true, onSelect, onCreated }) {
  const isCust = type === 'customer';
  const selected = parties.find((p) => String(p.id) === String(value)) || null;

  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [adding, setAdding] = useState(null); // prefilled name string when quick-add open
  const boxRef = useRef(null);
  const inputRef = useRef(null);

  // Show the selected party's name in the box when not actively searching.
  const display = open ? text : (selected ? selected.name : '');

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return parties.slice(0, 50);
    return parties
      .filter((p) => p.name.toLowerCase().includes(q) || (p.phone || '').includes(q) || (p.gstin || '').toLowerCase().includes(q))
      .slice(0, 50);
  }, [text, parties]);

  useEffect(() => { if (hi >= matches.length) setHi(0); }, [matches.length]);

  useEffect(() => {
    const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const choose = (p) => { onSelect(p); setText(''); setOpen(false); };
  const walkIn = () => { onSelect(null); setText(''); setOpen(false); };

  // While the dropdown is open, claim Esc as a popup-priority handler so it
  // closes only the list (not the parent voucher modal). When closed we don't
  // register, so Esc falls through to the Modal as usual.
  useHotkeys(
    { escape: () => { if (open) { setOpen(false); return true; } return false; } },
    [open],
    { modal: true, popup: true }
  );

  // total selectable rows = [walk-in?] + matches + [add-new]
  const onKey = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key.length === 1)) setOpen(true);
    const addIdx = allowAdd ? matches.length : -1; // add-new row sits right after matches
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setHi((i) => Math.min(addIdx, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setHi((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') {
      if (!open) return;
      e.preventDefault(); e.stopPropagation();
      if (hi === addIdx) openAdd();
      else if (hi === -1) walkIn();
      else if (matches[hi]) choose(matches[hi]);
    }
    // Escape is handled by the popup-priority useHotkeys above.
  };

  const openAdd = () => { setOpen(false); setAdding(text.trim()); };

  return (
    <div className="ps-wrap" ref={boxRef}>
      <input
        ref={inputRef}
        className="fld ps-input"
        value={display}
        placeholder={allowWalkIn ? 'Walk-in — type to search / add customer…' : `Search or add ${type}…`}
        onChange={(e) => { setText(e.target.value); setOpen(true); setHi(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
      />
      {open && (
        <div className="ps-pop">
          {allowWalkIn && (
            <div className={'ps-opt ' + (hi === -1 ? 'hi' : '')} onMouseEnter={() => setHi(-1)} onMouseDown={(e) => { e.preventDefault(); walkIn(); }}>
              <span className="ps-name">🚶 Walk-in customer (no account)</span>
            </div>
          )}
          {matches.map((p, i) => (
            <div
              key={p.id}
              className={'ps-opt ' + (i === hi ? 'hi' : '')}
              onMouseEnter={() => setHi(i)}
              onMouseDown={(e) => { e.preventDefault(); choose(p); }}
            >
              <span className="ps-name">{p.name}{p.phone ? <span className="ps-sku"> · {p.phone}</span> : ''}{p.gstin ? <span className="ps-sku"> · {p.gstin}</span> : ''}</span>
              {p.state ? <span className="ps-stock">{p.state}</span> : null}
            </div>
          ))}
          {matches.length === 0 && !allowAdd && (
            <div className="ps-empty">No matches</div>
          )}
          {allowAdd && (
            <div
              className={'ps-opt ps-add ' + (hi === matches.length ? 'hi' : '')}
              onMouseEnter={() => setHi(matches.length)}
              onMouseDown={(e) => { e.preventDefault(); openAdd(); }}
            >
              <span className="ps-name ps-add-label">
                ＋ Add new {type}{text.trim() ? ` "${text.trim()}"` : ''}
              </span>
            </div>
          )}
        </div>
      )}

      {adding !== null && (
        <QuickPartyModal
          type={type}
          initialName={adding}
          onClose={() => setAdding(null)}
          onSaved={(p) => { setAdding(null); if (onCreated) onCreated(p); onSelect(p); setText(''); }}
        />
      )}
    </div>
  );
}

// Lightweight inline create form (subset of the full PartyForm) so a new
// customer/supplier can be added mid-bill. Rendered as its own overlay so it
// sits above the voucher modal.
function QuickPartyModal({ type, initialName, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ name: initialName || '', type, phone: '', gstin: '', state: '', address: '', opening_balance: 0 });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const firstRef = useRef(null);
  useEffect(() => { setTimeout(() => firstRef.current && firstRef.current.focus(), 30); }, []);

  const save = async () => {
    if (!f.name.trim()) return toast('Name is required');
    setBusy(true);
    try {
      const p = await api.post('/parties', { ...f, name: f.name.trim() });
      toast(`${type === 'customer' ? 'Customer' : 'Supplier'} added`);
      onSaved(p);
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
          <span>Quick Add — New {type === 'customer' ? 'Customer' : 'Supplier'}</span>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="modal-narrow entry-grid" style={{ gridTemplateColumns: '130px 1fr' }}>
            <label>Name *</label><input ref={firstRef} className="fld" value={f.name} onChange={set('name')} />
            <label>Phone</label><input className="fld" value={f.phone} onChange={set('phone')} />
            <label>GSTIN</label><input className="fld" style={{ textTransform: 'uppercase' }} value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} />
            <label>State</label><input className="fld" value={f.state} onChange={set('state')} />
            <label>Opening Bal ₹</label><input className="fld" type="number" value={f.opening_balance} onChange={set('opening_balance')} />
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
