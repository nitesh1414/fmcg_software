import { useEffect, useState, useRef } from 'react';
import { Modal, fmt, fmtN, expiryInfo } from './ui';
import { api } from '../api/client';
import { useHotkeys } from '../keyboard';

/**
 * Real-time stock lookup popup. Type a product name/code and instantly see
 * available stock, value, average cost and a per-batch (serial) breakup with
 * expiry. Opened globally with Ctrl+K.
 */
export default function StockLookup({ onClose }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current && inputRef.current.focus(); }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      api.get('/reports/stock-search?q=' + encodeURIComponent(q)).then(setItems).finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useHotkeys({ escape: () => onClose() }, [onClose], { modal: true });

  return (
    <Modal size="lg" title="🔍 Real-time Stock Lookup" onClose={onClose} onAccept={onClose} autofocus={false}
      footer={<><span className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>Type to search · Esc to close · opens anywhere with Ctrl+K</span><button className="btn btn-primary" onClick={onClose}>Close (Esc)</button></>}>
      <input ref={inputRef} className="fld" placeholder="Type product name or code…" value={q}
        onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12 }} />
      {loading ? <div className="muted" style={{ padding: 10 }}>Searching…</div> :
        items.length === 0 ? <div className="empty"><div className="big">🔍</div>No matching products</div> : (
          <div className="table-wrap" style={{ maxHeight: 420 }}>
            <table className="tbl">
              <thead>
                <tr><th>Product</th><th>Code</th><th className="text-right">In Stock</th><th className="text-right">Avg Cost</th><th className="text-right">Stock Value</th><th>Serials / Batches (available)</th></tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td><b>{it.name}</b></td>
                    <td>{it.sku || '—'}</td>
                    <td className="text-right num">
                      <span className={'badge ' + (it.stock > 0 ? 'badge-success' : 'badge-danger')}>{fmtN(it.stock)} {it.unit}</span>
                    </td>
                    <td className="text-right num">{fmt(it.avg_cost)}</td>
                    <td className="text-right num">{fmt(it.stock_value)}</td>
                    <td>
                      {it.batches.length === 0 ? <span className="muted">none</span> :
                        it.batches.map((b, i) => {
                          const ex = expiryInfo(b.expiry_date);
                          return (
                            <span key={i} className="badge badge-muted" style={{ marginRight: 4 }}>
                              {b.batch_no}: {fmtN(b.qty_available)}{ex ? ' · ' + ex.label : ''}
                            </span>
                          );
                        })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </Modal>
  );
}
