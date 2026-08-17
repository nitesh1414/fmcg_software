import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getToken } from '../api/client';
import { useToast } from '../components/ui';
import { useScreenSetup } from '../components/TallyFrame';
import { useHotkeys } from '../keyboard';

const ENTITIES = [
  { id: 'items', label: 'Items / Products (with stock & batches)' },
  { id: 'parties', label: 'Parties (Customers & Suppliers)' },
];

const FIELD_LABELS = {
  name: 'Name', sku: 'SKU/Code', category: 'Category', unit: 'Unit', hsn: 'HSN',
  gst_rate: 'GST Rate', purchase_price: 'Purchase Price', sale_price: 'Sale Price',
  opening_stock: 'Opening Stock', low_stock_alert: 'Low Stock', batch_no: 'Batch/Serial',
  expiry_date: 'Expiry Date', type: 'Type', phone: 'Phone', email: 'Email',
  gstin: 'GSTIN', address: 'Address', state: 'State', opening_balance: 'Opening Balance',
};

export default function Migrate() {
  const toast = useToast();
  const nav = useNavigate();
  const [entity, setEntity] = useState('items');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [dupMode, setDupMode] = useState('skip');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useScreenSetup({
    title: 'Data Migration / Import', sub: 'Bring data in from Marg ERP, Vyapar, Tally or any CSV/Excel export',
    buttons: [
      { label: 'Esc', text: 'Dashboard', key: 'escape', onClick: () => nav('/') },
    ],
  }, [nav]);
  useHotkeys({ escape: () => nav('/') }, [nav]);

  const onFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    const text = await file.text();
    setCsv(text);
    setPreview(null); setResult(null);
  };

  const doPreview = async (text) => {
    const data = text ?? csv;
    if (!data.trim()) return toast('Paste CSV or choose a file first');
    setBusy(true);
    try {
      const p = await api.post('/migrate/preview', { csv: data, entity });
      setPreview(p);
      setMapping(p.mapping || {});
      setResult(null);
    } catch (err) { toast(err.message); } finally { setBusy(false); }
  };

  const doCommit = async () => {
    setBusy(true);
    try {
      const r = await api.post('/migrate/commit', { csv, entity, mapping, duplicateMode: dupMode });
      setResult(r);
      toast(`Imported: ${r.inserted} new, ${r.updated} updated, ${r.skipped} skipped`);
    } catch (err) { toast(err.message); } finally { setBusy(false); }
  };

  const downloadTemplate = () => {
    const token = getToken();
    fetch('/api/migrate/template/' + entity, { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => r.blob()).then((b) => {
        const url = URL.createObjectURL(b);
        const a = document.createElement('a'); a.href = url; a.download = entity + '-template.csv';
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
  };

  return (
    <div className="entry" style={{ maxWidth: 1000 }}>
      <div className="alert" style={{ background: '#eaf2ff', color: 'var(--navy)', border: '1px solid var(--border)' }}>
        <b>How it works:</b> Export your data from <b>Marg / Vyapar / Tally</b> (or any software) as a <b>CSV / Excel (.csv)</b> file →
        choose what you're importing → upload → we auto-detect the columns → review → Import.
        Column names are matched automatically (you can fix any mapping before importing).
      </div>

      <div className="entry-sec">1 · What are you importing?</div>
      <div className="row" style={{ gap: 8, marginBottom: 6 }}>
        {ENTITIES.map((en) => (
          <button key={en.id} className={'btn ' + (entity === en.id ? 'btn-primary' : '')}
            onClick={() => { setEntity(en.id); setPreview(null); setResult(null); }}>{en.label}</button>
        ))}
        <span className="spacer" />
        <button className="btn" onClick={downloadTemplate}>⬇ Download sample template</button>
      </div>

      <div className="entry-sec" style={{ marginTop: 12 }}>2 · Upload file or paste CSV</div>
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        <input type="file" accept=".csv,text/csv,.txt" onChange={onFile} />
        {fileName && <span className="muted">{fileName}</span>}
      </div>
      <textarea className="fld" rows={5} placeholder="…or paste CSV text here (first row = column headers)"
        value={csv} onChange={(e) => setCsv(e.target.value)} style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 12 }} />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn btn-primary" disabled={busy} onClick={() => doPreview()}>Preview & Auto-map →</button>
      </div>

      {preview && (
        <>
          <div className="entry-sec" style={{ marginTop: 16 }}>3 · Review column mapping ({preview.totalRows} rows)</div>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Field in RightServe</th><th>Mapped from your file column</th></tr></thead>
              <tbody>
                {preview.fields.map((f) => (
                  <tr key={f}>
                    <td><b>{FIELD_LABELS[f] || f}</b></td>
                    <td>
                      <select className="fld" value={mapping[f] || ''} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value })}>
                        <option value="">— not imported —</option>
                        {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="entry-sec" style={{ marginTop: 14 }}>Preview (first {preview.sample.length} rows)</div>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr>{preview.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {preview.sample.map((row, i) => (
                  <tr key={i}>{preview.headers.map((h) => <td key={h}>{row[h]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row" style={{ marginTop: 12, gap: 10, alignItems: 'center' }}>
            <span className="muted">If a record already exists:</span>
            <select className="fld" style={{ width: 200 }} value={dupMode} onChange={(e) => setDupMode(e.target.value)}>
              <option value="skip">Skip duplicates</option>
              <option value="update">Update existing</option>
            </select>
            <span className="spacer" />
            <button className="btn btn-primary" disabled={busy || !mapping.name} onClick={doCommit}>
              {busy ? 'Importing…' : `Import ${preview.totalRows} ${entity}`}
            </button>
          </div>
          {!mapping.name && <div className="muted" style={{ marginTop: 6, color: 'var(--accent)' }}>⚠ "Name" must be mapped to import.</div>}
        </>
      )}

      {result && (
        <div className="totbox" style={{ marginTop: 16 }}>
          <div className="entry-sec" style={{ marginTop: 0 }}>✅ Import complete</div>
          <div className="totrow"><span>New records added</span><b>{result.inserted}</b></div>
          <div className="totrow"><span>Existing updated</span><b>{result.updated}</b></div>
          <div className="totrow"><span>Skipped</span><b>{result.skipped}</b></div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => nav(entity === 'items' ? '/items' : '/parties')}>View imported {entity} →</button>
          </div>
        </div>
      )}
    </div>
  );
}
