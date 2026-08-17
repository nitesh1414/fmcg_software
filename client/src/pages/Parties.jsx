import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { Modal, useToast, fmt } from '../components/ui';
import { ListScreen } from '../components/ListScreen';
import { useScreenSetup } from '../components/TallyFrame';
import { useHotkeys } from '../keyboard';
import { downloadCSV } from '../api/csv';
import { useFeatures } from '../features';

export default function Parties() {
  const toast = useToast();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [parties, setParties] = useState([]);
  const [tab, setTab] = useState(sp.get('type') === 'supplier' ? 'supplier' : 'customer');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);

  const load = () => api.get('/parties').then(setParties);
  useEffect(() => { load(); }, []);
  useEffect(() => { const t = sp.get('type'); if (t === 'supplier' || t === 'customer') setTab(t); }, [sp]);

  const filtered = parties.filter((p) => p.type === tab && (!q || p.name.toLowerCase().includes(q.toLowerCase()) || (p.phone || '').includes(q)));
  const del = async (row) => { if (!confirm(`Delete "${row.name}"?`)) return; await api.del('/parties/' + row.id); toast('Deleted'); load(); };
  const exportCsv = () => downloadCSV(tab + 's', filtered, [
    { key: 'name', label: 'Name' }, { key: 'phone', label: 'Phone' }, { key: 'gstin', label: 'GSTIN' },
    { key: 'address', label: 'Address' }, { key: 'state', label: 'State' }, { key: 'balance', label: 'Balance' },
  ]);

  useScreenSetup({
    title: 'Accounts — Customers & Suppliers', sub: `${filtered.length} ${tab}s`,
    buttons: [
      { key: 'f4', label: 'F4', text: tab === 'customer' ? '→ Suppliers' : '→ Customers', onClick: () => setTab(tab === 'customer' ? 'supplier' : 'customer') },
      { key: 'f5', label: 'F5', text: 'New Party', onClick: () => setEditing({ type: tab }) },
      { key: 'f2', label: 'F2', text: 'Edit', onClick: () => filtered.length && setEditing(filtered[0]) },
      { key: 'f8', label: 'F8/Del', text: 'Delete', onClick: () => filtered.length && del(filtered[0]) },
      { sep: true },
      { key: 'ctrl+e', label: 'Ctrl+E', text: 'Export CSV', onClick: exportCsv },
      { key: 'escape', label: 'Esc', text: 'Dashboard', onClick: () => nav('/') },
    ],
  }, [filtered, tab]);
  useHotkeys({ escape: () => nav('/'), f4: () => setTab(tab === 'customer' ? 'supplier' : 'customer'), f5: () => setEditing({ type: tab }) }, [tab, nav]);

  return (
    <>
      <div className="filterbar">
        <span className="kbd">F4</span><b style={{ textTransform: 'capitalize', color: 'var(--navy2)' }}>{tab}s</b>
        <span className="kbd">Find</span>
        <input placeholder="Search name / phone…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 220 }} />
        <span className="muted">Enter = ledger • F5 new • Edit / Delete on the row • F8 delete</span>
      </div>
      <ListScreen
        rows={filtered} onEnter={(r) => setViewing(r)} onDelete={del} deps={[q, tab]}
        emptyIcon="👥" emptyText={`No ${tab}s. Press F5 to add.`}
        columns={[
          { key: 'name', label: 'Name', render: (r) => <b>{r.name}</b> },
          { key: 'phone', label: 'Phone' },
          { key: 'gstin', label: 'GSTIN' },
          { key: 'state', label: 'State' },
          { key: 'balance', label: 'Balance', align: 'right', render: (r) => (
            <span className={'badge ' + (r.balance > 0 ? 'badge-warning' : r.balance < 0 ? 'badge-danger' : 'badge-success')}>
              {fmt(Math.abs(r.balance))} {r.balance > 0 ? 'Dr' : r.balance < 0 ? 'Cr' : ''}
            </span>
          ) },
          { key: 'act', label: '', align: 'right', render: (r) => (
            <span style={{ display: 'inline-flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
              <button className="btn btn-sm" onClick={() => setViewing(r)}>Ledger</button>
              <button className="btn btn-sm" onClick={() => setEditing(r)}>Edit</button>
              <button className="btn btn-sm" style={{ color: 'var(--accent)' }} onClick={() => del(r)}>Delete</button>
            </span>
          ) },
        ]}
      />
      {editing && <PartyForm party={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); toast('Saved'); }} />}
      {viewing && <PartyLedger party={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function PartyForm({ party, onClose, onSaved }) {
  const toast = useToast();
  const { features } = useFeatures();
  const [f, setF] = useState({
    name: party.name || '', type: party.type || 'customer', phone: party.phone || '', email: party.email || '',
    gstin: party.gstin || '', address: party.address || '', state: party.state || '', opening_balance: party.opening_balance ?? 0,
  });
  const [gstInfo, setGstInfo] = useState(null);   // { state, entityType, valid, online... }
  const [gstLoading, setGstLoading] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (!f.name) return toast('Name is required');
    if (party.id) await api.put('/parties/' + party.id, f); else await api.post('/parties', f);
    onSaved();
  };

  // Look up a GSTIN: offline decode (state, type, checksum) + online enrichment.
  const lookupGstin = async (override) => {
    const g = (override || f.gstin || '').trim().toUpperCase();
    if (g.length !== 15) { setGstInfo(g ? { error: 'GSTIN must be 15 characters' } : null); return; }
    setGstLoading(true);
    try {
      const r = await api.get('/lookup/gstin/' + encodeURIComponent(g));
      setGstInfo(r);
      // Auto-fill state from the GSTIN; fill name/address/phone from online data.
      setF((cur) => {
        const next = { ...cur, gstin: g };
        if (r.state && !cur.state) next.state = r.state;
        if (r.online && !r.online.error) {
          const o = r.online;
          if (!cur.name || cur.name === 'New' ) next.name = o.tradeName || o.legalName || cur.name;
          if ((o.tradeName || o.legalName)) next.name = next.name || o.tradeName || o.legalName;
          if (o.address && !cur.address) next.address = o.address;
          if (o.state) next.state = o.state;
        }
        return next;
      });
      if (!r.valid) toast('⚠ GSTIN checksum looks invalid — please verify');
      else if (r.online && r.online.error) toast('GSTIN decoded offline (online lookup unavailable)');
      else if (r.online) toast('Party details fetched from GSTIN');
      else toast(`GSTIN valid · ${r.state} · ${r.entityType}`);
    } catch (e) {
      setGstInfo({ error: e.message || 'Invalid GSTIN' });
    } finally { setGstLoading(false); }
  };

  return (
    <Modal title={party.id ? 'Account — Alter' : 'Account — Create'} onClose={onClose} onAccept={save}
      footer={<><span className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>Enter = next • Ctrl+A = accept</span><button className="btn" onClick={onClose}>Esc</button><button className="btn btn-primary" data-accept="1" onClick={save}>Accept</button></>}>
      <div className="entry-grid two">
        <label>Name</label><input className="fld" value={f.name} onChange={set('name')} />
        <label>Type</label><select className="fld" value={f.type} onChange={set('type')}><option value="customer">Customer</option><option value="supplier">Supplier</option></select>
        <label>Phone</label><input className="fld" value={f.phone} onChange={set('phone')} />
        <label>Email</label><input className="fld" value={f.email} onChange={set('email')} />
        <label>GSTIN</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="fld" data-noenter="1" value={f.gstin} style={{ flex: 1, textTransform: 'uppercase' }}
            onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })}
            onBlur={(e) => features.gstinAutoFill && lookupGstin(e.target.value)} />
          <button type="button" className="btn" data-enterstop="1" disabled={gstLoading} onClick={() => lookupGstin()}>
            {gstLoading ? '…' : 'Fetch'}
          </button>
        </div>
        <label>State</label><input className="fld" value={f.state} onChange={set('state')} />
        <label>Opening Bal ₹</label><input className="fld" type="number" value={f.opening_balance} onChange={set('opening_balance')} />
      </div>

      {gstInfo && (
        <div className="alert" style={{
          marginTop: 10,
          background: gstInfo.error || gstInfo.valid === false ? 'var(--field-focus)' : 'var(--teal-soft)',
          borderColor: 'var(--border)', color: 'var(--ink)',
        }}>
          {gstInfo.error ? (
            <span style={{ color: 'var(--accent)' }}>⚠ {gstInfo.error}</span>
          ) : (
            <div style={{ fontSize: 13 }}>
              <b>{gstInfo.valid ? '✓ GSTIN' : '⚠ GSTIN (checksum failed)'}:</b> {gstInfo.gstin}
              {' · '}State: <b>{gstInfo.state}</b>
              {gstInfo.entityType ? <> · {gstInfo.entityType}</> : null}
              {gstInfo.pan ? <> · PAN: {gstInfo.pan}</> : null}
              {gstInfo.online && !gstInfo.online.error && (
                <div style={{ marginTop: 4 }}>
                  {gstInfo.online.legalName && <>Legal: <b>{gstInfo.online.legalName}</b><br /></>}
                  {gstInfo.online.tradeName && <>Trade: {gstInfo.online.tradeName} · </>}
                  {gstInfo.online.status && <>Status: {gstInfo.online.status}<br /></>}
                  {gstInfo.online.address && <>Address: {gstInfo.online.address}</>}
                </div>
              )}
              {(!gstInfo.online || gstInfo.online.error) && (
                <div className="muted" style={{ marginTop: 3, fontSize: 12 }}>
                  Offline decode. For full name/address, configure a GST lookup API in Settings → GST.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="entry-sec" style={{ marginTop: 12 }}>Address</div>
      <textarea className="fld" rows={2} value={f.address} onChange={set('address')} />
    </Modal>
  );
}

function PartyLedger({ party, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/parties/' + party.id).then(setData); }, [party.id]);
  return (
    <Modal size="lg" title={'Ledger — ' + party.name} onClose={onClose} onAccept={onClose}
      footer={<button className="btn btn-primary" onClick={onClose}>Close (Esc)</button>}>
      {!data ? <div className="muted">Loading…</div> : (
        <>
          <div className="totbox" style={{ marginBottom: 12 }}>
            <div className="totrow"><span>Closing Balance</span><b>{fmt(Math.abs(data.balance))} {data.balance > 0 ? 'Dr (To receive)' : data.balance < 0 ? 'Cr (To pay)' : ''}</b></div>
            <div className="totrow"><span className="muted">Phone</span><span>{data.phone || '—'}</span></div>
            <div className="totrow"><span className="muted">GSTIN</span><span>{data.gstin || '—'}</span></div>
          </div>
          <div className="entry-sec">Invoices</div>
          {data.invoices.length === 0 ? <p className="muted" style={{ marginBottom: 12 }}>No invoices</p> : (
            <div className="table-wrap" style={{ marginBottom: 12 }}>
              <table className="tbl"><thead><tr><th>No</th><th>Date</th><th>Type</th><th className="text-right">Total</th><th className="text-right">Paid</th><th>Status</th></tr></thead>
                <tbody>{data.invoices.map((i) => <tr key={i.id}><td>{i.invoice_no}</td><td>{i.date}</td><td style={{ textTransform: 'capitalize' }}>{i.type}</td><td className="text-right num">{fmt(i.total)}</td><td className="text-right num">{fmt(i.paid)}</td><td>{i.status}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          <div className="entry-sec">Payments</div>
          {data.payments.length === 0 ? <p className="muted">No payments</p> : (
            <div className="table-wrap">
              <table className="tbl"><thead><tr><th>Date</th><th>Type</th><th>Mode</th><th className="text-right">Amount</th><th>Notes</th></tr></thead>
                <tbody>{data.payments.map((p) => <tr key={p.id}><td>{p.date}</td><td>{p.type === 'in' ? 'Received' : 'Paid'}</td><td>{p.mode}</td><td className="text-right num">{fmt(p.amount)}</td><td className="muted">{p.notes}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
