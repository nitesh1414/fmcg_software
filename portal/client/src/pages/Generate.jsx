import { useEffect, useState } from 'react';
import { api } from '../api';
import Layout from '../Layout';
import LicenseForm from './LicenseForm';
import { Modal } from '../components.jsx';

// Quick "generate license" flow: pick (or create) a client, then issue a key.
export default function Generate() {
  const [clients, setClients] = useState([]);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(null);
  const [creating, setCreating] = useState(false);
  const [keyShow, setKeyShow] = useState(null);

  const load = () => api.get('/clients' + (q ? '?q=' + encodeURIComponent(q) : '')).then(setClients).catch(() => {});
  useEffect(() => { load(); }, [q]);

  return (
    <Layout title="Generate License" sub="Pick a client and issue a license key">
      <div className="card" style={{ maxWidth: 720 }}>
        <div className="card-head">Step 1 — Choose a client
          <button className="btn btn-sm btn-primary" onClick={() => setCreating(true)}>+ New Client</button></div>
        <div className="card-body">
          <input className="search" style={{ width: '100%', marginBottom: 12 }} placeholder="Search client…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            <table className="tbl">
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id}>
                    <td><b>{c.business_name}</b><div className="muted" style={{ fontSize: 12 }}>{c.city} · {c.phone}</div></td>
                    <td className="right"><button className="btn btn-sm btn-primary" onClick={() => setPicked(c)}>Select →</button></td>
                  </tr>
                ))}
                {clients.length === 0 && <tr><td className="muted" style={{ padding: 16 }}>No clients found. Create one first.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {creating && <QuickClient onClose={() => setCreating(false)} onSaved={(c) => { setCreating(false); load(); setPicked(c); }} />}

      {picked && (
        <LicenseForm clientObj={picked} onClose={() => setPicked(null)}
          onDone={(lic) => { setPicked(null); setKeyShow(lic.license_key); }} />
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
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>Save &amp; Select</button></>}>
      {err && <div className="err">{err}</div>}
      <div className="field"><label>Business Name *</label><input value={f.business_name} onChange={set('business_name')} autoFocus /></div>
      <div className="grid2">
        <div className="field"><label>Contact Person</label><input value={f.contact_person} onChange={set('contact_person')} /></div>
        <div className="field"><label>Phone</label><input value={f.phone} onChange={set('phone')} /></div>
      </div>
      <div className="field"><label>City</label><input value={f.city} onChange={set('city')} /></div>
    </Modal>
  );
}

function KeyModal({ keyStr, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard.writeText(keyStr).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  return (
    <Modal title="✓ License Generated — send to client" onClose={onClose}
      footer={<><button className="btn btn-primary" onClick={copy}>{copied ? 'Copied!' : 'Copy Key'}</button><button className="btn" onClick={onClose}>Done</button></>}>
      <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>Client pastes this into RightServe activation screen.</p>
      <div className="keybox">{keyStr}</div>
    </Modal>
  );
}
