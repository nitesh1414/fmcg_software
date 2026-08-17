import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useToast } from '../components/ui';
import { useScreenSetup } from '../components/TallyFrame';
import { useHotkeys } from '../keyboard';

// Link a WhatsApp account (scan QR from your phone) so bills can be sent to
// customers on WhatsApp. Session persists, so you scan only once.
export default function WhatsApp() {
  const nav = useNavigate();
  const toast = useToast();
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  const refresh = () => api.get('/whatsapp/status').then(setSt).catch(() => {});
  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, 2500); // poll for QR / ready changes
    return () => clearInterval(timer.current);
  }, []);

  const connect = async () => {
    setBusy(true);
    try { const r = await api.post('/whatsapp/connect'); setSt(r); toast('Starting WhatsApp — scan the QR when it appears'); }
    catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  const logout = async () => {
    if (!confirm('Unlink WhatsApp from this app?')) return;
    setBusy(true);
    try { const r = await api.post('/whatsapp/logout'); setSt(r); toast('WhatsApp unlinked'); }
    catch (e) { toast(e.message); } finally { setBusy(false); }
  };

  useScreenSetup({
    title: 'WhatsApp Connect', sub: 'Link a device to send bills on WhatsApp',
    buttons: [{ key: 'escape', label: 'Esc', text: 'Dashboard', onClick: () => nav('/') }],
  }, [st]);
  useHotkeys({ escape: () => nav('/') }, [nav]);

  const status = st?.status || 'disconnected';
  const ready = status === 'ready';

  return (
    <div className="entry" style={{ maxWidth: 720 }}>
      {st && !st.available && (
        <div className="alert alert-danger" style={{ marginBottom: 14 }}>
          WhatsApp support isn't installed on this server. Run <code>npm install</code> in the <code>server</code> folder
          (installs <code>whatsapp-web.js</code>) and restart.
          {st.loadError ? <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{st.loadError}</div> : null}
        </div>
      )}

      <div className="entry-sec">Connection</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <StatusBadge status={status} />
        {ready && st?.me?.number && <span className="muted">Linked as <b>+{st.me.number}</b>{st.me.name ? ` (${st.me.name})` : ''}</span>}
        {st?.lastError && !ready && <span className="muted" style={{ fontSize: 12 }}>{st.lastError}</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {!ready && <button className="btn btn-primary" disabled={busy || (st && !st.available)} onClick={connect}>{busy ? 'Starting…' : (status === 'qr' ? 'Refresh QR' : 'Connect WhatsApp')}</button>}
          {(ready || status === 'authenticated' || status === 'qr') && <button className="btn" disabled={busy} onClick={logout}>Unlink</button>}
        </span>
      </div>

      {status === 'qr' && st?.qr && (
        <div style={{ textAlign: 'center', padding: '10px 0' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Scan this QR with WhatsApp</div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            On your phone: <b>WhatsApp → Settings → Linked Devices → Link a Device</b>, then point the camera here.
          </p>
          <img src={st.qr} alt="WhatsApp QR" style={{ width: 300, height: 300, border: '1px solid var(--border)', borderRadius: 10, background: '#fff', padding: 6 }} />
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>The QR also prints in the app's terminal window. It refreshes automatically.</p>
        </div>
      )}

      {(status === 'initializing' || (status === 'qr' && !st?.qr)) && (
        <div className="muted" style={{ padding: 16 }}>Preparing WhatsApp… this can take a few seconds on first run.</div>
      )}

      {ready && (
        <div className="alert" style={{ background: 'var(--teal-soft)', border: '1px solid var(--border)' }}>
          ✓ WhatsApp is connected. Open any sale invoice and click <b>Send on WhatsApp</b> to deliver the bill PDF to the
          customer. If the customer has no number saved, you can type one when sending.
        </div>
      )}

      <div className="entry-sec" style={{ marginTop: 20 }}>How it works</div>
      <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, paddingLeft: 18 }}>
        <li>Uses your own WhatsApp account (like WhatsApp Web) — no third-party charges.</li>
        <li>Scan once; the session stays linked until you unlink or remove it from your phone.</li>
        <li>The bill is sent as a PDF attachment with a short message to the customer's number.</li>
        <li>Numbers default to India (+91) when a 10-digit number is entered.</li>
      </ul>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    ready: ['badge-success', 'Connected'],
    authenticated: ['badge-primary', 'Authenticating…'],
    qr: ['badge-warning', 'Scan QR to link'],
    initializing: ['badge-primary', 'Starting…'],
    auth_failure: ['badge-danger', 'Auth failed'],
    disconnected: ['badge-muted', 'Not connected'],
  };
  const [cls, label] = map[status] || map.disconnected;
  return <span className={'badge ' + cls}>{label}</span>;
}
