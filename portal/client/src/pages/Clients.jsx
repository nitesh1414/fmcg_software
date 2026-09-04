import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import Layout from '../Layout';
import { Modal, StatusBadge, Confirm, ProductTag, productLabel, expiryText } from '../components.jsx';
import LicenseForm from './LicenseForm';

export default function Clients() {
  const { user } = useAuth();
  const admin = user?.role === 'admin';
  const [sp] = useSearchParams();
  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);     // client being created/edited
  const [detail, setDetail] = useState(null);       // client detail/history
  const [licFor, setLicFor] = useState(null);       // { client, mode, renewOf?, license?, parent? }
  const [keyShow, setKeyShow] = useState(null);     // { licenses: [...] }
  const [delClient, setDelClient] = useState(null); // client pending delete

  const load = () => api.get('/clients' + (q ? '?q=' + encodeURIComponent(q) : '')).then(setList).catch(() => {});
  useEffect(() => { load(); }, [q]);

  // Deep link from the dashboard: ?focus=<id> opens the client, and
  // ?focus=<id>&add=mobile jumps straight into that product's add-on form.
  useEffect(() => {
    const f = sp.get('focus');
    if (!f) return;
    api.get('/clients/' + f).then((c) => {
      setDetail(c);
      const add = sp.get('add');
      const owned = c.products || [];
      if ((add === 'desktop' || add === 'mobile') && !owned.includes(add)) {
        setLicFor({
          client: c,
          mode: owned.length ? 'addon' : 'new',
          forceProduct: add,
          parent: c.licenses?.desktop || c.licenses?.mobile || null,
        });
      }
    }).catch(() => {});
  }, [sp]);

  const openDetail = (id) => api.get('/clients/' + id).then(setDetail).catch(() => {});
  const refreshAll = () => { load(); if (detail) openDetail(detail.id); };

  const showKeys = (licenses) => setKeyShow({ licenses: (licenses || []).filter(Boolean) });

  return (
    <Layout title={admin ? 'All Clients' : 'My Clients'} sub={`${list.length} client(s)`}
      actions={<>
        <input className="search" placeholder="Search name / phone / city…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn-primary" onClick={() => setEditing({})}>+ New Client</button>
      </>}>
      <div className="card">
        <div className="card-body" style={{ padding: 0 }}>
          <div className="table-scroll">
            <table className="tbl">
              <thead><tr>
                <th>Business</th><th>Products</th><th>Contact</th><th>City</th>
                {admin && <th>Salesperson</th>}
                <th>Expiry</th><th>Status</th><th></th>
              </tr></thead>
              <tbody>
                {list.map((c) => {
                  const missing = c.missing_products || [];
                  return (
                    <tr key={c.id}>
                      <td data-label="Business" onClick={() => openDetail(c.id)} style={{ cursor: 'pointer' }}>
                        <span>
                          <b>{c.business_name}</b>
                          {c.gstin ? <span className="stack-sub mono">{c.gstin}</span> : null}
                          <span className="stack-sub">Added {(c.created_at || '').slice(0, 10)}</span>
                        </span>
                      </td>
                      <td data-label="Products" onClick={() => openDetail(c.id)} style={{ cursor: 'pointer' }}>
                        <span className="tags">
                          {c.products?.length
                            ? c.products.map((p) => (
                              <span key={p} className="badge active">
                                {productLabel(p)}{c.licenses?.[p]?.kind === 'addon' ? ' +' : ''}
                              </span>
                            ))
                            : <span className="badge none">No license</span>}
                        </span>
                      </td>
                      <td data-label="Contact">{c.contact_person || '—'}{c.phone ? <span className="stack-sub">{c.phone}</span> : null}</td>
                      <td data-label="City">{c.city || '—'}</td>
                      {admin && <td data-label="Sales">{c.salesperson}</td>}
                      <td data-label="Expiry">{expiryText(c.license)}</td>
                      <td data-label="Status"><StatusBadge status={c.status} /></td>
                      <td data-label="" className="actions-cell">
                        <span className="actions">
                          {missing.length > 0 && (
                            <button className="btn btn-sm" onClick={() => setLicFor({
                              client: c, mode: 'addon',
                              parent: c.licenses?.desktop || c.licenses?.mobile || null,
                            })}>+ {productLabel(missing[0])}</button>
                          )}
                          {c.license
                            ? <button className="btn btn-sm btn-primary" onClick={() => setLicFor({ client: c, mode: 'renew', renewOf: c.license.id, license: c.license })}>Renew</button>
                            : <button className="btn btn-sm btn-primary" onClick={() => setLicFor({ client: c, mode: 'new' })}>Generate</button>}
                          <button className="btn btn-sm" onClick={() => setEditing(c)} aria-label={'Edit ' + c.business_name}>Edit</button>
                          <button className="btn btn-sm btn-danger" onClick={() => setDelClient(c)} aria-label={'Delete ' + c.business_name}>Delete</button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {list.length === 0 && <tr><td data-label="" colSpan={admin ? 8 : 7} className="muted" style={{ padding: 18 }}>No clients yet. Click “New Client”.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {editing && (
        <ClientForm client={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refreshAll(); }} />
      )}

      {detail && (
        <ClientDetail client={detail} admin={admin}
          onClose={() => setDetail(null)}
          onEdit={() => setEditing(detail)}
          onDelete={() => setDelClient(detail)}
          onLicense={(opts) => setLicFor({ client: detail, ...opts })}
          onShowKeys={showKeys}
          reload={() => openDetail(detail.id)}
          onReloadList={load}
        />
      )}

      {licFor && (
        <LicenseForm clientObj={licFor.client} mode={licFor.mode} renewOf={licFor.renewOf}
          license={licFor.license} parent={licFor.parent}
          forceProduct={licFor.forceProduct}
          onClose={() => setLicFor(null)}
          onDone={(out) => {
            setLicFor(null);
            refreshAll();
            if (out.reissued === false) return;                 // notes-only edit — no new key
            showKeys(out.licenses || [out]);
          }} />
      )}

      {keyShow && <KeyModal data={keyShow} onClose={() => setKeyShow(null)} />}

      {delClient && (
        <DeleteClient client={delClient} admin={admin}
          onClose={() => setDelClient(null)}
          onDone={() => { setDelClient(null); if (detail?.id === delClient.id) setDetail(null); load(); }} />
      )}
    </Layout>
  );
}

/* ---------------- client create / edit ---------------- */
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
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </>}>
      {err && <div className="err">{err}</div>}
      <div className="field"><label>Business Name *</label><input value={f.business_name} onChange={set('business_name')} autoFocus /></div>
      <div className="grid2">
        <div className="field"><label>Contact Person</label><input value={f.contact_person} onChange={set('contact_person')} /></div>
        <div className="field"><label>Phone</label><input value={f.phone} onChange={set('phone')} inputMode="tel" /></div>
        <div className="field"><label>City</label><input value={f.city} onChange={set('city')} /></div>
        <div className="field"><label>Email</label><input value={f.email} onChange={set('email')} inputMode="email" /></div>
      </div>
      <div className="field"><label>GSTIN</label><input value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} /></div>
      <div className="field"><label>Notes</label><textarea rows={2} value={f.notes} onChange={set('notes')} /></div>
    </Modal>
  );
}

