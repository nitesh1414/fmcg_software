import { useEffect, useState } from 'react';
import { api } from '../api';
import Layout from '../Layout';
import { Modal } from '../components.jsx';

export default function Users() {
  const [list, setList] = useState([]);
  const [creating, setCreating] = useState(false);
  const [resetFor, setResetFor] = useState(null);

  const load = () => api.get('/users').then(setList).catch(() => {});
  useEffect(() => { load(); }, []);

  const toggleActive = async (u) => { await api.put('/users/' + u.id, { active: u.active ? 0 : 1 }); load(); };

  return (
    <Layout title="Sales Team" sub={`${list.length} user(s)`}
      actions={<button className="btn btn-primary" onClick={() => setCreating(true)}>+ Add Salesperson</button>}>
      <div className="card">
        <div className="card-body" style={{ padding: 0 }}>
          <table className="tbl">
            <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Contact</th><th>Clients</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id}>
                  <td><b>{u.name}</b></td>
                  <td className="mono">{u.username}</td>
                  <td><span className={'badge ' + u.role}>{u.role}</span></td>
                  <td className="muted" style={{ fontSize: 13 }}>{u.email || '—'}<br />{u.phone || ''}</td>
                  <td>{u.client_count}</td>
                  <td><span className={'badge ' + (u.active ? 'active' : 'none')}>{u.active ? 'Active' : 'Disabled'}</span></td>
                  <td className="right actions">
                    <button className="btn btn-sm" onClick={() => setResetFor(u)}>Reset Pwd</button>
                    {u.role !== 'admin' && <button className="btn btn-sm" onClick={() => toggleActive(u)}>{u.active ? 'Disable' : 'Enable'}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {creating && <UserForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {resetFor && <ResetForm user={resetFor} onClose={() => setResetFor(null)} onDone={() => setResetFor(null)} />}
    </Layout>
  );
}

function UserForm({ onClose, onSaved }) {
  const [f, setF] = useState({ name: '', username: '', email: '', phone: '', password: '', role: 'sales' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (!f.name || !f.username || !f.password) { setErr('Name, username and password are required'); return; }
    setBusy(true);
    try { await api.post('/users', f); onSaved(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Add Salesperson" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>Create</button></>}>
      {err && <div className="err">{err}</div>}
      <div className="grid2">
        <div className="field"><label>Full Name *</label><input value={f.name} onChange={set('name')} autoFocus /></div>
        <div className="field"><label>Username *</label><input value={f.username} onChange={set('username')} /></div>
        <div className="field"><label>Email</label><input value={f.email} onChange={set('email')} /></div>
        <div className="field"><label>Phone</label><input value={f.phone} onChange={set('phone')} /></div>
        <div className="field"><label>Password *</label><input type="text" value={f.password} onChange={set('password')} /></div>
        <div className="field"><label>Role</label><select value={f.role} onChange={set('role')}><option value="sales">Salesperson</option><option value="admin">Admin</option></select></div>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>Share the username &amp; password with the salesperson. They can change it after first login.</p>
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
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>Set Password</button></>}>
      {err && <div className="err">{err}</div>}
      <div className="field"><label>New Password</label><input type="text" value={pwd} onChange={(e) => setPwd(e.target.value)} autoFocus /></div>
    </Modal>
  );
}
