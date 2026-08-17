import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, getToken } from '../api/client';
import { Empty, fmt, fmtN, today } from '../components/ui';
import { useScreenSetup } from '../components/TallyFrame';
import { useHotkeys } from '../keyboard';
import { downloadCSV } from '../api/csv';
import { BusinessInline } from '../components/BusinessSwitcher';

const REPORTS = [
  { id: 'fy-balance', hk: 'F', label: 'inancial Year Balance' },
  { id: 'gst-return', hk: 'R', label: ' GST Return (GSTR-1/3B)' },
  { id: 'gstr1-json', hk: 'J', label: ' GSTR-1 JSON Export (portal)' },
  { id: 'hsn', hk: 'H', label: 'SN Summary (Table 12)' },
  { id: 'sales', hk: 'S', label: 'ales Register' },
  { id: 'purchase', hk: 'P', label: 'urchase Register' },
  { id: 'gst-sale', hk: 'G', label: 'ST Summary (Sales)' },
  { id: 'gst-purchase', hk: 'T', label: ' GST Summary (Purchase)' },
  { id: 'stock', hk: 'B', label: 'atch/Serial Stock Report' },
  { id: 'outstanding', hk: 'O', label: 'utstanding (Parties)' },
  { id: 'trace', hk: 'W', label: 'ho-Bought/Sold (Trace)' },
  { id: 'duplicates', hk: 'D', label: 'uplicate Serial Alerts' },
];

