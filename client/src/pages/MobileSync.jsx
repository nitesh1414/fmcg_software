import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, downloadFile } from '../api/client';
import { useToast } from '../components/ui';
import { useScreenSetup } from '../components/TallyFrame';
import { useHotkeys } from '../keyboard';

// Human-readable one-line summary of merge stats (mirrors the mobile app).
function summarizeStats(stats) {
  const added = Object.entries((stats && stats.added) || {}).filter(([, n]) => n > 0);
  const total = added.reduce((a, [, n]) => a + n, 0);
  if (total === 0) return 'Already up to date — no new records found.';
  const parts = added.map(([tbl, n]) => `${n} ${tbl.replace(/_/g, ' ')}`);
  return `Added ${parts.join(', ')}.`;
}

const copyText = async (text) => {
  try { await navigator.clipboard.writeText(text); return true; } catch (_) { return false; }
};

// System → Mobile App Sync.
// Lets the FMCG mobile app (RightServe FMCG Suite) sync its data with this
// portal — over Wi-Fi (network sync with an API key) or via a sync package
// file (offline transfer). The phone's Settings → Desktop Sync screen is the
// counterpart of this page.
export default function MobileSync() {
  const toast = useToast();
  const nav = useNavigate();
  const [st, setSt] = useState(null);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState('');
  const [lastResult, setLastResult] = useState('');
  const [selectedUrl, setSelectedUrl] = useState('');
  const [lanTest, setLanTest] = useState(null);
  const fileRef = useRef(null);

  const load = () => api.get('/sync/status').then(setSt).catch((e) => toast(e.message || 'Could not load sync status'));
  useEffect(() => { load(); }, []); // eslint-disable-line
  useEffect(() => {
    if (!st) return;
    const next = st.urls || [];
    setSelectedUrl((prev) => (next.includes(prev) ? prev : (next[0] || '')));
  }, [st]);

  useScreenSetup({
    title: 'Mobile App Sync',
    sub: 'Sync data between this portal and the RightServe FMCG mobile app',
    buttons: [
      { key: 'escape', label: 'Esc', text: 'Dashboard', onClick: () => nav('/') },
    ],
  }, []);
  useHotkeys({ escape: () => nav('/') }, [nav]);

  const enable = async () => {
    setBusy('enable');
    try { setSt(await api.post('/sync/enable', {})); toast('Mobile Sync enabled — share the portal URL & API key with the phone'); }
    catch (e) { toast(e.message || 'Could not enable sync'); }
    finally { setBusy(''); }
  };
  const disable = async () => {
    if (!confirm('Disable Mobile Sync?\nThe phone will no longer be able to pull or push data until you enable it again.')) return;
    setBusy('disable');
    try { setSt(await api.post('/sync/disable', {})); toast('Mobile Sync disabled'); }
    catch (e) { toast(e.message || 'Could not disable sync'); }
    finally { setBusy(''); }
  };
  const regenerate = async () => {
    if (!confirm('Generate a new API key?\nThe old key stops working immediately — you will need to update it on the phone.')) return;
    setBusy('regen');
    try { setSt(await api.post('/sync/regenerate', {})); toast('New API key generated'); }
    catch (e) { toast(e.message || 'Could not regenerate key'); }
    finally { setBusy(''); }
  };

  const copy = async (text, label) => {
    const ok = await copyText(text);
    toast(ok ? label + ' copied' : 'Copy failed — select and copy manually');
  };

  const testLanAddress = async () => {
    if (!selectedUrl) {
      toast('No LAN address to test — connect this PC to Wi-Fi or Ethernet');
      return;
    }
    setBusy('test');
    setLanTest(null);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const headers = {};
      if (st && st.apiKey) headers.Authorization = 'Bearer ' + st.apiKey;
      const res = await fetch(selectedUrl.replace(/\/+$/, '') + '/api/sync/ping', { headers, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = body.enabled === false
          ? 'Address is reachable, but Mobile Sync is disabled — enable it above.'
          : 'This PC can reach the portal on that address. If the phone still fails, allow RightServe through Windows Firewall and turn off Wi-Fi “AP/client isolation”.';
        setLanTest({ ok: true, message: msg });
        toast('LAN address is reachable from this PC');
      } else {
        const msg = `Portal responded HTTP ${res.status}` + (res.status === 401 ? ' — check the API key on the phone.' : '');
        setLanTest({ ok: false, message: msg });
        toast(msg);
      }
    } catch (e) {
      const msg = 'This PC could not open that address. Pick another URL from the list, or restart RightServe so it listens on 0.0.0.0.';
      setLanTest({ ok: false, message: msg });
      toast(msg);
    } finally {
      setBusy('');
    }
  };

  const exportFile = async () => {
    setBusy('export');
    try {
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      await downloadFile('/sync/export', `RightServe_Sync_${stamp}.json`);
      setLastResult('Sync package downloaded — send it to the phone and import it there (Mobile app → Settings → Desktop Sync → Import File).');
      toast('Sync package downloaded');
    } catch (e) { toast(e.message || 'Export failed'); }
    finally { setBusy(''); }
  };

  const importFile = async (file) => {
    if (!file) return;
    setBusy('import');
    try {
      const text = await file.text();
      let body;
      try { body = JSON.parse(text); } catch (_) { throw new Error('The file is not valid JSON.'); }
      const r = await api.post('/sync/import', body);
      const msg = summarizeStats(r.stats);
      setLastResult(`Imported file from ${r.importedFrom || 'mobile'}. ${msg}`);
      toast(msg);
    } catch (e) { toast(e.message || 'Import failed'); }
    finally { setBusy(''); if (fileRef.current) fileRef.current.value = ''; }
  };

  if (!st) return <div className="muted" style={{ padding: 20 }}>Loading…</div>;

  const urls = st.urls || [];
  const primaryUrl = selectedUrl || (urls[0] || '');

  return (
    <div className="entry">
      <div className="entry-sec">Network Sync (phone ⇄ desktop over Wi-Fi)</div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 10, maxWidth: 760 }}>
        The <b>RightServe FMCG mobile app</b> can sync its data with this portal — pull the desktop's
        items, parties, invoices and stock, or push bills created on the phone. Merging is
        <b> non-destructive</b>: existing records are kept and only missing ones are added.
      </p>

      <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', maxWidth: 760, background: 'var(--panel, #fafafa)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Mobile Sync</span>
          <span className={'badge ' + (st.enabled ? 'badge-success' : 'badge-muted')}>{st.enabled ? 'Enabled' : 'Disabled'}</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {!st.enabled
              ? <button className="btn btn-primary" disabled={busy === 'enable'} onClick={enable}>{busy === 'enable' ? 'Enabling…' : 'Enable Mobile Sync'}</button>
              : <button className="btn" style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }} disabled={busy === 'disable'} onClick={disable}>{busy === 'disable' ? 'Disabling…' : 'Disable'}</button>}
          </span>
        </div>

        {st.enabled && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label className="muted" style={{ fontSize: 12 }}>Portal URL — paste this on the phone (Settings → Desktop Sync). Include the port. Do not use localhost or 127.0.0.1.</label>
              {urls.length === 0 ? (
                <div className="alert" style={{ background: '#fff7e6', border: '1px solid var(--border)', marginTop: 6, fontSize: 12.5, maxWidth: 700 }}>
                  ⚠ No Wi-Fi / Ethernet IPv4 address found on this computer. Connect this PC to the same network as the phone, then reload this page.
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input className="fld" readOnly value={primaryUrl} style={{ maxWidth: 320, fontFamily: 'monospace' }} onFocus={(e) => e.target.select()} />
                  <button className="btn btn-sm" onClick={() => copy(primaryUrl, 'Portal URL')}>Copy</button>
                  {urls.length > 1 && (
                    <select
                      className="fld"
                      style={{ maxWidth: 260 }}
                      value={primaryUrl}
                      onChange={(e) => setSelectedUrl(e.target.value)}
                      title="Other network addresses of this computer — pick the Wi-Fi/LAN one the phone can reach"
                    >
                      {urls.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  )}
                  <button className="btn btn-sm" disabled={busy === 'test'} onClick={testLanAddress}>{busy === 'test' ? 'Testing…' : 'Test this address'}</button>
                </div>
              )}
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                Listening on <code>{st.listenHost || '?'}:{st.listenPort || '?'}</code>
                {st.lanBound ? ' (phones on this Wi-Fi can connect)' : ' (this computer only)'}
              </div>
              {lanTest && (
                <div className="alert" style={{ background: lanTest.ok ? '#e8f5e9' : '#fff7e6', border: '1px solid var(--border)', marginTop: 6, fontSize: 12.5, maxWidth: 700 }}>
                  {lanTest.ok ? '✓' : '⚠'} {lanTest.message}
                </div>
              )}
              {!st.lanBound && (
                <div className="alert" style={{ background: '#fff7e6', border: '1px solid var(--border)', marginTop: 6, fontSize: 12.5, maxWidth: 700 }}>
                  ⚠ The server is listening on <b>127.0.0.1</b> (this computer only), so the phone cannot connect even on the same Wi-Fi.
                  Restart RightServe, or start the web server with <code>HOST=0.0.0.0 npm start</code>.
                </div>
              )}
            </div>
            <div>
              <label className="muted" style={{ fontSize: 12 }}>API Key — required on the phone (Authorization: Bearer). Not optional when sync is on.</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input className="fld" readOnly type={showKey ? 'text' : 'password'} value={st.apiKey} style={{ maxWidth: 320, fontFamily: 'monospace' }} onFocus={(e) => e.target.select()} />
                <button className="btn btn-sm" onClick={() => setShowKey(!showKey)}>{showKey ? 'Hide' : 'Show'}</button>
                <button className="btn btn-sm" onClick={() => copy(st.apiKey, 'API key')}>Copy</button>
                <button className="btn btn-sm" disabled={busy === 'regen'} onClick={regenerate}>Regenerate</button>
              </div>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              Last push from phone: <b>{st.lastPushAt ? new Date(st.lastPushAt).toLocaleString() : 'never'}</b>
              {' · '}Last pull by phone: <b>{st.lastPullAt ? new Date(st.lastPullAt).toLocaleString() : 'never'}</b>
            </div>
          </div>
        )}
      </div>

      <div className="entry-sec" style={{ marginTop: 18 }}>How to sync from the phone</div>
      <ol className="muted" style={{ fontSize: 13, maxWidth: 760, margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
        <li>Enable Mobile Sync above, then copy the <b>Portal URL</b> (e.g. <code>http://192.168.1.5:4000</code>) and the <b>API Key</b>.</li>
        <li>Phone and this PC must be on the <b>same Wi-Fi</b> (not a guest network / AP isolation).</li>
        <li>On the phone, open the FMCG app → <b>More → Settings → Desktop Sync</b>.</li>
        <li>Paste the URL and key (the key is required), then tap <b>Test Connection</b>.</li>
        <li>Use <b>Pull</b> (desktop → phone), <b>Push</b> (phone → desktop) or <b>Full Sync</b> (both ways).</li>
      </ol>
      <p className="muted" style={{ fontSize: 12, maxWidth: 760, marginTop: 8, lineHeight: 1.6 }}>
        If Test Connection says the portal is not reachable: (1) use the Wi-Fi IP above, never localhost;
        (2) include the port; (3) allow RightServe / Node.js through Windows Firewall (Private networks);
        (4) on Android, the app must allow HTTP (cleartext) to local IPs — debug builds already do.
      </p>

      <div className="entry-sec" style={{ marginTop: 18 }}>Sync by File (offline — no network needed)</div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 10, maxWidth: 760 }}>
        When both devices aren't on the same network, move a <b>sync package file</b> instead
        (WhatsApp / email / cable). The same <code>rightserve-sync/1</code> format works both ways.
      </p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={busy === 'export'} onClick={exportFile}>{busy === 'export' ? 'Packaging…' : '⬇ Download Sync Package (.json)'}</button>
        <button className="btn" disabled={busy === 'import'} onClick={() => fileRef.current && fileRef.current.click()}>{busy === 'import' ? 'Importing…' : '⬆ Import Sync Package from Phone…'}</button>
        <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(e) => importFile(e.target.files && e.target.files[0])} />
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 8, maxWidth: 760 }}>
        Export on this portal and import on the phone, or export on the phone (Desktop Sync → Export File)
        and import it here. Importing <b>merges</b> — it never overwrites or deletes existing records.
      </p>

      {lastResult && (
        <div className="alert" style={{ background: '#e8f5e9', border: '1px solid #a5d6a7', marginTop: 12, maxWidth: 760, fontSize: 13 }}>
          ✓ {lastResult}
        </div>
      )}

      {st.enabled && (
        <p className="muted" style={{ fontSize: 12, marginTop: 16, maxWidth: 760 }}>
          Data now on this portal: {st.counts.invoices} invoices · {st.counts.items} items · {st.counts.parties} parties · {st.counts.payments} payments.
        </p>
      )}
    </div>
  );
}
