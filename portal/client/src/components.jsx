import { useEffect } from 'react';

// Simple modal — becomes a full-screen sheet on phones (see styles.css).
export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><span>{title}</span><button className="x" onClick={onClose} aria-label="Close">×</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// Confirmation dialog (replaces window.confirm — works well on touch).
export function Confirm({ title = 'Are you sure?', message, confirmLabel = 'Confirm', danger, busy, onConfirm, onClose, extra }) {
  return (
    <Modal title={title} onClose={busy ? undefined : onClose}
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className={'btn ' + (danger ? 'btn-danger' : 'btn-primary')} onClick={onConfirm} disabled={busy}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </>}>
      {message && <p style={{ fontSize: 14, whiteSpace: 'pre-line' }}>{message}</p>}
      {extra}
    </Modal>
  );
}

// License status badge from a status object { state, daysLeft }.
export function StatusBadge({ status }) {
  if (!status) return <span className="badge none">No License</span>;
  const map = {
    active: ['active', 'Active' + (status.daysLeft != null ? ` · ${status.daysLeft}d` : '')],
    perpetual: ['perpetual', 'Lifetime'],
    expiring: ['expiring', `Expiring · ${status.daysLeft}d`],
    expired: ['expired', `Expired${status.daysLeft != null ? ` · ${-status.daysLeft}d ago` : ''}`],
    revoked: ['revoked', 'Revoked'],
    renewed: ['none', 'Renewed'],
    none: ['none', 'No License'],
  };
  const [cls, label] = map[status.state] || map.none;
  return <span className={'badge ' + cls}>{label}</span>;
}

export const PRODUCT_LABEL = { desktop: 'Desktop', mobile: 'Mobile' };
export const productLabel = (p) => (p === 'mobile' ? 'Mobile' : 'Desktop');

// Desktop / Mobile tag, with an "Add-on" chip when it is one.
export function ProductTag({ product, kind }) {
  const p = product === 'mobile' ? 'mobile' : 'desktop';
  return (
    <span className="tags">
      <span className={'badge ' + (p === 'mobile' ? 'sales' : 'base')}>{productLabel(p)}</span>
      {kind === 'addon' && <span className="badge addon">Add-on</span>}
    </span>
  );
}

// Segmented picker (used for Desktop / Mobile / Both).
export function Segmented({ value, onChange, options }) {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button type="button" key={o.value} className="seg" aria-pressed={value === o.value}
          disabled={o.disabled} onClick={() => onChange(o.value)} title={o.title || ''}>
          {o.label}{o.sub ? <small>{o.sub}</small> : null}
        </button>
      ))}
    </div>
  );
}

export function fmtDate(s) { return s || '—'; }

// Expiry shown in a table cell: "Lifetime" for perpetual keys.
export function expiryText(lic) {
  if (!lic) return '—';
  return lic.perpetual || !lic.expires ? 'Lifetime' : lic.expires;
}
