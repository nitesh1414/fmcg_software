import { useEffect, useRef, useState } from 'react';
import { useBusiness } from '../business';
import Icon from './Icon';

/**
 * Inline business selector for individual screens (Sales, Purchase, Reports).
 * Renders a labelled dropdown; hidden when only one business exists.
 * Changing it switches the active business (single source of truth).
 */
export function BusinessInline({ label = 'Business', bar = false }) {
  const { list, activeId, multi, switchTo } = useBusiness();
  if (!multi) return null;
  const inner = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Icon name="factory" size={14} /> {label}
      </span>
      <select className="fld" value={activeId || ''} onChange={(e) => switchTo(Number(e.target.value))}>
        {list.filter((b) => b.active).map((b) => (
          <option key={b.id} value={b.id}>{b.name}{b.is_default ? ' (default)' : ''}</option>
        ))}
      </select>
    </span>
  );
  if (bar) return <div className="filterbar" style={{ justifyContent: 'flex-end' }}>{inner}</div>;
  return inner;
}

/**
 * Editable business selector for use INSIDE a voucher/form (sale, purchase,
 * receipt/payment). Lets the user change which business the entry posts to
 * without a page reload (soft switch). Rendered as a labelled form row.
 * Hidden when only one business exists.
 *
 *   value    = current businessId
 *   onChange = called with the new numeric businessId after switching
 */
export function BusinessFieldPicker({ value, onChange, label = 'Business' }) {
  const { list, multi, setActive } = useBusiness();
  if (!multi) return null;
  const active = list.filter((b) => b.active);
  const change = (id) => {
    const n = Number(id);
    if (!n || n === value) return;
    setActive(n);              // soft switch: persists + broadcasts, no reload
    if (onChange) onChange(n);
  };
  // Returns label + select as two cells so it drops into a parent `entry-grid`.
  return (
    <>
      <label>{label}</label>
      <select className="fld" data-noenter="1" value={value || ''} onChange={(e) => change(e.target.value)} style={{ fontWeight: 600 }}>
        {active.map((b) => <option key={b.id} value={b.id}>{b.name}{b.is_default ? ' (default)' : ''}</option>)}
      </select>
    </>
  );
}

/**
 * Top-bar business selector. Hidden when only one business exists.
 * Opens a dropdown to switch the active business (Alt+M shortcut opens it).
 */
export default function BusinessSwitcher() {
  const { list, active, multi, switchTo } = useBusiness();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    const openEvt = () => setOpen((v) => !v);
    window.addEventListener('open-business-switcher', openEvt);
    return () => { document.removeEventListener('mousedown', h); window.removeEventListener('open-business-switcher', openEvt); };
  }, []);

  if (!multi) return null; // single business → no selection needed

  return (
    <div className="biz-switch" ref={ref} data-multi="1">
      <button className="biz-btn" onClick={() => setOpen((v) => !v)} title="Switch business (Alt+M)">
        <Icon name="factory" size={15} />
        <span className="biz-name">{active ? active.name : 'Business'}</span>
        <span className="biz-caret">▾</span>
      </button>
      {open && (
        <div className="biz-pop" onClick={(e) => e.stopPropagation()}>
          <div className="biz-pop-head">Switch Business</div>
          {list.map((b) => (
            <div
              key={b.id}
              className={'biz-opt ' + (active && b.id === active.id ? 'active' : '')}
              onClick={() => { setOpen(false); switchTo(b.id); }}
            >
              <span className="biz-opt-name">
                {b.name}
                {b.is_default ? <span className="biz-tag">default</span> : null}
              </span>
              {active && b.id === active.id && <Icon name="check" size={15} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
