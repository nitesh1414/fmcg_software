import { useEffect, useState } from 'react';
import { api } from '../api';
import Layout from '../Layout';
import LicenseForm from './LicenseForm';
import { Modal, productLabel } from '../components.jsx';

// Quick "generate license" flow: pick (or create) a client, then issue a key —
// a first (base) license or an add-on for the product they don't have yet.
export default function Generate() {
  const [clients, setClients] = useState([]);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(null);
  const [creating, setCreating] = useState(false);
  const [keyShow, setKeyShow] = useState(null);

  const load = () => api.get('/clients' + (q ? '?q=' + encodeURIComponent(q) : '')).then(setClients).catch(() => {});
  useEffect(() => { load(); }, [q]);

  return (
    <Layout title="Generate License" sub="Pick a client, then issue a base license or an add-on">
      <div className="card" style={{ maxWidth: 820 }}>
        <div className="card-head">Step 1 — Choose a client
          <button className="btn btn-sm btn-primary" onClick={() => setCreating(true)}>+ New Client</button></div>
        <div className="card-body">
          <input className="search" style={{ width: '100%', marginBottom: 12 }} placeholder="Search client…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div style={{ maxHeight: 420, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }} className="table-scroll">
            <table className="tbl">
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id}>
                    <td data-label="Client">
                      <span>
                        <b>{c.business_name}</b>
                        <span className="stack-sub">{[c.city, c.phone].filter(Boolean).join(' · ') || '—'}</span>
                        <span className="tags" style={{ marginTop: 4 }}>
                          {c.products?.length
                            ? c.products.map((p) => <span key={p} className="badge active">{productLabel(p)}</span>)
                            : <span className="badge none">No license yet</span>}
                        </span>
                      </span>
                    </td>
                    <td data-label="" className="actions-cell right">
                      <span className="actions"><button className="btn btn-sm btn-primary" onClick={() => setPicked(c)}>Select →</button></span>
                    </td>
                  </tr>
                ))}
                {clients.length === 0 && <tr><td data-label="" className="muted" style={{ padding: 16 }}>No clients found. Create one first.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            Step 2 lets you pick Desktop, Mobile or both. A client who already runs desktop can be sold the mobile app
            later — choose <b>Add-on</b> on their client screen and the new key can end on the same day.
          </p>
        </div>
      </div>

      {creating && <QuickClient onClose={() => setCreating(false)} onSaved={(c) => { setCreating(false); load(); setPicked(c); }} />}

      {picked && (
        <LicenseForm clientObj={picked}
          // nothing left to add → offer a renewal of their primary license
          mode={picked.missing_products?.length ? (picked.products?.length ? 'addon' : 'new') : 'renew'}
          renewOf={picked.license?.id} license={picked.license}
          parent={picked.licenses?.desktop || picked.licenses?.mobile || null}
          onClose={() => setPicked(null)}
          onDone={(lic) => { setPicked(null); load(); setKeyShow(lic); }} />
      )}

      {keyShow && <KeyModal keyStr={keyShow} onClose={() => setKeyShow(null)} />}
    </Layout>
  );
}

function QuickClient({ onClose, onSaved }) {
  const [f, setF] = useState({ business_name: '', contact_person: '', phone: '', city: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (!f.business_name.trim()) { setErr('Business name required'); return; }
    setBusy(true);
    try { const c = await api.post('/clients', f); onSaved(c); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="New Client" onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>Save &amp; Select</button>
      </>}>
      {err && <div className="err">{err}</div>}
      <div className="field"><label>Business Name *</label><input value={f.business_name} onChange={set('business_name')} autoFocus /></div>
      <div className="grid2">
        <div className="field"><label>Contact Person</label><input value={f.contact_person} onChange={set('contact_person')} /></div>
        <div className="field"><label>Phone</label><input value={f.phone} onChange={set('phone')} inputMode="tel" /></div>
      </div>
      <div className="field"><label>City</label><input value={f.city} onChange={set('city')} /></div>
    </Modal>
  );
}

function KeyModal({ keyStr, onClose }) {
  const list = (keyStr && keyStr.licenses) || (typeof keyStr === 'string' ? [{ license_key: keyStr, product: 'desktop' }] : [keyStr]);
  const [copied, setCopied] = useState('');
  const [err, setErr] = useState('');
  const copy = (key, id) => {
    if (!navigator.clipboard) { setErr('Clipboard not available here — select the key text and copy manually.'); return; }
    navigator.clipboard.writeText(key).then(() => { setCopied(id); setTimeout(() => setCopied(''), 1500); })
      .catch(() => setErr('Could not copy automatically — select the key text and copy manually.'));
  };
  const label = (p) => (p === 'mobile' ? 'Mobile app' : 'Desktop app');
  return (
    <Modal title="✓ License Generated — send to client" onClose={onClose}
      footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
        Desktop key → PC activation. Mobile key → phone activation. Same business, two keys.
      </p>
      {err && <div className="err">{err}</div>}
      {list.filter(Boolean).map((l, i) => (
        <div key={l.id || i} style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            {label(l.product)}{l.kind === 'addon' ? <span className="badge addon" style={{ marginLeft: 6 }}>Add-on</span> : null}
          </div>
          <div className="keybox">{l.license_key}</div>
          <button className="btn btn-sm btn-primary" style={{ marginTop: 6 }} onClick={() => copy(l.license_key, String(l.id || i))}>
            {copied === String(l.id || i) ? 'Copied!' : 'Copy ' + label(l.product) + ' key'}
          </button>
        </div>
      ))}
    </Modal>
  );
}
