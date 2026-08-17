import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { Modal, useToast } from '../components/ui';
import { ListScreen } from '../components/ListScreen';
import { useScreenSetup } from '../components/TallyFrame';
import { useHotkeys } from '../keyboard';
import { useAuth, isAdmin } from '../auth';

const MODULES = [
  ['sales', 'Sales'], ['purchase', 'Purchase'], ['items', 'Items / Stock'],
  ['parties', 'Parties'], ['payments', 'Receipts & Payments'], ['reports', 'Reports'], ['gst', 'GST'],
];
const LEVELS = [['none', 'No access'], ['read', 'View only'], ['write', 'Full (edit)']];

export default function Users() {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(null);   // user being created/edited
  const [resetFor, setResetFor] = useState(null);

  const load = () => api.get('/auth/users').then(setList).catch(() => {});
  useEffect(() => { load(); }, []);

  // Only admin may use this screen.
  useEffect(() => { if (user && !isAdmin(user)) nav('/'); }, [user]);

  const del = async (row) => {
    if (row.role === 'admin') return toast('Admin account cannot be deleted');
    if (!confirm(`Delete user "${row.name}" (@${row.username})? This cannot be undone.`)) return;
    try { await api.del('/auth/users/' + row.id); toast('User deleted'); load(); }
    catch (e) { toast(e.message); }
  };

  useScreenSetup({
    title: 'User Management', sub: `${list.length} user(s)`,
    buttons: [
      { key: 'f5', label: 'F5', text: 'New User', onClick: () => setEditing({ permissions: defaultPerms() }) },
      { key: 'f8', label: 'F8/Del', text: 'Delete', onClick: () => list[0] && del(list.find((u) => u.role !== 'admin') || list[0]) },
      { sep: true },
      { key: 'escape', label: 'Esc', text: 'Dashboard', onClick: () => nav('/') },
    ],
  }, [list]);
  useHotkeys({ escape: () => nav('/'), f5: () => setEditing({ permissions: defaultPerms() }) }, [nav]);

  return (
    <>
      <div className="filterbar"><span className="muted">F5 = add user • Click a row to edit access • Reset password / Delete from the row</span></div>
      <ListScreen
        rows={list} onEnter={(r) => r.role !== 'admin' && setEditing(r)} onDelete={del} deps={[]}
        emptyIcon="👤" emptyText="No users."
        columns={[
          { key: 'name', label: 'Name', render: (r) => <b>{r.name}</b> },
          { key: 'username', label: 'Username' },
          { key: 'role', label: 'Role', render: (r) => <span className={'badge ' + (r.role === 'admin' ? 'badge-warning' : 'badge-primary')}>{r.role}</span> },
          { key: 'active', label: 'Status', render: (r) => <span className={'badge ' + (r.active ? 'badge-success' : 'badge-muted')}>{r.active ? 'Active' : 'Disabled'}</span> },
          { key: 'access', label: 'Access', render: (r) => r.role === 'admin' ? <span className="muted">Full (admin)</span> : <span className="muted" style={{ fontSize: 12 }}>{summarize(r.permissions)}</span> },
          { key: 'act', label: '', align: 'right', render: (r) => r.role === 'admin' ? <span className="muted">—</span> : (
            <span style={{ display: 'inline-flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
              <button className="btn btn-sm" onClick={() => setEditing(r)}>Edit</button>
              <button className="btn btn-sm" onClick={() => setResetFor(r)}>Reset Pwd</button>
              <button className="btn btn-sm" style={{ color: 'var(--accent)' }} onClick={() => del(r)}>Delete</button>
            </span>
          ) },
        ]}
      />
      {editing && <UserForm user={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); toast('Saved'); }} />}
      {resetFor && <ResetForm user={resetFor} onClose={() => setResetFor(null)} onDone={() => { setResetFor(null); toast('Password reset'); }} />}
    </>
  );
}

