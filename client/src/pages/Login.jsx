import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { api } from '../api/client';
import { KeyboardProvider, useEnterNav } from '../keyboard';
import logoUrl from '../assets/logo.png';

function LoginInner() {
  const { login, register } = useAuth();
  const nav = useNavigate();
  const enterNav = useEnterNav();
  // modes: login | setup (first-run admin) | forgot
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', username: '', password: '', sec_question: '', sec_answer: '' });
  const [forgot, setForgot] = useState({ question: '', answer: '', newPassword: '' });
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/auth/needs-setup').then((r) => { if (r.needsSetup) setMode('setup'); }).catch(() => {});
  }, []);

  const submit = async (e) => {
    e && e.preventDefault();
    setErr(''); setMsg(''); setBusy(true);
    try {
      if (mode === 'login') { await login(form.username, form.password); nav('/'); }
      else if (mode === 'setup') {
        if (!form.sec_question || !form.sec_answer) throw new Error('Set a security question & answer for password recovery');
        await register({ name: form.name, username: form.username, password: form.password, sec_question: form.sec_question, sec_answer: form.sec_answer });
        nav('/');
      }
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  // Forgot-password (admin only): fetch the security question, then reset.
  const startForgot = async () => {
    setErr(''); setMsg('');
    try {
      const r = await api.get('/auth/recover/question');
      setForgot({ question: r.question, answer: '', newPassword: '' });
      setMode('forgot');
    } catch (e) { setErr(e.message || 'Recovery not available'); }
  };
  const submitForgot = async (e) => {
    e && e.preventDefault();
    setErr(''); setMsg(''); setBusy(true);
    try {
      await api.post('/auth/recover/reset', { answer: forgot.answer, newPassword: forgot.newPassword });
      setMsg('Password reset. You can now sign in with the new password.');
      setMode('login');
      setForm((f) => ({ ...f, password: '' }));
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const SEC_QUESTIONS = [
    'What is your first phone number?',
    'What is your birth town?',
    "What is your mother's maiden name?",
    'What was your first vehicle number?',
    'What is your favourite teacher\'s name?',
  ];

  return (
    <div className="login-wrap">
      <div className="login-box">
        <div className="login-head">RIGHTSERVE — {mode === 'setup' ? 'FIRST-TIME SETUP' : mode === 'forgot' ? 'RESET ADMIN PASSWORD' : 'LOGIN'}</div>
        <div className="login-body" onKeyDown={mode === 'forgot' ? undefined : enterNav}>
          <div className="login-logo"><img src={logoUrl} alt="RightServe" /></div>
          <div style={{ textAlign: 'center', fontSize: 22, fontWeight: 800, color: 'var(--teal-dark)', letterSpacing: 1 }}>RightServe</div>
          <div style={{ textAlign: 'center', marginBottom: 14, color: '#5a6a8a', fontSize: 13 }}>
            {mode === 'login' ? 'Enter credentials and press Enter'
              : mode === 'setup' ? 'Create the Admin account (only admin is created here)'
              : 'Answer your security question to set a new password'}
          </div>
          {err && <div className="alert alert-danger">{err}</div>}
          {msg && <div className="alert" style={{ background: '#e6f6ea', border: '1px solid #6ee7b7', color: '#047857' }}>{msg}</div>}

          {mode !== 'forgot' && (
            <form onSubmit={submit}>
              <div className="entry-grid" style={{ gridTemplateColumns: '120px 1fr' }}>
                {mode === 'setup' && (<>
                  <label>Name</label>
                  <input className="fld" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
                </>)}
                <label>Username</label>
                <input className="fld" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoFocus={mode === 'login'} autoCapitalize="none" />
                <label>Password</label>
                <input className="fld" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                {mode === 'setup' && (<>
                  <label>Security Q</label>
                  <input className="fld" list="secq" value={form.sec_question} onChange={(e) => setForm({ ...form, sec_question: e.target.value })} placeholder="Pick or type a question" />
                  <datalist id="secq">{SEC_QUESTIONS.map((q) => <option key={q} value={q} />)}</datalist>
                  <label>Answer</label>
                  <input className="fld" value={form.sec_answer} onChange={(e) => setForm({ ...form, sec_answer: e.target.value })} placeholder="Remember this — needed to reset password" />
                </>)}
              </div>
              <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button className="btn btn-primary" data-accept="1" disabled={busy} type="submit">
                  {busy ? 'Please wait…' : mode === 'login' ? 'Sign In  ⏎' : 'Create Admin  ⏎'}
                </button>
              </div>
            </form>
          )}

          {mode === 'forgot' && (
            <form onSubmit={submitForgot}>
              <div className="entry-grid" style={{ gridTemplateColumns: '120px 1fr' }}>
                <label>Question</label>
                <div className="fld" style={{ background: 'var(--panel)', borderStyle: 'dashed' }}>{forgot.question}</div>
                <label>Answer</label>
                <input className="fld" value={forgot.answer} onChange={(e) => setForgot({ ...forgot, answer: e.target.value })} autoFocus />
                <label>New Password</label>
                <input className="fld" type="password" value={forgot.newPassword} onChange={(e) => setForgot({ ...forgot, newPassword: e.target.value })} />
              </div>
              <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button className="btn btn-primary" disabled={busy} type="submit">{busy ? 'Please wait…' : 'Reset Password'}</button>
              </div>
            </form>
          )}

          {mode === 'login' && (
            <div style={{ textAlign: 'center', marginTop: 14, fontSize: 12 }}>
              <a href="#" onClick={(e) => { e.preventDefault(); startForgot(); }}>Forgot admin password?</a>
            </div>
          )}
          {mode === 'forgot' && (
            <div style={{ textAlign: 'center', marginTop: 12, fontSize: 12 }}>
              <a href="#" onClick={(e) => { e.preventDefault(); setMode('login'); setErr(''); }}>Back to sign in</a>
            </div>
          )}
        </div>
        <div className="login-credits">
          <div className="cred-title">Designed &amp; Developed by</div>
          <div className="cred-links">
            <a href="https://rightserveinfotechsystem.com/" target="_blank" rel="noreferrer noopener">RightServe Infotech System</a>
            <span className="cred-amp">&amp;</span>
            <a href="https://liveprosolutions.com/" target="_blank" rel="noreferrer noopener">LivePro Solutions</a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Login() {
  return (
    <KeyboardProvider>
      <LoginInner />
    </KeyboardProvider>
  );
}
