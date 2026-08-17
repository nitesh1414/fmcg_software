import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import Layout from '../Layout';
import { Modal, StatusBadge } from '../components.jsx';
import LicenseForm from './LicenseForm';

export default function Clients() {
  const { user } = useAuth();
  const admin = user?.role === 'admin';
  const [sp] = useSearchParams();
  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);     // client being created/edited
  const [detail, setDetail] = useState(null);       // client detail/history
  const [licFor, setLicFor] = useState(null);       // { client, renewOf? }
  const [keyShow, setKeyShow] = useState(null);     // { key, id }

  const load = () => api.get('/clients' + (q ? '?q=' + encodeURIComponent(q) : '')).then(setList).catch(() => {});
  useEffect(() => { load(); }, [q]);

  // Deep link from dashboard ?focus=<id>
  useEffect(() => {
    const f = sp.get('focus');
    if (f) api.get('/clients/' + f).then(setDetail).catch(() => {});
  }, [sp]);

  const openDetail = (id) => api.get('/clients/' + id).then(setDetail);

  return (
    <Layout title={admin ? 'All Clients' : 'My Clients'} sub={`${list.length} client(s)`}
      actions={<>
        <input className="search" placeholder="Search name / phone / city…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn-primary" onClick={() => setEditing({})}>+ New Client</button>
      </>}>
      <div className="card">
        <div className="card-body" style={{ padding: 0 }}>
          <table className="tbl">
            <thead><tr>
              <th>Business</th><th>Contact</th><th>City</th>
              {admin && <th>Salesperson</th>}
              <th>Created</th><th>Expiry</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(c.id)}>
                  <td><b>{c.business_name}</b>{c.gstin ? <div className="muted mono" style={{ fontSize: 11 }}>{c.gstin}</div> : null}</td>
                  <td>{c.contact_person || '—'}<div className="muted" style={{ fontSize: 12 }}>{c.phone}</div></td>
                  <td>{c.city || '—'}</td>
                  {admin && <td>{c.salesperson}</td>}
                  <td className="muted" style={{ fontSize: 13 }}>{(c.created_at || '').slice(0, 10)}</td>
                  <td>{c.license?.expires || (c.license ? 'Lifetime' : '—')}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td className="right" onClick={(e) => e.stopPropagation()}>
                    {c.license
                      ? <button className="btn btn-sm btn-primary" onClick={() => setLicFor({ client: c, renewOf: c.license.id })}>Renew</button>
                      : <button className="btn btn-sm btn-primary" onClick={() => setLicFor({ client: c })}>Generate</button>}
                  </td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={admin ? 8 : 7} className="muted" style={{ padding: 18 }}>No clients yet. Click “New Client”.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {editing && <ClientForm client={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}

      {detail && (
        <ClientDetail client={detail} admin={admin}
          onClose={() => setDetail(null)}
          onGenerate={() => { setLicFor({ client: detail }); }}
          onRenew={(licId) => { setLicFor({ client: detail, renewOf: licId }); }}
          onShowKey={(k, id) => setKeyShow({ key: k, id })}
          reload={() => openDetail(detail.id)}
        />
      )}

      {licFor && (
        <LicenseForm clientObj={licFor.client} renewOf={licFor.renewOf}
          onClose={() => setLicFor(null)}
          onDone={(lic) => { setLicFor(null); load(); if (detail) openDetail(detail.id); setKeyShow({ key: lic.license_key, id: lic.id }); }} />
      )}

      {keyShow && <KeyModal data={keyShow} onClose={() => setKeyShow(null)} />}
    </Layout>
  );
}

