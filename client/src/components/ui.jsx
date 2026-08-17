import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useHotkeys, useEnterNav } from '../keyboard';

// ---- Money / format helpers ----
export const fmt = (n) =>
  '₹' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtN = (n) => (Number(n) || 0).toLocaleString('en-IN');
export const today = () => new Date().toISOString().slice(0, 10);

// Compact Indian-system money for dashboard cards / tight UI so large numbers
// never overflow. e.g. 1234 -> ₹1,234 · 250000 -> ₹2.50 L · 12500000 -> ₹1.25 Cr
export const fmtCompact = (n) => {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1.0e7) return `${sign}₹${(abs / 1.0e7).toFixed(2)} Cr`;
  if (abs >= 1.0e5) return `${sign}₹${(abs / 1.0e5).toFixed(2)} L`;
  if (abs >= 1.0e3) return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
  return `${sign}₹${abs.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};
// Compact plain count: 1500 -> 1.5K, 2300000 -> 23 L
export const fmtNCompact = (n) => {
  const abs = Math.abs(Number(n) || 0);
  if (abs >= 1.0e7) return (abs / 1.0e7).toFixed(2) + ' Cr';
  if (abs >= 1.0e5) return (abs / 1.0e5).toFixed(2) + ' L';
  if (abs >= 1.0e3) return (abs / 1.0e3).toFixed(1) + 'K';
  return String(abs);
};

// ---- Modal (Tally popup): Esc=close, Ctrl+A / Ctrl+Enter = accept ----
export function Modal({ title, onClose, onAccept, children, footer, size, autofocus = true }) {
  const ref = useRef(null);
  const enterNav = useEnterNav();

  useHotkeys(
    {
      escape: () => onClose && onClose(),
      'ctrl+a': () => onAccept && onAccept(),
      'ctrl+enter': () => onAccept && onAccept(),
    },
    [onClose, onAccept],
    { modal: true }
  );

  useEffect(() => {
    if (!autofocus) return;
    const first = ref.current?.querySelector('input, select, textarea');
    if (first) { first.focus(); try { first.select(); } catch (_) {} }
  }, [autofocus]);

  // Modals never close on an outside click — only Esc or the ✕ / footer button.
  // This prevents accidental data loss while filling a long voucher/form.
  return (
    <div className="modal-overlay">
      <div className={'modal ' + (size === 'full' ? 'full' : size === 'lg' ? 'lg' : size === 'sm' ? 'sm' : '')} ref={ref} onKeyDown={enterNav}>
        <div className="modal-head">
          <span>{title}</span>
          <button className="close-x" onClick={onClose} title="Close (Esc)" aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---- Toast ----
const ToastCtx = createContext(null);
export function ToastProvider({ children }) {
  const [msg, setMsg] = useState(null);
  const toast = useCallback((m) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 2600);
  }, []);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      {msg && <div className="toast">{msg}</div>}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx) || (() => {});

// ---- Status badge ----
export function StatusBadge({ status }) {
  const map = { paid: 'badge-success', partial: 'badge-warning', unpaid: 'badge-danger' };
  return <span className={'badge ' + (map[status] || 'badge-muted')}>{status}</span>;
}

// ---- Empty state ----
export function Empty({ icon = '📭', text = 'No records found' }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      <div>{text}</div>
    </div>
  );
}

// ---- Days until expiry helper ----
export function expiryInfo(dateStr) {
  if (!dateStr) return null;
  const days = Math.ceil((new Date(dateStr) - new Date()) / 86400000);
  if (days < 0) return { days, label: 'Expired', cls: 'badge-danger' };
  if (days <= 30) return { days, label: days + 'd left', cls: 'badge-warning' };
  return { days, label: dateStr, cls: 'badge-muted' };
}