function defaultPerms() {
  const p = {}; for (const [m] of MODULES) p[m] = 'read'; return p;
}
function summarize(perms) {
  if (!perms) return '—';
  const w = MODULES.filter(([m]) => perms[m] === 'write').map(([, l]) => l);
  const r = MODULES.filter(([m]) => perms[m] === 'read').map(([, l]) => l);
  const parts = [];
  if (w.length) parts.push('Edit: ' + w.join(', '));
  if (r.length) parts.push('View: ' + r.join(', '));
  return parts.join(' · ') || 'No access';
}

function UserForm({ user, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !user.id;
  const [f, setF] = useState({
    name: user.name || '', username: user.username || '', password: '',
    active: user.active === undefined ? true : !!user.active,
    permissions: { ...defaultPerms(), ...(user.permissions || {}) },
  });
  const [busy, setBusy] = useState(false);
  const setPerm = (m, v) => setF((s) => ({ ...s, permissions: { ...s.permissions, [m]: v } }));
  const setAll = (v) => setF((s) => ({ ...s, permissions: Object.fromEntries(MODULES.map(([m]) => [m, v])) }));

  const save = async () => {
    if (!f.name.trim()) return toast('Name is required');
    if (isNew && (!f.username.trim() || !f.password)) return toast('Username and password are required');
    if (isNew && f.password.length < 4) return toast('Password must be at least 4 characters');
    setBusy(true);
    try {
      if (isNew) await api.post('/auth/users', { name: f.name.trim(), username: f.username.trim(), password: f.password, permissions: f.permissions });
      else await api.put('/auth/users/' + user.id, { name: f.name.trim(), permissions: f.permissions, active: f.active });
      onSaved();
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal size="lg" title={isNew ? 'New User' : `Edit User — ${user.name}`} onClose={onClose} onAccept={save}
      footer={<><span className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>Set tab-wise access below · Ctrl+A = save</span><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" data-accept="1" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="entry-grid two">
        <label>Full Name</label><input className="fld" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        <label>Username</label><input className="fld" value={f.username} disabled={!isNew} onChange={(e) => setF({ ...f, username: e.target.value })} autoCapitalize="none" />
        {isNew && (<><label>Password</label><input className="fld" type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="min 4 characters" /></>)}
        {!isNew && (<><label>Status</label>
          <select className="fld" value={f.active ? '1' : '0'} onChange={(e) => setF({ ...f, active: e.target.value === '1' })}><option value="1">Active</option><option value="0">Disabled</option></select></>)}
      </div>

      <div className="entry-sec" style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Tab-wise Access</span>
        <span style={{ display: 'inline-flex', gap: 6 }}>
          <button type="button" className="btn btn-sm" onClick={() => setAll('none')}>None</button>
          <button type="button" className="btn btn-sm" onClick={() => setAll('read')}>All View</button>
          <button type="button" className="btn btn-sm" onClick={() => setAll('write')}>All Full</button>
        </span>
      </div>
      <table className="tbl" style={{ background: '#fff' }}>
        <thead><tr><th>Module / Tab</th><th>Access level</th></tr></thead>
        <tbody>
          {MODULES.map(([m, label]) => (
            <tr key={m}>
              <td>{label}</td>
              <td>
                <select className="fld" style={{ width: 160 }} value={f.permissions[m] || 'none'} onChange={(e) => setPerm(m, e.target.value)}>
                  {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        “View only” = can see &amp; print but not create/edit/delete. “Full” = can edit. System settings, users &amp; license remain admin-only.
      </p>
    </Modal>
  );
}

function ResetForm({ user, onClose, onDone }) {
  const toast = useToast();
  const [pwd, setPwd] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!pwd || pwd.length < 4) return toast('Password must be at least 4 characters');
    setBusy(true);
    try { await api.post('/auth/users/' + user.id + '/reset-password', { password: pwd }); onDone(); }
    catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Reset Password — ${user.name}`} onClose={onClose} onAccept={save}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" data-accept="1" disabled={busy} onClick={save}>Set Password</button></>}>
      <div className="entry-grid two">
        <label>New Password</label><input className="fld" type="text" value={pwd} onChange={(e) => setPwd(e.target.value)} autoFocus placeholder="min 4 characters" />
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Share the new password with {user.name}. They can change it later from their profile.</p>
    </Modal>
  );
}
