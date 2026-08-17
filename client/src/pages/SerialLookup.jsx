import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { Empty, useToast } from '../components/ui';
import { useScreenSetup } from '../components/TallyFrame';
import { useHotkeys } from '../keyboard';
import { downloadCSV } from '../api/csv';
import { BusinessInline } from '../components/BusinessSwitcher';

// Check items by serial no / batch no, with multiple combinable filters, and
// see availability (in stock vs sold).
export default function SerialLookup() {
  const nav = useNavigate();
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [f, setF] = useState({ q: '', serial: '', batch: '', item_id: '', status: 'in_stock' });
  const [data, setData] = useState({ rows: [], summary: { total: 0, in_stock: 0, sold: 0 } });
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.get('/items').then(setItems).catch(() => {}); }, []);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v) p.set(k, v); });
    return p.toString();
  }, [f]);

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      api.get('/serials?' + query).then(setData).catch(() => {}).finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const reset = () => setF({ q: '', serial: '', batch: '', item_id: '', status: 'in_stock' });

  const exportCsv = () => downloadCSV('serials', data.rows, [
    { key: 'serial_no', label: 'Serial No' }, { key: 'item_name', label: 'Item' }, { key: 'sku', label: 'SKU' },
    { key: 'batch_no', label: 'Batch' }, { key: 'status', label: 'Status' },
    { key: 'purchase_invoice_no', label: 'Purchase Inv' }, { key: 'sale_invoice_no', label: 'Sale Inv' },
  ]);

  useScreenSetup({
    title: 'Serial / Batch Lookup', sub: `${data.summary.in_stock} in stock · ${data.summary.sold} sold · ${data.summary.total} shown`,
    buttons: [
      { key: 'ctrl+e', label: 'Ctrl+E', text: 'Export CSV', onClick: exportCsv },
      { key: 'f4', label: 'F4', text: 'Reset Filters', onClick: reset },
      { sep: true },
      { key: 'escape', label: 'Esc', text: 'Dashboard', onClick: () => nav('/') },
    ],
  }, [data]);
  useHotkeys({ escape: () => nav('/'), f4: reset, 'ctrl+e': exportCsv }, [nav, data]);

  return (
    <>
      <div className="filterbar" style={{ flexWrap: 'wrap', gap: 10 }}>
        <span className="kbd">Find</span>
        <input placeholder="Serial / item / SKU…" value={f.q} onChange={set('q')} style={{ minWidth: 180 }} />
        <input placeholder="Serial no" value={f.serial} onChange={set('serial')} style={{ width: 140 }} />
        <input placeholder="Batch no" value={f.batch} onChange={set('batch')} style={{ width: 130 }} />
        <select className="fld" value={f.item_id} onChange={set('item_id')} style={{ maxWidth: 200 }}>
          <option value="">All items</option>
          {items.map((it) => <option key={it.id} value={it.id}>{it.name}{it.sku ? ' · ' + it.sku : ''}</option>)}
        </select>
        <select className="fld" value={f.status} onChange={set('status')}>
          <option value="in_stock">In stock</option>
          <option value="sold">Sold</option>
          <option value="all">All</option>
        </select>
        <button className="btn btn-sm" onClick={reset}>Clear</button>
        <span style={{ marginLeft: 'auto' }}><BusinessInline label="For business" /></span>
      </div>

      {loading ? (
        <div className="muted" style={{ padding: 16 }}>Searching…</div>
      ) : data.rows.length === 0 ? (
        <Empty icon="🔢" text="No serials match these filters. Serial-tracked purchases register serials automatically." />
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <th>Serial No</th><th>Item</th><th>SKU</th><th>Batch</th>
                <th>Status</th><th>Purchase Inv</th><th>Sale Inv</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={r.id}>
                  <td className="num muted">{i + 1}</td>
                  <td><b>{r.serial_no}</b></td>
                  <td>{r.item_name}</td>
                  <td>{r.sku || '—'}</td>
                  <td>{r.batch_no || '—'}</td>
                  <td><span className={'badge ' + (r.status === 'in_stock' ? 'badge-success' : 'badge-muted')}>{r.status === 'in_stock' ? 'In Stock' : 'Sold'}</span></td>
                  <td>{r.purchase_invoice_no || '—'}</td>
                  <td>{r.sale_invoice_no || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
