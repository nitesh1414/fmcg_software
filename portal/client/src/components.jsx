import { useEffect } from 'react';

// Simple modal.
export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose && onClose()}>
      <div className="modal" style={wide ? { maxWidth: 680 } : undefined}>
        <div className="modal-head"><span>{title}</span><button className="x" onClick={onClose}>×</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
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
    none: ['none', 'No License'],
  };
  const [cls, label] = map[status.state] || map.none;
  return <span className={'badge ' + cls}>{label}</span>;
}

export function fmtDate(s) { return s || '—'; }
