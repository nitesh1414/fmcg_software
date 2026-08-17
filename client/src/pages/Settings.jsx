import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, downloadFile, setToken, setBusinessId } from '../api/client';
import { useToast } from '../components/ui';
import { useAuth } from '../auth';
import { useBusiness } from '../business';
import { useScreenSetup } from '../components/TallyFrame';
import { useHotkeys, useEnterNav } from '../keyboard';

// App-wide settings & configuration. Firm/company details (name, GSTIN, logo,
// bank, bill format, etc.) live in Business Profiles — this page only holds
// preferences that apply across the whole app.
export default function Settings() {
  const toast = useToast();
  const nav = useNavigate();
  const { user } = useAuth();
  const { list: businesses, active } = useBusiness();
  const enterNav = useEnterNav();
  const [c, setC] = useState(null);
  const [users, setUsers] = useState([]);
  const [backupInfo, setBackupInfo] = useState(null);
  const [curFy, setCurFy] = useState(null);

  useEffect(() => {
    api.get('/company').then(setC);
    api.get('/auth/users').then(setUsers).catch(() => {});
    api.get('/backup/info').then(setBackupInfo).catch(() => {});
    api.get('/reports/current-fy').then(setCurFy).catch(() => {});
  }, []);

  const setFeat = (k) => (e) => setC({ ...c, features: { ...(c.features || {}), [k]: e.target.value } });
  const setFeatBool = (k) => (e) => setC({ ...c, features: { ...(c.features || {}), [k]: e.target.checked } });
  const ft = (k, d) => (c && c.features && c.features[k] !== undefined ? c.features[k] : d);
  const set = (k) => (e) => setC({ ...c, [k]: e.target.value });
  const save = async () => { await api.put('/company', c); toast('Settings saved'); };

  const doBackup = async () => {
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      await downloadFile('/backup/download', `RightServe-Backup-${stamp}.db`);
      toast('Backup downloaded');
    } catch (e) { toast(e.message || 'Backup failed'); }
  };
  // Admin-only: wipe all business data (keeps the licence). Because this deletes
  // the current user too, we clear the session and reload → first-user setup.
  const deleteAll = async () => {
    if (!window.confirm('Delete ALL data?\n\nEvery invoice, item, party, payment and user will be permanently erased. Your software licence stays intact and the app returns to the create-first-user screen.\n\nTake a backup first. Continue?')) return;
    if (!window.confirm('Final confirmation — this cannot be undone.\n\nClick OK to erase everything now.')) return;
    try {
      await api.post('/backup/wipe', {});
      setToken(null);
      setBusinessId(null);
      toast('All data deleted. Restarting setup…');
      setTimeout(() => { window.location.href = '/'; }, 600);
    } catch (e) { toast(e.message || 'Delete all data failed'); }
  };
  const fmtBytes = (n) => {
    if (!n) return '0 KB';
    if (n > 1048576) return (n / 1048576).toFixed(1) + ' MB';
    return Math.max(1, Math.round(n / 1024)) + ' KB';
  };

  useScreenSetup({
    title: 'App Settings & Configuration (F11)', sub: 'Edit and press Ctrl+A to accept',
    buttons: [
      { key: 'ctrl+a', label: 'Ctrl+A', text: 'Accept', onClick: save },
      { key: 'escape', label: 'Esc', text: 'Dashboard', onClick: () => nav('/') },
    ],
  }, [c]);
  useHotkeys({ escape: () => nav('/'), 'ctrl+a': save }, [nav, c]);

  if (!c) return <div className="muted" style={{ padding: 20 }}>Loading…</div>;

  const bizCount = (businesses || []).filter((b) => b.active).length;

  return (
    <div className="entry" onKeyDown={enterNav}>
      {/* Firm details now live in Business Profiles — clear pointer, no duplication */}
      <div className="entry-sec">Business / Firm Details</div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', maxWidth: 720, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', background: 'var(--panel, #fafafa)' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{active ? active.name : 'Your Business'}</div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
            Company name, GSTIN, address, logo, bank details, QR, signature/stamp, invoice prefix and
            <b> bill format</b> are managed in <b>Business Profiles</b>{bizCount > 1 ? ` — you have ${bizCount} businesses.` : '.'}
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => nav('/businesses')}>🏢 Manage Business Profiles →</button>
      </div>

      <div className="entry-sec" style={{ marginTop: 18 }}>Financial Year (for reports)</div>
      <div className="entry-grid two">
        <label>Financial Year Starts</label>
        <select className="fld" value={c.fy_start_month || 4} onChange={set('fy_start_month')}>
          {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => (
            <option key={m} value={i + 1}>{m}{i + 1 === 4 ? ' (India default)' : ''}</option>
          ))}
        </select>
        <label />
        <span className="muted" style={{ fontSize: 12 }}>Used to group financial-year reports (P&amp;L snapshot, GSTR periods).</span>
        <label>Current Financial Year</label>
        <span style={{ fontSize: 13 }}>
          {curFy ? <><b>FY {curFy.label}</b> <span className="muted">({curFy.from} → {curFy.to})</span> <span className="badge badge-success" style={{ marginLeft: 6 }}>auto</span></> : <span className="muted">…</span>}
          <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>Detected automatically from today's date — rolls over on its own when a new FY begins.</div>
        </span>
      </div>

      <div className="entry-sec" style={{ marginTop: 16 }}>GST / Returns</div>
      <div className="entry-grid two">
        <label>B2CL Threshold (₹)</label>
        <input className="fld" type="number" value={(c.features && c.features.b2clThreshold) ?? 250000} onChange={setFeat('b2clThreshold')} />
        <label />
        <span className="muted" style={{ fontSize: 12 }}>Inter-state B2C invoices above this value are reported invoice-wise (B2CL) in GSTR-1. Historically ₹2,50,000; some periods use ₹1,00,000.</span>
      </div>

      <div className="entry-sec" style={{ marginTop: 16 }}>Smart Lookup (HSN &amp; GSTIN)</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 720 }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 500 }}>
          <input type="checkbox" checked={!!ft('autoHSN', true)} onChange={setFeatBool('autoHSN')} />
          Auto-suggest HSN code &amp; GST rate while adding items (works offline)
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 500 }}>
          <input type="checkbox" checked={!!ft('gstinAutoFill', true)} onChange={setFeatBool('gstinAutoFill')} />
          Auto-fill party state &amp; details from GSTIN (offline decode; online if API set)
        </label>
      </div>
      <div className="entry-grid two" style={{ marginTop: 10 }}>
        <label>GSTIN Lookup API URL</label>
        <input className="fld" placeholder="https://provider.example/gstin/{gstin}" value={ft('gstApiUrl', '')} onChange={setFeat('gstApiUrl')} />
        <label>API Key</label>
        <input className="fld" type="password" placeholder="optional — your provider key" value={ft('gstApiKey', '')} onChange={setFeat('gstApiKey')} />
        <label>API Key Header</label>
        <input className="fld" placeholder="Authorization" value={ft('gstApiHeader', 'Authorization')} onChange={setFeat('gstApiHeader')} />
        <label />
        <span className="muted" style={{ fontSize: 12 }}>
          Optional. Use any GSTIN verification API (e.g. APISetu / a GSP reseller). URL may contain
          <code> {'{gstin}'} </code> and <code> {'{key}'} </code> placeholders. Without it, GSTIN is still
          validated and decoded offline (state, PAN, entity type, checksum). HSN suggestions always work offline.
        </span>
      </div>

      <div style={{ marginTop: 16 }}><button className="btn btn-primary" data-accept="1" onClick={save}>Accept (Ctrl+A)</button></div>

      <div className="entry-sec" style={{ marginTop: 20 }}>Appearance</div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>Change color scheme, text size and row density to suit your screen and reduce eye strain.</p>
      <button className="btn" onClick={() => window.dispatchEvent(new CustomEvent('open-theme'))}>🎨 Theme &amp; Color Scheme (Ctrl+T)</button>

      <div className="entry-sec" style={{ marginTop: 20 }}>Billing Options (F12)</div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>Toggle GST columns, batch/expiry, discounts, round-off, negative stock and more.</p>
      <button className="btn" onClick={() => window.dispatchEvent(new CustomEvent('open-config'))}>⚙ Configuration Panel (F12)</button>

      <div className="entry-sec" style={{ marginTop: 20 }}>Backup &amp; Data</div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
        All your data is stored locally on this computer. Take regular backups — especially before uninstalling, as
        uninstall offers to permanently delete all data.
      </p>
      {backupInfo && (
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
          Data size: <b>{fmtBytes(backupInfo.sizeBytes)}</b> ·
          {' '}{backupInfo.counts.invoices} invoices · {backupInfo.counts.items} items · {backupInfo.counts.parties} parties
        </p>
      )}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-primary" onClick={doBackup}>⬇ Backup All Data (.db)</button>
        {user?.role === 'admin' && <button className="btn" style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }} onClick={deleteAll}>🗑 Delete All Data…</button>}
        {window.desktop?.isElectron && (
          <span className="muted" style={{ fontSize: 12.5 }}>
            Tip: the desktop <b>File</b> menu also has Backup, Restore and Delete-All options.
          </span>
        )}
      </div>
      {user?.role === 'admin' && (
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Delete All Data erases every invoice, item, party, payment and user — but <b>keeps your software licence</b>.
          The app returns to the first-time <b>create-user</b> screen. Take a backup first.
        </p>
      )}

      <div className="entry-sec" style={{ marginTop: 20 }}>Users — logged in as {user?.name} ({user?.role})</div>
      <div className="table-wrap" style={{ maxWidth: 640 }}>
        <table className="tbl"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Created</th></tr></thead>
          <tbody>{users.map((u) => <tr key={u.id}><td><b>{u.name}</b></td><td>{u.username}</td><td><span className={'badge ' + (u.role === 'admin' ? 'badge-primary' : 'badge-muted')}>{u.role}</span></td><td>{(u.created_at || '').slice(0, 10)}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>Manage staff &amp; access in <b>System → User Management</b>.</p>
    </div>
  );
}
