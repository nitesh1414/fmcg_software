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
 *  - onCreated(party):     called after a new party is created or an existing
 *                          one is updated (parent upserts it into its list);
 *                          selection is handled via onSelect too.
 */
export default function PartySearch({ parties, value, type = 'customer', allowWalkIn = false, allowAdd = true, onSelect, onCreated }) {
  const toast = useToast();
  const isCust = type === 'customer';
  const selected = parties.find((p) => String(p.id) === String(value)) || null;

  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [adding, setAdding] = useState(null); // string = new name, object = edit party
  const [busy, setBusy] = useState(false);
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const creatingRef = useRef(false);

  // Show the selected party's name in the box when not actively searching.
  const display = open ? text : (selected ? selected.name : '');
  const typed = text.trim();

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return parties.slice(0, 50);
    return parties
      .filter((p) => p.name.toLowerCase().includes(q) || (p.phone || '').includes(q) || (p.gstin || '').toLowerCase().includes(q))
      .slice(0, 50);
  }, [text, parties]);

  const exactMatch = useMemo(() => {
    if (!typed) return null;
    const q = typed.toLowerCase();
    return parties.find((p) => p.name.toLowerCase() === q) || null;
  }, [typed, parties]);

  // Extra dropdown rows after matches: name-only bill-to, then full "add with details".
  const showBillTo = allowAdd && !!typed && !exactMatch;
  const showDetailsAdd = allowAdd;
  const billToIdx = showBillTo ? matches.length : -1;
  const detailsIdx = showDetailsAdd ? matches.length + (showBillTo ? 1 : 0) : -1;
  const lastIdx = Math.max(matches.length - 1, billToIdx, detailsIdx, 0);

  useEffect(() => { if (hi > lastIdx) setHi(0); }, [lastIdx]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const openAdd = (name) => { setOpen(false); setAdding(typeof name === 'string' ? name : typed); };

  // Create a party with just a name (no GSTIN/phone). User can Edit later.
  const billToName = async (raw) => {
    const n = String(raw || typed || '').trim();
    if (!n) { openAdd(''); return; }
    const hit = parties.find((p) => p.name.toLowerCase() === n.toLowerCase());
    if (hit) { choose(hit); return; }
    if (creatingRef.current) return;
    creatingRef.current = true;
    setBusy(true);
    try {
      const p = await api.post('/parties', { name: n, type });
      if (onCreated) onCreated(p);
      choose(p);
    } catch (e) {
      toast(e.message || 'Could not add');
      openAdd(n);
    } finally {
      creatingRef.current = false;
      setBusy(false);
    }
  };

  const onKey = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key.length === 1)) setOpen(true);
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setHi((i) => Math.min(lastIdx, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setHi((i) => Math.max(allowWalkIn ? -1 : 0, i - 1)); }
    else if (e.key === 'Enter') {
      if (!open) return;
      e.preventDefault(); e.stopPropagation();
      if (hi === detailsIdx) openAdd(typed);
      else if (hi === billToIdx) billToName(typed);
      else if (hi === -1) walkIn();
      else if (matches[hi]) choose(matches[hi]);
      else if (typed && !exactMatch) billToName(typed);
    }
  };

  return (
    <div className="ps-wrap" ref={boxRef}>
      <div className="ps-row">
        <input
          ref={inputRef}
          className="fld ps-input"
          value={display}
          placeholder={allowWalkIn ? 'Walk-in — type a name to bill, or search…' : `Search or add ${type}…`}
          onChange={(e) => { setText(e.target.value); setOpen(true); setHi(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          disabled={busy}
        />
        {selected && (
          <button type="button" className="btn btn-sm" tabIndex={-1} data-noenter="1"
            title="Update name, phone, GSTIN…"
            onClick={() => { setOpen(false); setAdding(selected); }}>Edit</button>
        )}
      </div>
      {open && (
        <div className="ps-pop">
          {allowWalkIn && (
            <div className={'ps-opt ' + (hi === -1 ? 'hi' : '')} onMouseEnter={() => setHi(-1)} onMouseDown={(e) => { e.preventDefault(); walkIn(); }}>
              <span className="ps-name">🚶 Walk-in customer (no name)</span>
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
          {showBillTo && (
            <div
              className={'ps-opt ps-add ' + (hi === billToIdx ? 'hi' : '')}
              onMouseEnter={() => setHi(billToIdx)}
              onMouseDown={(e) => { e.preventDefault(); billToName(typed); }}
            >
              <span className="ps-name ps-add-label">
                ＋ Bill to “{typed}” <span className="ps-sku" style={{ fontWeight: 400 }}>· name only — add GSTIN later</span>
              </span>
            </div>
          )}
          {showDetailsAdd && (
            <div
              className={'ps-opt ps-add ' + (hi === detailsIdx ? 'hi' : '')}
              onMouseEnter={() => setHi(detailsIdx)}
              onMouseDown={(e) => { e.preventDefault(); openAdd(typed); }}
            >
              <span className="ps-name ps-add-label">
                ＋ Add {isCust ? 'customer' : 'supplier'} with details{typed ? ` “${typed}”` : ''}
              </span>
            </div>
          )}
        </div>
      )}

      {adding !== null && (
        <QuickPartyModal
          type={type}
          initialName={typeof adding === 'string' ? adding : ''}
          party={typeof adding === 'object' && adding ? adding : null}
          onClose={() => setAdding(null)}
          onSaved={(p) => { setAdding(null); if (onCreated) onCreated(p); onSelect(p); setText(''); }}
        />
      )}
    </div>
  );
}

// Lightweight inline create/edit form (subset of the full PartyForm) so a new
// customer/supplier can be added mid-bill, or a name-only walk-in updated later
// with phone / GSTIN. Rendered as its own overlay so it sits above the voucher.
function QuickPartyModal({ type, initialName, party, onClose, onSaved }) {
  const toast = useToast();
  const editing = !!(party && party.id);
  const [f, setF] = useState(() => ({
    name: (party && party.name) || initialName || '',
    type: (party && party.type) || type,
    phone: (party && party.phone) || '',
    gstin: (party && party.gstin) || '',
    state: (party && party.state) || '',
    address: (party && party.address) || '',
    opening_balance: (party && party.opening_balance) || 0,
  }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const firstRef = useRef(null);
  useEffect(() => { setTimeout(() => firstRef.current && firstRef.current.focus(), 30); }, []);

  const save = async () => {
    if (!f.name.trim()) return toast('Name is required');
    setBusy(true);
    try {
      const body = { ...f, name: f.name.trim() };
      const p = editing
        ? await api.put('/parties/' + party.id, body)
        : await api.post('/parties', body);
      toast(`${type === 'customer' ? 'Customer' : 'Supplier'} ${editing ? 'updated' : 'added'}`);
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
          <span>{editing ? 'Update' : 'Quick Add'} — {type === 'customer' ? 'Customer' : 'Supplier'}</span>
          <button className="close-x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="modal-narrow entry-grid" style={{ gridTemplateColumns: '130px 1fr' }}>
            <label>Name *</label><input ref={firstRef} className="fld" value={f.name} onChange={set('name')} />
            <label>Phone</label><input className="fld" value={f.phone} onChange={set('phone')} />
            <label>GSTIN</label><input className="fld" style={{ textTransform: 'uppercase' }} value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} />
            <label>State</label><input className="fld" value={f.state} onChange={set('state')} />
            <label>Address</label><input className="fld" value={f.address} onChange={set('address')} />
            <label>Opening Bal ₹</label><input className="fld" type="number" value={f.opening_balance} onChange={set('opening_balance')} />
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Name is enough to bill. Phone / GSTIN / address can be filled in later.</p>
        </div>
        <div className="modal-foot">
          <span className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>Enter = save · Esc = cancel</span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : (editing ? 'Save' : 'Save & Select')}</button>
        </div>
      </div>
    </div>
  );
}