/* ---------------- client delete (with confirm) ---------------- */
function DeleteClient({ client, admin, onClose, onDone }) {
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const n = client.license_count ?? (client.history?.length || 0);

  const run = async () => {
    setBusy(true); setErr('');
    try { await api.del('/clients/' + client.id + (force ? '?force=1' : '')); onDone(); }
    catch (e) {
      if (e.status === 409 && e.data?.code === 'HAS_LICENSES') { setForce(true); setErr(e.message); }
      else setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <Confirm danger busy={busy} onClose={onClose} onConfirm={run} confirmLabel={force ? 'Delete client & licenses' : 'Delete client'}
      title={'Delete ' + client.business_name + '?'}
      message={n > 0
        ? `This removes the client and ${n} license(s). Any device already activated with those keys will lose access.\n\nThis cannot be undone.`
        : 'This removes the client record. This cannot be undone.'}
      extra={<>
        {err && <div className="err" style={{ marginTop: 12 }}>{err}</div>}
        {!admin && n > 0 && <div className="info-box" style={{ marginTop: 12 }}>Only an admin can delete a client that already has licenses.</div>}
      </>} />
  );
}

/* ---------------- client detail: licenses per product + history ---------------- */
function ClientDetail({ client, admin, onClose, onEdit, onDelete, onLicense, onShowKeys, reload, onReloadList }) {
  const [confirmLic, setConfirmLic] = useState(null);   // license pending delete
  const [transferFor, setTransferFor] = useState(null); // license pending device transfer
  const [busyId, setBusyId] = useState('');
  const licenses = client.licenses || {};
  const missing = client.missing_products || [];
  const history = useMemo(() => client.history || [], [client.history]);

  const after = () => { reload(); onReloadList(); };

  const copyKey = async (id) => {
    const r = await api.get('/licenses/' + id + '/key');
    const row = history.find((x) => x.id === id) || {};
    onShowKeys([{ license_key: r.license_key, id, product: row.product, license_id: r.license_id }]);
  };
  const transfer = async () => {
    setBusyId('t' + transferFor.id);
    try {
      await api.post('/licenses/' + transferFor.id + '/reset-activation');
      setTransferFor(null); after();
    } catch (e) { setTransferFor({ ...transferFor, err: e.message }); } finally { setBusyId(''); }
  };
  const revoke = async (id) => {
    setBusyId('r' + id);
    try { await api.post('/licenses/' + id + '/revoke'); after(); } finally { setBusyId(''); }
  };
  const restore = async (id) => {
    setBusyId('s' + id);
    try { await api.post('/licenses/' + id + '/restore'); after(); } finally { setBusyId(''); }
  };
  const del = async () => {
    setBusyId('d' + confirmLic.id);
    try {
      await api.del('/licenses/' + confirmLic.id + (confirmLic.activated_machine ? '?force=1' : ''));
      setConfirmLic(null); after();
    } catch (e) {
      if (e.status === 409 && e.data?.code === 'ACTIVATED') setConfirmLic({ ...confirmLic, force: true, err: e.message });
      else setConfirmLic({ ...confirmLic, err: e.message });
    } finally { setBusyId(''); }
  };

  const liveCard = (p) => {
    const l = licenses[p];
    return (
      <div className="card" key={p} style={{ marginBottom: 12 }}>
        <div className="card-head">
          <span><ProductTag product={p} kind={l?.kind} /> {l ? <span className="muted mono" style={{ fontSize: 12, marginLeft: 8 }}>{l.license_id}</span> : null}</span>
          {l
            ? <StatusBadge status={l.computed} />
            : <span className="badge none">Not licensed</span>}
        </div>
        <div className="card-body">
          {l ? (
            <>
              <div className="row" style={{ gap: 18, marginBottom: 12 }}>
                <div><div className="muted" style={{ fontSize: 12 }}>Expires</div><b>{expiryText(l)}</b></div>
                <div><div className="muted" style={{ fontSize: 12 }}>Plan</div>{l.plan}</div>
                <div><div className="muted" style={{ fontSize: 12 }}>Activation</div>
                  {l.activated_machine
                    ? <span className="mono" style={{ fontSize: 12 }}>{l.activated_machine}</span>
                    : <span className="muted">not activated yet</span>}
                </div>
              </div>
              <div className="actions left">
                <button className="btn btn-sm btn-primary" onClick={() => onLicense({ mode: 'renew', renewOf: l.id, license: l })}>Renew</button>
                <button className="btn btn-sm" onClick={() => onLicense({ mode: 'edit', license: l })}>Edit</button>
                <button className="btn btn-sm" onClick={() => copyKey(l.id)}>Key</button>
                {l.activated_machine && <button className="btn btn-sm" disabled={busyId === 't' + l.id} onClick={() => setTransferFor(l)}>Transfer device</button>}
                {l.status !== 'revoked'
                  ? (admin && <button className="btn btn-sm btn-danger" disabled={busyId === 'r' + l.id} onClick={() => revoke(l.id)}>Revoke</button>)
                  : (admin && <button className="btn btn-sm" disabled={busyId === 's' + l.id} onClick={() => restore(l.id)}>Restore</button>)}
                <button className="btn btn-sm btn-danger" onClick={() => setConfirmLic(l)}>Delete</button>
              </div>
            </>
          ) : (
            <>
              <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
                No {productLabel(p).toLowerCase()} key yet. {missing.length === 1 && (client.products || []).length === 1
                  ? 'Sell it as an add-on — it can end on the same day as the existing license.'
                  : 'Issue one whenever the client is ready.'}
              </p>
              <div className="actions left">
                {(client.products || []).length > 0
                  ? <button className="btn btn-sm btn-primary" onClick={() => onLicense({ mode: 'addon', parent: licenses.desktop || licenses.mobile })}>Add {productLabel(p)} add-on</button>
                  : <button className="btn btn-sm btn-primary" onClick={() => onLicense({ mode: 'new' })}>Generate {productLabel(p)} license</button>}
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <Modal title={client.business_name} wide onClose={onClose}
      footer={<>
        <button className="btn" onClick={onEdit}>Edit client</button>
        <button className="btn btn-danger" onClick={onDelete}>Delete client</button>
        <button className="btn btn-primary" onClick={() => onLicense(missing.length ? { mode: 'addon', parent: licenses.desktop || licenses.mobile } : { mode: 'new' })}>
          {missing.length ? `+ Add ${productLabel(missing[0])} add-on` : 'New License'}
        </button>
      </>}>
      <div className="row" style={{ gap: 20, marginBottom: 14 }}>
        <div><div className="muted" style={{ fontSize: 12 }}>Contact</div>{client.contact_person || '—'} · {client.phone || '—'}</div>
        <div><div className="muted" style={{ fontSize: 12 }}>City</div>{client.city || '—'}</div>
        {admin && <div><div className="muted" style={{ fontSize: 12 }}>Salesperson</div><b>{client.salesperson}</b></div>}
      </div>

      <div className="card-head" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>Licenses by product</div>
      <div style={{ paddingTop: 12 }}>
        {['desktop', 'mobile'].map(liveCard)}
      </div>

      <div className="card-head" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
        License history <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{history.length} record(s)</span>
      </div>
      <div className="table-scroll">
        <table className="tbl">
          <thead><tr><th>License</th><th>Product</th><th>Term</th><th>Activation</th><th>By</th><th>State</th><th></th></tr></thead>
          <tbody>
            {history.map((l) => (
              <tr key={l.id}>
                <td data-label="License">
                  <span>
                    <span className="mono">{l.license_id}</span>
                    {l.kind === 'addon' ? <span className="stack-sub">add-on{l.parent_license_id ? ` of ${l.parent_license_id}` : ''}</span> : <span className="stack-sub">base license</span>}
                    {l.carried_days > 0 ? <span className="stack-sub">+{l.carried_days}d carried</span> : null}
                    {l.key_updated_at ? <span className="stack-sub">key re-issued {(l.key_updated_at || '').slice(0, 10)}</span> : null}
                  </span>
                </td>
                <td data-label="Product"><ProductTag product={l.product} /></td>
                <td data-label="Term">
                  <span>
                    {l.plan}
                    <span className="stack-sub">{l.perpetual ? 'Lifetime' : `${l.issued} → ${l.expires}`}</span>
                  </span>
                </td>
                <td data-label="Activation">
                  {l.activated_machine
                    ? <span><span className="badge active">🔒 Activated</span><span className="stack-sub mono" style={{ fontSize: 10 }}>{l.activated_machine}</span></span>
                    : <span className="badge none">Not activated</span>}
                </td>
                <td data-label="By" className="muted">{l.created_by_name || '—'}</td>
                <td data-label="State">
                  <span className={'badge ' + (l.status === 'active' ? 'active' : l.status === 'revoked' ? 'revoked' : 'none')}>{l.status}</span>
                </td>
                <td data-label="" className="actions-cell">
                  <span className="actions">
                    <button className="btn btn-sm" onClick={() => copyKey(l.id)}>Key</button>
                    {l.status === 'active' && (
                      <>
                        <button className="btn btn-sm" onClick={() => onLicense({ mode: 'renew', renewOf: l.id, license: l })}>Renew</button>
                        <button className="btn btn-sm" onClick={() => onLicense({ mode: 'edit', license: l })}>Edit</button>
                        {l.activated_machine && <button className="btn btn-sm" disabled={busyId === 't' + l.id} onClick={() => setTransferFor(l)}>Transfer</button>}
                        {admin && <button className="btn btn-sm btn-danger" disabled={busyId === 'r' + l.id} onClick={() => revoke(l.id)}>Revoke</button>}
                        <button className="btn btn-sm btn-danger" onClick={() => setConfirmLic(l)}>Delete</button>
                      </>
                    )}
                    {l.status === 'revoked' && admin && (
                      <button className="btn btn-sm" disabled={busyId === 's' + l.id} onClick={() => restore(l.id)}>Restore</button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
            {history.length === 0 && <tr><td data-label="" colSpan="7" className="muted">No licenses yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {transferFor && (
        <Confirm danger busy={busyId === 't' + transferFor.id} confirmLabel="Reset activation"
          title={'Transfer ' + transferFor.license_id + '?'}
          message={`This frees the key so it can be activated on a NEW device.\n\nThe device it is bound to now (${transferFor.activated_machine || '—'}) will stop working until it is re-activated.`}
          onClose={() => setTransferFor(null)} onConfirm={transfer}
          extra={transferFor.err ? <div className="err" style={{ marginTop: 12 }}>{transferFor.err}</div> : null} />
      )}

      {confirmLic && (
        <Confirm danger busy={busyId === 'd' + confirmLic.id} confirmLabel="Delete license"
          title={'Delete ' + confirmLic.license_id + '?'}
          message={confirmLic.activated_machine
            ? `This key is activated on ${confirmLic.activated_machine}. Deleting it means that device loses access.\n\nThis cannot be undone.`
            : 'This removes the license record and its key. This cannot be undone.'}
          onClose={() => setConfirmLic(null)} onConfirm={del}
          extra={confirmLic.err ? <div className="err" style={{ marginTop: 12 }}>{confirmLic.err}</div> : null} />
      )}
    </Modal>
  );
}

/* ---------------- show / copy the key(s) ---------------- */
function KeyModal({ data, onClose }) {
  const list = data.licenses || (data.key ? [{ license_key: data.key, product: 'desktop' }] : []);
  const [copied, setCopied] = useState('');
  const [err, setErr] = useState('');
  const copy = (key, id) => {
    if (!navigator.clipboard) { setErr('Clipboard not available in this browser — select the key text and copy manually.'); return; }
    navigator.clipboard.writeText(key).then(() => { setCopied(id); setTimeout(() => setCopied(''), 1500); })
      .catch(() => setErr('Could not copy automatically — select the key text and copy manually.'));
  };
  const label = (p) => (p === 'mobile' ? 'Mobile app' : 'Desktop app');
  return (
    <Modal title="License Key — send this to the client" onClose={onClose}
      footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
        Desktop key → RightServe PC activation. Mobile key → phone app activation. They are not interchangeable.
      </p>
      {err && <div className="err">{err}</div>}
      {list.map((l, i) => (
        <div key={l.id || i} style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            {label(l.product)}{l.license_id ? <span className="muted mono" style={{ fontWeight: 400 }}> · {l.license_id}</span> : null}
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
