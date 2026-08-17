import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useScreenSetup } from '../components/TallyFrame';
import { useHotkeys } from '../keyboard';
import { useToast } from '../components/ui';

const SUPPORT = {
  email: 'support@StockVeda.com',
  phone: '+91 86693 0888 / +91 94044 84560',
};

// Visual status meta per license state.
function statusMeta(s) {
  switch (s.state) {
    case 'active':
      return s.perpetual
        ? { label: 'Active · Lifetime', cls: 'lic-ok', icon: '✅', note: 'This is a perpetual license — it never expires.' }
        : { label: 'Active', cls: 'lic-ok', icon: '✅', note: 'Your license is active and valid.' };
    case 'expiring':
      return { label: `Expiring Soon · ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} left`, cls: 'lic-warn', icon: '⏳',
        note: 'Your license is about to expire. Please renew to avoid interruption.' };
    case 'expired':
      return { label: 'Expired · Read-Only', cls: 'lic-bad', icon: '🔒',
        note: 'Your license has expired. The app is in read-only mode — you can view, print and back up, but cannot make changes until you renew.' };
    case 'invalid':
      return { label: 'Invalid License', cls: 'lic-bad', icon: '⚠️', note: 'The installed license could not be verified.' };
    case 'web':
      return { label: 'Web / Server Mode', cls: 'lic-ok', icon: '🌐', note: 'Licensing applies to the desktop application only.' };
    default:
      return { label: 'Not Activated', cls: 'lic-bad', icon: '🔑', note: 'No license is installed.' };
  }
}

export default function License() {
  const nav = useNavigate();
  const toast = useToast();
  const [lic, setLic] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get('/license-state').then(setLic).catch(() => setLic({ state: 'web' })).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  useScreenSetup({
    title: 'License & Activation',
    sub: 'Manage your RightServe license',
    buttons: [
      { key: 'f5', label: 'F5', text: 'Refresh', onClick: load },
      { sep: true },
      { key: 'escape', label: 'Esc', text: 'Dashboard', onClick: () => nav('/') },
    ],
  }, [nav]);
  useHotkeys({ escape: () => nav('/'), f5: load }, [nav]);

  const isDesktop = !!(window.desktop && window.desktop.isElectron);
  const meta = lic ? statusMeta(lic) : null;

  const enterKey = () => {
    if (isDesktop && window.desktop.license) window.desktop.license.enterKey();
    else toast('License keys are entered in the desktop app.');
  };
  const copyMachine = async () => {
    if (isDesktop && window.desktop.license) {
      const r = await window.desktop.license.copyMachineId();
      toast('Machine ID copied: ' + (r.machineId || ''));
    } else if (lic && lic.machineId) {
      try { await navigator.clipboard.writeText(lic.machineId); toast('Machine ID copied'); }
      catch (_) { toast('Copy not available'); }
    }
  };

  if (loading) return <div className="entry" style={{ maxWidth: 760 }}><p className="muted">Loading license…</p></div>;

  // Web build (not desktop): explain licensing is desktop-only.
  if (!isDesktop && (!lic || lic.state === 'web')) {
    return (
      <div className="entry" style={{ maxWidth: 760 }}>
        <div className="lic-card lic-ok">
          <div className="lic-status"><span className="lic-ico">🌐</span><div><div className="lic-label">Web / Server Mode</div>
            <div className="muted">You are running RightServe in a web browser. Licensing & activation apply to the installable desktop application.</div></div></div>
        </div>
        <SupportBox />
      </div>
    );
  }

  return (
    <div className="entry" style={{ maxWidth: 760 }}>
      {/* Status banner */}
      <div className={'lic-card ' + meta.cls}>
        <div className="lic-status">
          <span className="lic-ico">{meta.icon}</span>
          <div>
            <div className="lic-label">{meta.label}</div>
            <div className="muted" style={{ fontSize: 13 }}>{meta.note}</div>
          </div>
        </div>
        {!lic.perpetual && lic.expires && (
          <div className="lic-expiry">
            <span className="muted">Valid till</span>
            <b>{lic.expires}</b>
          </div>
        )}
      </div>

      {/* Details */}
      <div className="entry-sec" style={{ marginTop: 18 }}>License Details</div>
      <table className="tbl" style={{ background: '#fff' }}>
        <tbody>
          <tr><td style={{ width: 200 }} className="muted">Licensed To</td><td><b>{lic.client || '—'}</b></td></tr>
          <tr><td className="muted">Plan</td><td>{lic.plan || '—'}</td></tr>
          <tr><td className="muted">License ID</td><td><span className="mono">{lic.licenseId || '—'}</span></td></tr>
          <tr><td className="muted">Issued On</td><td>{lic.issued || '—'}</td></tr>
          <tr><td className="muted">Expiry</td><td>{lic.perpetual ? <b style={{ color: 'var(--green)' }}>Never (Lifetime)</b> : (lic.expires || '—')}{!lic.perpetual && typeof lic.daysLeft === 'number' && (
            <span className="muted"> · {lic.daysLeft < 0 ? `expired ${-lic.daysLeft} day(s) ago` : `${lic.daysLeft} day(s) left`}</span>
          )}</td></tr>
          <tr><td className="muted">Computer Lock</td><td>{lic.machineLocked ? '🔒 Locked to this computer' : 'Not locked (any computer)'}</td></tr>
          <tr><td className="muted">Machine ID</td><td>
            <span className="mono">{lic.machineId || '—'}</span>
            {lic.machineId && <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={copyMachine}>Copy</button>}
          </td></tr>
        </tbody>
      </table>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={enterKey}>🔑 Enter / Renew License Key</button>
        <button className="btn" onClick={copyMachine}>Copy Machine ID</button>
        <button className="btn" onClick={load}>Refresh (F5)</button>
      </div>

      {(lic.state === 'expiring' || lic.state === 'expired') && (
        <div className={'alert ' + (lic.state === 'expired' ? 'alert-danger' : '')} style={{ marginTop: 16 }}>
          {lic.state === 'expired'
            ? '🔒 Your license has expired and the app is in read-only mode. Renew now to continue billing.'
            : `⏳ Your license expires in ${lic.daysLeft} day(s). Contact RightServe to renew in time.`}
        </div>
      )}

      <SupportBox />
    </div>
  );
}

function SupportBox() {
  return (
    <>
      <div className="entry-sec" style={{ marginTop: 20 }}>Need a license or renewal?</div>
      <div className="lic-support">
        <p>Contact <b>RightServe</b> to purchase, renew or transfer your license:</p>
        <p>📧 <a href={'mailto:' + SUPPORT.email}>{SUPPORT.email}</a></p>
        <p>📞 {SUPPORT.phone}</p>
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          For a computer-locked key, share your <b>Machine ID</b> (above) when requesting the license.
        </p>
      </div>
    </>
  );
}