function ClientForm({ client, onClose, onSaved }) {
  const [f, setF] = useState({
    business_name: client.business_name || '', contact_person: client.contact_person || '',
    phone: client.phone || '', email: client.email || '', city: client.city || '',
    gstin: client.gstin || '', notes: client.notes || '',
  });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (!f.business_name.trim()) { setErr('Business name is required'); return; }
    setBusy(true);
    try { if (client.id) await api.put('/clients/' + client.id, f); else await api.post('/clients', f); onSaved(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={client.id ? 'Edit Client' : 'New Client'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      {err && <div className="err">{err}</div>}
      <div className="field"><label>Business Name *</label><input value={f.business_name} onChange={set('business_name')} autoFocus /></div>
      <div className="grid2">
        <div className="field"><label>Contact Person</label><input value={f.contact_person} onChange={set('contact_person')} /></div>
        <div className="field"><label>Phone</label><input value={f.phone} onChange={set('phone')} /></div>
        <div className="field"><label>City</label><input value={f.city} onChange={set('city')} /></div>
        <div className="field"><label>Email</label><input value={f.email} onChange={set('email')} /></div>
      </div>
      <div className="field"><label>GSTIN</label><input value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} /></div>
      <div className="field"><label>Notes</label><textarea rows={2} value={f.notes} onChange={set('notes')} /></div>
    </Modal>
  );
}

function ClientDetail({ client, admin, onClose, onGenerate, onRenew, onShowKey, reload }) {
  const cur = client.license;
  const revoke = async (id) => { if (!confirm('Revoke this license?')) return; await api.post('/licenses/' + id + '/revoke'); reload(); };
  const copyKey = async (id) => { const r = await api.get('/licenses/' + id + '/key'); onShowKey(r.license_key, id); };
  const transfer = async (id) => {
    if (!confirm('Reset activation so this key can be activated on a NEW computer?\n\nThe current device will stop working with this key.')) return;
    await api.post('/licenses/' + id + '/reset-activation'); reload();
  };
  return (
    <Modal title={client.business_name} wide onClose={onClose}
      footer={<>
        {cur ? <button className="btn btn-primary" onClick={() => onRenew(cur.id)}>Renew License</button>
             : <button className="btn btn-primary" onClick={onGenerate}>Generate License</button>}
        <button className="btn" onClick={onClose}>Close</button>
      </>}>
      <div className="row" style={{ gap: 20, marginBottom: 14 }}>
        <div><div className="muted" style={{ fontSize: 12 }}>Contact</div>{client.contact_person || '—'} · {client.phone || '—'}</div>
        <div><div className="muted" style={{ fontSize: 12 }}>City</div>{client.city || '—'}</div>
        {admin && <div><div className="muted" style={{ fontSize: 12 }}>Salesperson</div><b>{client.salesperson}</b></div>}
        <div><div className="muted" style={{ fontSize: 12 }}>Current status</div><StatusBadge status={client.status} /></div>
      </div>
      <div className="card-head" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>License History</div>
      <table className="tbl">
        <thead><tr><th>License ID</th><th>Plan</th><th>Issued</th><th>Expires</th><th>Activation</th><th>By</th><th>State</th><th></th></tr></thead>
        <tbody>
          {(client.history || []).map((l) => (
            <tr key={l.id}>
              <td className="mono">{l.license_id}{l.carried_days > 0 ? <div className="muted" style={{ fontSize: 11 }}>+{l.carried_days}d carried</div> : null}</td>
              <td>{l.plan}</td><td>{l.issued}</td>
              <td>{l.perpetual ? 'Lifetime' : l.expires}</td>
              <td>
                {l.activated_machine
                  ? <span className="badge active" title={'Activated on ' + (l.activated_at || '')}>🔒 Activated</span>
                  : <span className="badge none">Not activated</span>}
                {l.activated_machine ? <div className="muted mono" style={{ fontSize: 10 }}>{l.activated_machine}</div> : null}
              </td>
              <td className="muted">{l.created_by_name || ''}</td>
              <td><span className={'badge ' + (l.status === 'active' ? 'active' : l.status === 'revoked' ? 'revoked' : 'none')}>{l.status}</span></td>
              <td className="right actions">
                <button className="btn btn-sm" onClick={() => copyKey(l.id)}>Key</button>
                {l.status === 'active' && l.activated_machine && <button className="btn btn-sm" onClick={() => transfer(l.id)}>Transfer</button>}
                {admin && l.status === 'active' && <button className="btn btn-sm btn-danger" onClick={() => revoke(l.id)}>Revoke</button>}
              </td>
            </tr>
          ))}
          {(!client.history || client.history.length === 0) && <tr><td colSpan="8" className="muted">No licenses yet.</td></tr>}
        </tbody>
      </table>
    </Modal>
  );
}

function KeyModal({ data, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard.writeText(data.key).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  return (
    <Modal title="License Key — send this to the client" onClose={onClose}
      footer={<><button className="btn btn-primary" onClick={copy}>{copied ? 'Copied!' : 'Copy Key'}</button><button className="btn" onClick={onClose}>Close</button></>}>
      <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
        The client pastes this into RightServe → Activation screen (or License → Enter Key).
      </p>
      <div className="keybox">{data.key}</div>
    </Modal>
  );
}
