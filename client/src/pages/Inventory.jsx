import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { fmt, fmtN, expiryInfo } from '../components/ui';
import { ListScreen } from '../components/ListScreen';
import { useScreenSetup } from '../components/TallyFrame';
import { useHotkeys } from '../keyboard';
import { downloadCSV } from '../api/csv';

export default function Inventory() {
  const nav = useNavigate();
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');

  useEffect(() => { api.get('/reports/stock').then(setRows); }, []);

  const enriched = rows.map((r) => ({ ...r, ex: expiryInfo(r.expiry_date) }));
  const filtered = enriched.filter((r) => {
    if (q && !r.item_name.toLowerCase().includes(q.toLowerCase()) && !(r.batch_no || '').toLowerCase().includes(q.toLowerCase())) return false;
    if (filter === 'expiring') return r.ex && r.ex.days >= 0 && r.ex.days <= 30;
    if (filter === 'expired') return r.ex && r.ex.days < 0;
    if (filter === 'low') return r.qty_available <= 10;
    return true;
  });
  const totalValue = filtered.reduce((s, r) => s + r.stock_value, 0);
  const totalQty = filtered.reduce((s, r) => s + r.qty_available, 0);

  const exportCsv = () => downloadCSV('batch-inventory', filtered, [
    { key: 'item_name', label: 'Item' }, { key: 'batch_no', label: 'Batch' }, { key: 'hsn', label: 'HSN' },
    { key: 'mfg_date', label: 'Mfg' }, { key: 'expiry_date', label: 'Expiry' },
    { key: 'qty_available', label: 'Qty' }, { key: 'unit', label: 'Unit' },
    { key: 'purchase_price', label: 'Cost' }, { key: 'mrp', label: 'MRP' }, { key: 'stock_value', label: 'Value' },
  ]);

  useScreenSetup({
    title: 'Batch Inventory / Stock Summary', sub: `Value ${fmt(totalValue)} · Qty ${fmtN(totalQty)} · ${filtered.length} batches`,
    buttons: [
      { title: 'Filter' },
      { key: 'f4', label: 'F4', text: 'All', onClick: () => setFilter('all') },
      { key: 'f5', label: 'F5', text: 'Low ≤10', onClick: () => setFilter('low') },
      { key: 'f6', label: 'F6', text: 'Expiring', onClick: () => setFilter('expiring') },
      { key: 'f7', label: 'F7', text: 'Expired', onClick: () => setFilter('expired') },
      { sep: true },
      { key: 'ctrl+e', label: 'Ctrl+E', text: 'Export CSV', onClick: exportCsv },
      { key: 'escape', label: 'Esc', text: 'Dashboard', onClick: () => nav('/') },
    ],
  }, [filtered, totalValue]);
  useHotkeys({ escape: () => nav('/') }, [nav]);

  return (
    <>
      <div className="filterbar">
        <span className="kbd">Find</span>
        <input placeholder="Search item / batch…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 220 }} />
        <span className="muted">Filter:</span>
        <b style={{ color: 'var(--navy2)', textTransform: 'capitalize' }}>{filter}</b>
        <span className="muted"> (F4 All · F5 Low · F6 Expiring · F7 Expired)</span>
      </div>
      <ListScreen
        rows={filtered} deps={[q, filter]} emptyIcon="🏷️" emptyText="No batches match"
        columns={[
          { key: 'item_name', label: 'Item', render: (r) => <b>{r.item_name}</b> },
          { key: 'batch_no', label: 'Batch', render: (r) => <span className="badge badge-muted">{r.batch_no}</span> },
          { key: 'hsn', label: 'HSN' },
          { key: 'mfg_date', label: 'Mfg' },
          { key: 'expiry_date', label: 'Expiry', render: (r) => r.ex ? <span className={'badge ' + r.ex.cls}>{r.ex.label}</span> : '—' },
          { key: 'qty_available', label: 'Qty', align: 'right', render: (r) => <b>{fmtN(r.qty_available)}</b> },
          { key: 'purchase_price', label: 'Cost', align: 'right', render: (r) => fmt(r.purchase_price) },
          { key: 'mrp', label: 'MRP', align: 'right', render: (r) => fmt(r.mrp) },
          { key: 'stock_value', label: 'Value', align: 'right', render: (r) => fmt(r.stock_value) },
        ]}
      />
    </>
  );
}
