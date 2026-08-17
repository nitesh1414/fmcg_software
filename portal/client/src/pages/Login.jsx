import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try { await login(username.trim(), password); nav('/'); }
    catch (e) { setErr(e.message || 'Login failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-head">
          <h2><span className="sb-logo" style={{ width: 32, height: 32 }}>RS</span> RightServe Portal</h2>
          <p>Sales &amp; License Management — single login for admin &amp; sales</p>
        </div>
        <form className="login-body" onSubmit={submit}>
          {err && <div className="err">{err}</div>}
          <div className="field"><label>Username</label>
            <input value={username} onChange={(e) => setU(e.target.value)} autoFocus /></div>
          <div className="field"><label>Password</label>
            <input type="password" value={password} onChange={(e) => setP(e.target.value)} /></div>
          <button className="btn btn-primary" style={{ width: '100%', padding: 11 }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
          <p className="muted" style={{ fontSize: 12, marginTop: 14, textAlign: 'center' }}>
            Demo — admin / admin123 · sales1 / sales123
          </p>
        </form>
      </div>
    </div>
  );
}
