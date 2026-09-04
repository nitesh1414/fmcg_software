import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import Layout from '../Layout';
import { Modal, Confirm } from '../components.jsx';

export default function Users() {
  const { user: me } = useAuth();
  const [list, setList] = useState([]);
  const [form, setForm] = useState(null);      // {} = create, {…} = edit
  const [resetFor, setResetFor] = useState(null);
  const [delFor, setDelFor] = useState(null);
  const [err, setErr] = useState('');

  const load = () => api.get('/users').then(setList).catch(() => {});
  useEffect(() => { load(); }, []);

  const toggleActive = async (u) => {
    setErr('');
    try { await api.put('/users/' + u.id, { active: u.active ? 0 : 1 }); load(); }
    catch (e) { setErr(e.message); }   // inline banner — no blocking alert() on phones
  };

  return (
    <Layout title="Sales Team" sub={`${list.length} user(s)`}
      actions={<button className="btn btn-primary" onClick={() => setForm({})}>+ Add Salesperson</button>}>
      {err && <div className="err">{err} <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => setErr('')}>Dismiss</button></div>}

      <div className="card">
        <div className="card-body" style={{ padding: 0 }}>
          <div className="table-scroll">
            <table className="tbl">
              <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Contact</th><th>Clients</th><th>Licenses</th><th>Last login</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {list.map((u) => {
                  const self = me?.id === u.id;
                  return (
                    <tr key={u.id}>
                      <td data-label="Name"><b>{u.name}</b>{self ? <span className="stack-sub">that's you</span> : null}</td>
                      <td data-label="Username" className="mono">{u.username}</td>
                      <td data-label="Role"><span className={'badge ' + u.role}>{u.role}</span></td>
                      <td data-label="Contact" className="muted" style={{ fontSize: 13 }}>
                        {u.email || '—'}{u.phone ? <span className="stack-sub">{u.phone}</span> : null}
                      </td>
                      <td data-label="Clients">{u.client_count}</td>
                      <td data-label="Licenses">{u.license_count}</td>
                      <td data-label="Last login" className="muted" style={{ fontSize: 13 }}>{u.last_login_at ? u.last_login_at.slice(0, 16) : 'never'}</td>
                      <td data-label="Status"><span className={'badge ' + (u.active ? 'active' : 'none')}>{u.active ? 'Active' : 'Disabled'}</span></td>
                      <td data-label="" className="actions-cell">
                        <span className="actions">
                          <button className="btn btn-sm" onClick={() => setForm(u)}>Edit</button>
                          <button className="btn btn-sm" onClick={() => setResetFor(u)}>Reset Pwd</button>
                          {!self && u.role !== 'admin' && (
                            <button className="btn btn-sm" onClick={() => toggleActive(u)}>{u.active ? 'Disable' : 'Enable'}</button>
                          )}
                          {!self && <button className="btn btn-sm btn-danger" onClick={() => setDelFor(u)}>Delete</button>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {form && <UserForm user={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
      {resetFor && <ResetForm user={resetFor} onClose={() => setResetFor(null)} onDone={() => setResetFor(null)} />}
      {delFor && <DeleteUser user={delFor} users={list} onClose={() => setDelFor(null)} onDone={() => { setDelFor(null); load(); }} />}
    </Layout>
  );
}

function UserForm({ user, onClose, onSaved }) {
  const [f, setF] = useState({
    name: user?.name || '', username: user?.username || '', email: user?.email || '',
    phone: user?.phone || '', password: '', role: user?.role || 'sales', active: user?.active ?? 1,
  });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (!f.name || !f.username || (!user && !f.password)) { setErr('Name, username and password are required'); return; }
    setBusy(true);
    try {
      if (user) {
        await api.put('/users/' + user.id, {
          name: f.name, username: f.username, email: f.email, phone: f.phone, role: f.role, active: f.active,
        });
      } else {
        await api.post('/users', f);
      }
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={user ? 'Edit User — ' + user.name : 'Add Salesperson'} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : (user ? 'Save Changes' : 'Create')}</button>
      </>}>
      {err && <div className="err">{err}</div>}
      <div className="grid2">
        <div className="field"><label>Full Name *</label><input value={f.name} onChange={set('name')} autoFocus /></div>
        <div className="field"><label>Username *</label><input value={f.username} onChange={set('username')} autoCapitalize="none" /></div>
        <div className="field"><label>Email</label><input value={f.email} onChange={set('email')} inputMode="email" /></div>
        <div className="field"><label>Phone</label><input value={f.phone} onChange={set('phone')} inputMode="tel" /></div>
        <div className="field"><label>Role</label>
          <select value={f.role} onChange={set('role')}>
            <option value="sales">Salesperson</option><option value="admin">Admin</option>
          </select></div>
        {user && (
          <div className="field"><label>Account</label>
            <select value={f.active ? '1' : '0'} onChange={(e) => setF({ ...f, active: Number(e.target.value) })}>
              <option value="1">Active</option><option value="0">Disabled (cannot log in)</option>
            </select></div>
        )}
      </div>
      {!user && (
        <>
          <div className="field"><label>Password *</label><input type="text" value={f.password} onChange={set('password')} /></div>
          <p className="muted" style={{ fontSize: 12 }}>Share the username &amp; password with the salesperson. They can change it after first login.</p>
        </>
      )}
      {user && <p className="muted" style={{ fontSize: 12 }}>Use “Reset Pwd” to set a new password for this user.</p>}
    </Modal>
  );
}

function ResetForm({ user, onClose, onDone }) {
  const [pwd, setPwd] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!pwd || pwd.length < 4) { setErr('Password too short'); return; }
    setBusy(true);
    try { await api.post('/users/' + user.id + '/reset-password', { password: pwd }); onDone(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={'Reset Password — ' + user.name} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>Set Password</button>
      </>}>
      {err && <div className="err">{err}</div>}
      <div className="field"><label>New Password</label><input type="text" value={pwd} onChange={(e) => setPwd(e.target.value)} autoFocus /></div>
    </Modal>
  );
}

// Deleting a user keeps their clients & licenses — they can be handed to
// another salesperson in the same dialog.
function DeleteUser({ user, users, onClose, onDone }) {
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const others = users.filter((u) => u.id !== user.id);
  const run = async () => {
    setBusy(true); setErr('');
    try { await api.del('/users/' + user.id + (to ? '?reassign_to=' + to : '')); onDone(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Confirm danger busy={busy} confirmLabel="Delete user" onClose={onClose} onConfirm={run}
      title={'Delete ' + user.name + '?'}
      message={`Their login is removed. Their ${user.client_count} client(s) and ${user.license_count} license(s) are kept.`}
      extra={<>
        <div className="field" style={{ marginTop: 14 }}>
          <label>Hand their clients &amp; licenses to</label>
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Nobody — leave unassigned (admins only)</option>
            {others.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.username})</option>)}
          </select>
          <div className="hint muted">Unassigned clients stay in the system but only admins see them.</div>
        </div>
        {err && <div className="err">{err}</div>}
      </>} />
  );
}