export default function Reports() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const initId = sp.get('r');
  const initIdx = Math.max(0, REPORTS.findIndex((r) => r.id === initId));
  const [active, setActive] = useState(REPORTS[initIdx] ? REPORTS[initIdx].id : 'fy-balance');
  const [menuIdx, setMenuIdx] = useState(initIdx === -1 ? 0 : initIdx);
  const [range, setRange] = useState({ from: today().slice(0, 7) + '-01', to: today() });
  const [trace, setTrace] = useState({ q: '', batch: '', type: 'all' });
  const [stockStatus, setStockStatus] = useState('all');
  const [fyList, setFyList] = useState([]);
  const [fy, setFy] = useState('');
  const [gstType, setGstType] = useState('sale');
  const [gstData, setGstData] = useState(null);
  const [months, setMonths] = useState([]);
  const [month, setMonth] = useState('');
  const [gstr1, setGstr1] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/reports/financial-years').then((l) => {
      setFyList(l);
      if (l.length && !fy) setFy(l[0].label);
    }).catch(() => {});
    api.get('/reports/gst-months').then((m) => {
      setMonths(m);
      if (m.length && !month) setMonth(m[0]);
    }).catch(() => {});
  }, []);

  const load = () => {
    setLoading(true);
    setGstData(null);
    if (active === 'gstr1-json') {
      if (!month) { setLoading(false); return; }
      api.get(`/reports/gstr1-summary?month=${month}`)
        .then((d) => { setGstr1(d); setRows(d.hsn || []); })
        .catch((e) => { setGstr1({ error: e.message }); setRows([]); })
        .finally(() => setLoading(false));
      return;
    }
    let url;
    if (active === 'fy-balance') url = `/reports/fy-balance?fy=${encodeURIComponent(fy)}`;
    else if (active === 'gst-return') url = `/reports/gst-return?type=${gstType}&fy=${encodeURIComponent(fy)}`;
    else if (active === 'hsn') url = `/reports/hsn-summary?fy=${encodeURIComponent(fy)}`;
    else if (active === 'sales') url = `/reports/transactions?type=sale&from=${range.from}&to=${range.to}`;
    else if (active === 'purchase') url = `/reports/transactions?type=purchase&from=${range.from}&to=${range.to}`;
    else if (active === 'gst-sale') url = `/reports/gst?type=sale&from=${range.from}&to=${range.to}`;
    else if (active === 'gst-purchase') url = `/reports/gst?type=purchase&from=${range.from}&to=${range.to}`;
    else if (active === 'stock') url = `/reports/stock?status=${stockStatus}`;
    else if (active === 'outstanding') url = `/reports/outstanding`;
    else if (active === 'trace') url = `/reports/trace?type=${trace.type}&q=${encodeURIComponent(trace.q)}&batch=${encodeURIComponent(trace.batch)}`;
    else if (active === 'duplicates') url = `/reports/duplicate-serials`;
    api.get(url).then((data) => {
      if (active === 'fy-balance') setRows(data.rows || []);
      else if (active === 'gst-return') { setGstData(data); setRows(data.detail || []); }
      else setRows(data);
    }).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [active, range, trace, stockStatus, fy, gstType, month]);

  const downloadGstr1 = (force) => {
    const token = getToken();
    const url = `/api/reports/gstr1-json?month=${month}&download=1${force ? '&force=1' : ''}`;
    fetch(url, { headers: { Authorization: 'Bearer ' + token } })
      .then(async (r) => {
        if (r.status === 422) {
          const e = await r.json();
          const v = e.validation || { errors: [] };
          if (confirm(`⚠ GSTR-1 file has ${v.errors.length} validation error(s):\n\n` + v.errors.slice(0, 8).join('\n') + '\n\nDownload anyway (not recommended)?')) {
            return downloadGstr1(true);
          }
          throw new Error('Download cancelled — fix the errors first.');
        }
        if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'Failed'); }
        return r.blob();
      })
      .then((b) => {
        if (!b) return;
        const u = URL.createObjectURL(b);
        const a = document.createElement('a'); a.href = u; a.download = `GSTR1_${month}.json`;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000);
      })
      .catch((e) => e.message && e.message.includes('cancelled') ? null : alert(e.message));
  };

  const config = getConfig(active);
  const exportCsv = () => downloadCSV(active + '-report', rows, config.columns);

  const selectReport = (i) => { setMenuIdx(i); setActive(REPORTS[i].id); };
  useEffect(() => {
    const rid = sp.get('r');
    if (!rid) return;
    const idx = REPORTS.findIndex((r) => r.id === rid);
    if (idx >= 0) { setMenuIdx(idx); setActive(REPORTS[idx].id); }
  }, [sp]);
  const letterMap = {};
  REPORTS.forEach((r, i) => { letterMap[r.hk.trim().toLowerCase()] = () => selectReport(i); });

  useScreenSetup({
    title: 'Display — Reports', sub: config.title,
    buttons: [
      { key: 'ctrl+e', label: 'Ctrl+E', text: 'Export CSV/Excel', onClick: exportCsv },
      { sep: true },
      { key: 'escape', label: 'Esc', text: 'Dashboard', onClick: () => nav('/') },
    ],
  }, [active, rows]);
  useHotkeys({
    escape: () => nav('/'),
    arrowdown: () => selectReport((menuIdx + 1) % REPORTS.length),
    arrowup: () => selectReport((menuIdx - 1 + REPORTS.length) % REPORTS.length),
    'ctrl+e': exportCsv,
    ...letterMap,
  }, [menuIdx, active, rows]);

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 240, borderRight: '1px solid var(--border)', background: 'var(--panel)' }}>
        <div className="gw-title">REPORTS</div>
        <div className="report-list">
          {REPORTS.map((r, i) => (
            <div key={r.id} className={'gw-item ' + (i === menuIdx ? 'active' : '')} onClick={() => selectReport(i)}>
              <span><span className="hk">{r.hk}</span>{r.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <BusinessInline label="Reporting for" bar />
        {config.dated && (
          <div className="filterbar">
            <span className="muted">Period</span>
            <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
            <span className="muted">to</span>
            <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
            <span className="muted">· Ctrl+E to export</span>
          </div>
        )}
        {active === 'trace' && (
          <div className="filterbar">
            <span className="kbd">Product</span>
            <input autoFocus placeholder="name or code…" value={trace.q} onChange={(e) => setTrace({ ...trace, q: e.target.value })} style={{ minWidth: 160 }} />
            <span className="kbd">Serial/Batch</span>
            <input placeholder="serial / batch no…" value={trace.batch} onChange={(e) => setTrace({ ...trace, batch: e.target.value })} style={{ minWidth: 150 }} />
            <span className="muted">Show:</span>
            <select value={trace.type} onChange={(e) => setTrace({ ...trace, type: e.target.value })}>
              <option value="all">Purchase + Sale</option>
              <option value="purchase">Purchase (supplier/warranty)</option>
              <option value="sale">Sale (customer support)</option>
            </select>
          </div>
        )}
        {active === 'stock' && (
          <div className="filterbar">
            <span className="muted">Status:</span>
            <select value={stockStatus} onChange={(e) => setStockStatus(e.target.value)}>
              <option value="all">All serials/batches</option>
              <option value="available">Available (in stock)</option>
              <option value="sold">Sold out</option>
            </select>
            <span className="muted">· every serial shown · Ctrl+E export</span>
          </div>
        )}
        {active === 'duplicates' && (
          <div className="filterbar">
            <span className="muted">⚠ Serial/Batch numbers used on more than one stock entry — verify for fraud, supplier errors or accidental overlaps.</span>
          </div>
        )}
        {(active === 'fy-balance' || active === 'gst-return' || active === 'hsn') && (
          <div className="filterbar">
            <span className="muted">Financial Year</span>
            <select value={fy} onChange={(e) => setFy(e.target.value)}>
              {fyList.length === 0 && <option value="">Current</option>}
              {fyList.map((y) => <option key={y.label} value={y.label}>FY {y.label} ({y.from} → {y.to})</option>)}
            </select>
            {active === 'gst-return' && (<>
              <span className="muted">Type</span>
              <select value={gstType} onChange={(e) => setGstType(e.target.value)}>
                <option value="sale">Outward (GSTR-1, Sales)</option>
                <option value="purchase">Inward (GSTR-2, Purchases)</option>
              </select>
            </>)}
            <span className="muted">· Ctrl+E export</span>
          </div>
        )}
        {active === 'gstr1-json' && (
          <div className="filterbar">
            <span className="muted">Filing Month</span>
            <select value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.length === 0 && <option value="">No sales yet</option>}
              {months.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <button className="btn btn-primary btn-sm" disabled={!month} onClick={() => downloadGstr1()}>⬇ Download GSTR-1 JSON</button>
            <span className="muted">· upload to GST portal (Returns → GSTR-1 → Offline upload)</span>
          </div>
        )}
        {active === 'gstr1-json' && gstr1 && !gstr1.error && (
          <div className="filterbar" style={{ gap: 16 }}>
            <span><b>Period (fp):</b> {gstr1.summary.fp}</span>
            <span><b>Invoices:</b> {gstr1.summary.invoiceCount}</span>
            <span><b>B2B:</b> {gstr1.sections.b2b}</span>
            <span><b>B2CL:</b> {gstr1.sections.b2cl}</span>
            <span><b>B2C(S):</b> {gstr1.sections.b2cs}</span>
            <span><b>CDNR:</b> {gstr1.sections.cdnr}</span>
            <span><b>CDNUR:</b> {gstr1.sections.cdnur}</span>
            <span><b>NIL:</b> {gstr1.sections.nil}</span>
            <span><b>HSN:</b> {gstr1.sections.hsn}</span>
          </div>
        )}
        {active === 'gstr1-json' && gstr1 && gstr1.validation && (
          <div style={{ padding: '7px 12px', borderBottom: '1px solid var(--border)',
            background: gstr1.validation.ok ? '#e6f6ea' : '#fdeaea' }}>
            {gstr1.validation.ok
              ? <b style={{ color: 'var(--success)' }}>✓ Schema valid — ready to upload to the GST portal</b>
              : <b style={{ color: 'var(--accent)' }}>✗ {gstr1.validation.errors.length} validation error(s) — fix before filing</b>}
            {gstr1.validation.warnings.length > 0 && <span className="muted"> · {gstr1.validation.warnings.length} warning(s)</span>}
            {(gstr1.validation.errors.length > 0 || gstr1.validation.warnings.length > 0) && (
              <ul style={{ margin: '6px 0 0 18px', fontSize: 12 }}>
                {gstr1.validation.errors.slice(0, 6).map((e, i) => <li key={'e' + i} style={{ color: 'var(--accent)' }}>{e}</li>)}
                {gstr1.validation.warnings.slice(0, 4).map((w, i) => <li key={'w' + i} className="muted">{w}</li>)}
              </ul>
            )}
          </div>
        )}
        {active === 'gstr1-json' && gstr1 && gstr1.error && (
          <div className="alert alert-danger" style={{ margin: 10 }}>⚠ {gstr1.error}</div>
        )}
        {active === 'gst-return' && gstData && (
          <div className="filterbar" style={{ gap: 16 }}>
            <span><b>B2B:</b> {gstData.b2bCount}</span>
            <span><b>B2C:</b> {gstData.b2cCount}</span>
            <span><b>Taxable:</b> {fmt(gstData.totals.taxable)}</span>
            <span><b>CGST:</b> {fmt(gstData.totals.cgst)}</span>
            <span><b>SGST:</b> {fmt(gstData.totals.sgst)}</span>
            <span><b>IGST:</b> {fmt(gstData.totals.igst)}</span>
            <span><b>Total:</b> {fmt(gstData.totals.total)}</span>
          </div>
        )}
        {active === 'gst-return' && gstData && gstData.rateWise.length > 0 && (
          <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
            <b className="muted">Rate-wise summary: </b>
            {gstData.rateWise.map((r) => (
              <span key={r.gst_rate} className="badge badge-muted" style={{ marginRight: 6 }}>
                {r.gst_rate}% → taxable {fmt(r.taxable)} (C {fmt(r.cgst)} / S {fmt(r.sgst)})
              </span>
            ))}
          </div>
        )}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading ? <div className="muted" style={{ padding: 20 }}>Loading…</div> :
            rows.length === 0 ? <Empty icon="📈" text="No data for selected criteria" /> : (
              <table className="tbl">
                <thead><tr>{config.columns.map((c) => <th key={c.key} style={{ textAlign: c.num || c.money ? 'right' : 'left' }}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>{config.columns.map((c) => (
                      <td key={c.key} className={(c.num || c.money) ? 'text-right num' : ''}>{c.render ? c.render(r) : c.money ? fmt(r[c.key]) : c.num ? fmtN(r[c.key]) : (r[c.key] ?? '—')}</td>
                    ))}</tr>
                  ))}
                </tbody>
                {config.totals && (
                  <tfoot>
                    <tr style={{ fontWeight: 700, background: 'var(--panel)' }}>
                      {config.columns.map((c, idx) => {
                        if (idx === 0) return <td key={c.key}>TOTAL</td>;
                        if (c.money) { const sum = rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0); return <td key={c.key} className="text-right num">{fmt(sum)}</td>; }
                        return <td key={c.key}></td>;
                      })}
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
        </div>
      </div>
    </div>
  );
}

function getConfig(active) {
  switch (active) {
    case 'fy-balance':
      return { title: 'Financial Year Balance & P&L', dated: false, totals: false,
        columns: [
          { key: 'metric', label: 'Particulars' },
          { key: 'amount', label: 'Amount', money: true },
        ] };
    case 'gst-return':
      return { title: 'GST Return — GSTR-1 / GSTR-3B (compliant)', dated: false, totals: true,
        columns: [
          { key: 'category', label: 'Type', render: (r) => <span className={'badge ' + (r.category === 'B2B' ? 'badge-primary' : 'badge-muted')}>{r.category}</span> },
          { key: 'invoice_no', label: 'Invoice' }, { key: 'date', label: 'Date' },
          { key: 'party_name', label: 'Party' }, { key: 'gstin', label: 'GSTIN' }, { key: 'place', label: 'State' },
          { key: 'taxable', label: 'Taxable', money: true },
          { key: 'cgst', label: 'CGST', money: true }, { key: 'sgst', label: 'SGST', money: true }, { key: 'igst', label: 'IGST', money: true },
          { key: 'total', label: 'Invoice Total', money: true },
        ] };
    case 'gstr1-json':
      return { title: 'GSTR-1 JSON Export — preview (HSN data in file)', dated: false, totals: true,
        columns: [
          { key: 'hsn_sc', label: 'HSN' }, { key: 'desc', label: 'Description' }, { key: 'uqc', label: 'UQC' }, { key: 'rt', label: 'Rate%' },
          { key: 'qty', label: 'Qty', num: true }, { key: 'txval', label: 'Taxable', money: true },
          { key: 'camt', label: 'CGST', money: true }, { key: 'samt', label: 'SGST', money: true }, { key: 'iamt', label: 'IGST', money: true },
        ] };
    case 'hsn':
      return { title: 'HSN-wise Summary (GSTR-1 Table 12)', dated: false, totals: true,
        columns: [
          { key: 'hsn', label: 'HSN/SAC' }, { key: 'description', label: 'Description' }, { key: 'uqc', label: 'UQC' },
          { key: 'gst_rate', label: 'Rate%' }, { key: 'qty', label: 'Qty', num: true },
          { key: 'taxable', label: 'Taxable', money: true },
          { key: 'cgst', label: 'CGST', money: true }, { key: 'sgst', label: 'SGST', money: true }, { key: 'igst', label: 'IGST', money: true },
          { key: 'total_value', label: 'Total', money: true },
        ] };
    case 'sales':
    case 'purchase':
      return { title: active === 'sales' ? 'Sales Register' : 'Purchase Register', dated: true, totals: true,
        columns: [
          { key: 'invoice_no', label: 'Invoice' }, { key: 'date', label: 'Date' }, { key: 'party_name', label: 'Party' },
          { key: 'subtotal', label: 'Taxable', money: true }, { key: 'tax_total', label: 'Tax', money: true },
          { key: 'total', label: 'Total', money: true }, { key: 'paid', label: 'Paid', money: true }, { key: 'due', label: 'Due', money: true },
        ] };
    case 'gst-sale':
    case 'gst-purchase':
      return { title: active === 'gst-sale' ? 'GST Report — Sales (GSTR-1)' : 'GST Report — Purchase (GSTR-2)', dated: true, totals: true,
        columns: [
          { key: 'gst_rate', label: 'GST %' }, { key: 'taxable', label: 'Taxable', money: true },
          { key: 'cgst', label: 'CGST', money: true }, { key: 'sgst', label: 'SGST', money: true },
          { key: 'tax', label: 'Total Tax', money: true }, { key: 'total', label: 'Invoice Value', money: true },
        ] };
    case 'stock':
      return { title: 'Batch / Serial Stock Report', dated: false, totals: true,
        columns: [
          { key: 'item_name', label: 'Item' }, { key: 'batch_no', label: 'Serial/Batch' }, { key: 'expiry_date', label: 'Expiry' },
          { key: 'stock_status', label: 'Status', render: (r) => <span className={'badge ' + (r.qty_available > 0 ? 'badge-success' : 'badge-muted')}>{r.stock_status}</span> },
          { key: 'qty_available', label: 'Avail', num: true }, { key: 'qty_sold', label: 'Sold', num: true },
          { key: 'avg_cost', label: 'Avg Cost', money: true }, { key: 'mrp', label: 'MRP', money: true },
          { key: 'stock_value', label: 'Value', money: true },
        ] };
    case 'outstanding':
      return { title: 'Party Outstanding', dated: false, totals: true,
        columns: [
          { key: 'name', label: 'Party' }, { key: 'type', label: 'Type' }, { key: 'phone', label: 'Phone' },
          { key: 'total_sale', label: 'Sales', money: true }, { key: 'total_purchase', label: 'Purchase', money: true },
          { key: 'received', label: 'Received', money: true }, { key: 'paid', label: 'Paid', money: true }, { key: 'balance', label: 'Balance', money: true },
        ] };
    case 'trace':
      return { title: 'Batch / Serial Traceability (warranty & support)', dated: false, totals: false,
        columns: [
          { key: 'type', label: 'Type', render: (r) => <span className={'badge ' + (r.type === 'purchase' ? 'badge-warning' : 'badge-success')}>{r.direction}</span> },
          { key: 'item_name', label: 'Product' }, { key: 'batch_no', label: 'Serial/Batch' },
          { key: 'party_name', label: 'Party' }, { key: 'party_phone', label: 'Phone' },
          { key: 'invoice_no', label: 'Invoice' }, { key: 'date', label: 'Date' },
          { key: 'qty', label: 'Qty', num: true }, { key: 'line_total', label: 'Amount', money: true },
        ] };
    case 'duplicates':
      return { title: 'Duplicate Serial / Batch Alerts', dated: false, totals: false,
        columns: [
          { key: 'batch_no', label: 'Serial/Batch No', render: (r) => <b style={{ color: 'var(--accent)' }}>{r.batch_no}</b> },
          { key: 'occurrences', label: 'Times Used', num: true },
          { key: 'total_available', label: 'Total In Stock', num: true },
          { key: 'items', label: 'Found In Items' },
        ] };
    default: return { title: 'Report', columns: [] };
  }
}
