import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Modal, useToast, fmt } from './ui';

// Purchase line fields we can fill from a spreadsheet.
const FIELDS = [
  { key: 'item_name', label: 'Item / Product Name', required: true },
  { key: 'hsn', label: 'HSN' },
  { key: 'batch_no', label: 'Batch / Serial' },
  { key: 'expiry_date', label: 'Expiry Date' },
  { key: 'qty', label: 'Quantity', required: true },
  { key: 'price', label: 'Purchase Rate', required: true },
  { key: 'discount', label: 'Discount %' },
  { key: 'gst_rate', label: 'GST %' },
  { key: 'mrp', label: 'MRP' },
];

// Header synonyms for auto-mapping (lower-cased).
const SYN = {
  item_name: ['item', 'item name', 'product', 'product name', 'name', 'description', 'particulars', 'itemname', 'goods'],
  hsn: ['hsn', 'hsn code', 'hsn/sac', 'hsncode', 'hsn sac'],
  batch_no: ['batch', 'batch no', 'batch number', 'serial', 'serial no', 'lot', 'lot no', 'batchno'],
  expiry_date: ['expiry', 'expiry date', 'exp', 'exp date', 'expirydate', 'best before'],
  qty: ['qty', 'quantity', 'quantities', 'nos', 'count', 'units', 'pcs'],
  price: ['rate', 'purchase rate', 'purchase price', 'cost', 'cost price', 'buy price', 'price', 'unit price', 'p.rate', 'purc rate'],
  discount: ['disc', 'discount', 'discount %', 'disc%', 'disc %'],
  gst_rate: ['gst', 'gst rate', 'gst%', 'tax', 'tax rate', 'gst %', 'igst', 'gst rate %'],
  mrp: ['mrp', 'm.r.p', 'max retail price', 'mrp rate'],
};

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const num = (v) => {
  if (v === undefined || v === null || v === '') return 0;
  const n = parseFloat(String(v).replace(/[₹,\s%]/g, ''));
  return isNaN(n) ? 0 : n;
};
function normDate(v) {
  if (!v) return '';
  // Excel serial date number
  if (typeof v === 'number' && v > 20000 && v < 90000) {
    const d = XLSX.SSF ? XLSX.SSF.parse_date_code(v) : null;
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) { let [, d, mo, y] = m; if (y.length === 2) y = (Number(y) > 50 ? '19' : '20') + y; return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
  const dt = new Date(s);
  return isNaN(dt) ? '' : dt.toISOString().slice(0, 10);
}

function autoMap(headers) {
  const map = {};
  const used = new Set();
  for (const f of FIELDS) {
    const want = (SYN[f.key] || []).map(norm);
    const hit = headers.find((h) => want.includes(norm(h)) && !used.has(h));
    if (hit) { map[f.key] = hit; used.add(hit); }
  }
  return map;
}

/**
 * Upload → preview → automap → confirm importing purchase line items.
 * onImport(lines) receives an array of blankLine-shaped objects to append.
 */
export default function PurchaseImport({ items = [], onClose, onImport }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);        // array of objects keyed by header
  const [mapping, setMapping] = useState({});  // field -> header
  const [err, setErr] = useState('');

  const itemByName = useMemo(() => {
    const m = new Map();
    for (const it of items) { m.set(norm(it.name), it); if (it.sku) m.set(norm(it.sku), it); }
    return m;
  }, [items]);

  const handleFile = async (file) => {
    if (!file) return;
    setErr(''); setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
      if (!aoa.length) { setErr('The file appears to be empty.'); return; }
      const hdr = aoa[0].map((h) => String(h).trim()).filter((h) => h !== '');
      if (!hdr.length) { setErr('No column headers found in the first row.'); return; }
      const recs = aoa.slice(1).map((r) => {
        const o = {};
        hdr.forEach((h, i) => { o[h] = r[i] !== undefined ? r[i] : ''; });
        return o;
      }).filter((o) => Object.values(o).some((v) => String(v).trim() !== ''));
      setHeaders(hdr);
      setRows(recs);
      setMapping(autoMap(hdr));
      if (!recs.length) setErr('No data rows found under the header.');
    } catch (e) {
      setErr('Could not read the file. Please upload a valid .xlsx, .xls or .csv file.');
    }
  };

  const setMap = (field, header) => setMapping((m) => ({ ...m, [field]: header }));

  // Build the preview lines from current mapping.
  const buildLines = () => rows.map((rec) => {
    const g = (f) => (mapping[f] ? rec[mapping[f]] : '');
    const name = String(g('item_name') || '').trim();
    const matched = itemByName.get(norm(name));
    return {
      item_id: matched ? matched.id : '',
      item_name: matched ? matched.name : name,
      hsn: String(g('hsn') || (matched ? matched.hsn : '') || '').trim(),
      batch_id: '',
      batch_no: String(g('batch_no') || '').trim(),
      qty: num(g('qty')) || 1,
      price: num(g('price')) || (matched ? matched.purchase_price : 0),
      discount: num(g('discount')),
      gst_rate: mapping.gst_rate ? num(g('gst_rate')) : (matched ? matched.gst_rate : 0),
      mrp: num(g('mrp')),
      expiry_date: normDate(g('expiry_date')),
      _batches: [],
      _new: !matched && !!name, // product not found in master → will be quick-created on save? (flagged)
    };
  });

  const preview = useMemo(() => (rows.length ? buildLines() : []), [rows, mapping, items]);
  const validCount = preview.filter((l) => l.item_name && Number(l.qty) > 0).length;
  const newCount = preview.filter((l) => l._new).length;

  const doImport = () => {
    if (!mapping.item_name) { setErr('Please map the "Item / Product Name" column.'); return; }
    if (!mapping.qty) { setErr('Please map the "Quantity" column.'); return; }
    const lines = buildLines().filter((l) => l.item_name && Number(l.qty) > 0);
    if (!lines.length) { setErr('No valid rows to import (need a name and quantity).'); return; }
    onImport(lines);
    toast(`${lines.length} item(s) added from ${fileName}`);
  };

  const reset = () => { setHeaders([]); setRows([]); setMapping({}); setFileName(''); setErr(''); if (fileRef.current) fileRef.current.value = ''; };

  // Generate & download a ready-to-fill sample .xlsx with the expected headers
  // (plus two example rows the user can overwrite).
  const downloadTemplate = () => {
    const header = ['Item Name', 'HSN', 'Batch No', 'Expiry Date', 'Qty', 'Purchase Rate', 'Discount %', 'GST %', 'MRP'];
    const sample = [
      ['Parle-G Biscuit 100g', '1905', 'B-1001', '31/12/2027', 100, 8.5, 0, 18, 10],
      ['Tata Salt 1kg', '2501', '', '', 50, 18, 2, 5, 24],
    ];
    const ws = XLSX.utils.aoa_to_sheet([header, ...sample]);
    ws['!cols'] = [{ wch: 24 }, { wch: 10 }, { wch: 12 }, { wch: 13 }, { wch: 8 }, { wch: 13 }, { wch: 11 }, { wch: 8 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Purchase Items');
    XLSX.writeFile(wb, 'purchase-import-template.xlsx');
    toast('Sample template downloaded');
  };

  return (
    <Modal size="lg" title="Import Purchase Items from Excel" onClose={onClose}
      footer={<>
        <span className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>
          {rows.length ? `${validCount} of ${rows.length} row(s) ready${newCount ? ` · ${newCount} new product(s)` : ''}` : 'Upload an .xlsx, .xls or .csv file'}
        </span>
        {rows.length > 0 && <button className="btn" onClick={reset}>Choose Another File</button>}
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!rows.length} onClick={doImport}>Add {validCount || ''} Items</button>
      </>}>

      {err && <div className="alert alert-danger" style={{ marginBottom: 10 }}>{err}</div>}

      {!rows.length ? (
        <div style={{ textAlign: 'center', padding: '26px 10px' }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>📄</div>
          <p style={{ marginBottom: 14, color: 'var(--muted)' }}>
            Upload a purchase list. Columns like <b>Item</b>, <b>Qty</b>, <b>Rate</b>, <b>HSN</b>, <b>GST%</b>,
            <b> Batch</b>, <b>Expiry</b>, <b>MRP</b> are mapped automatically.
          </p>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
            onChange={(e) => handleFile(e.target.files && e.target.files[0])} />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => fileRef.current && fileRef.current.click()}>⬆ Choose Excel / CSV File</button>
            <button className="btn" onClick={downloadTemplate}>⬇ Download Sample Template</button>
          </div>
          <div style={{ marginTop: 16, fontSize: 12, color: 'var(--muted)' }}>
            First row must be the column headers. Supported: .xlsx, .xls, .csv
          </div>
        </div>
      ) : (
        <>
          {/* Mapping editor */}
          <div className="entry-sec" style={{ marginBottom: 6 }}>Column Mapping <span className="muted" style={{ fontWeight: 400 }}>· auto-detected, adjust if needed</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', marginBottom: 14 }}>
            {FIELDS.map((f) => (
              <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ minWidth: 150, fontSize: 13 }}>
                  {f.label}{f.required ? <span style={{ color: 'var(--accent)' }}> *</span> : ''}
                </label>
                <select className="fld" style={{ flex: 1 }} value={mapping[f.key] || ''} onChange={(e) => setMap(f.key, e.target.value)}>
                  <option value="">— not mapped —</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>

          {/* Preview */}
          <div className="entry-sec" style={{ marginBottom: 6 }}>Preview <span className="muted" style={{ fontWeight: 400 }}>· first {Math.min(8, preview.length)} of {preview.length} rows</span></div>
          <div className="table-wrap" style={{ maxHeight: 260, overflow: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Item</th><th>HSN</th><th>Batch</th><th>Expiry</th>
                <th className="text-right">Qty</th><th className="text-right">Rate</th>
                <th className="text-right">Disc%</th><th className="text-right">GST%</th><th className="text-right">MRP</th>
              </tr></thead>
              <tbody>
                {preview.slice(0, 8).map((l, i) => (
                  <tr key={i}>
                    <td>{l.item_name || <span className="muted">—</span>}{l._new && <span className="badge badge-warning" style={{ marginLeft: 6 }}>new</span>}</td>
                    <td>{l.hsn || '—'}</td>
                    <td>{l.batch_no || '—'}</td>
                    <td>{l.expiry_date || '—'}</td>
                    <td className="text-right num">{fmtNum(l.qty)}</td>
                    <td className="text-right num">{fmt(l.price)}</td>
                    <td className="text-right num">{l.discount || 0}</td>
                    <td className="text-right num">{l.gst_rate || 0}</td>
                    <td className="text-right num">{l.mrp ? fmt(l.mrp) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {newCount > 0 && (
            <div className="alert" style={{ background: '#fff7e6', border: '1px solid var(--border)', marginTop: 10, fontSize: 12.5 }}>
              ⚠ {newCount} product(s) are not in your Item master yet. They will be added as line items using the name/rate/GST from the file;
              new products get created automatically when you save the purchase.
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function fmtNum(n) { return (Number(n) || 0).toLocaleString('en-IN'); }
