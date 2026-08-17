import { useState } from 'react';
import { api } from '../api';
import { Modal } from '../components.jsx';

// Generate or renew a license for a client. If renewOf is set, calls the renew endpoint.
export default function LicenseForm({ clientObj, renewOf, onClose, onDone }) {
  const [plan, setPlan] = useState('Standard');
  const [duration, setDuration] = useState('365'); // '365' | '730' | 'custom-days' | 'custom-date' | 'never'
  const [customDays, setCustomDays] = useState('30');
  const [customDate, setCustomDate] = useState('');
  const [machine, setMachine] = useState('');
  const [reminder, setReminder] = useState('15');
  const [notes, setNotes] = useState('');
  const [carryOver, setCarryOver] = useState(true);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr('');
    const body = { plan, reminderDays: Number(reminder), machine: machine.trim(), notes };
    if (renewOf) body.carryOver = carryOver;
    if (duration === 'never') body.never = true;
    else if (duration === 'custom-days') body.days = Number(customDays);
    else if (duration === 'custom-date') { if (!customDate) { setErr('Pick an expiry date'); return; } body.expires = customDate; }
    else body.days = Number(duration);

    setBusy(true);
    try {
      let lic;
      if (renewOf) lic = await api.post('/licenses/' + renewOf + '/renew', body);
      else lic = await api.post('/licenses', { client_id: clientObj.id, ...body });
      onDone(lic);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal title={(renewOf ? 'Renew License — ' : 'Generate License — ') + clientObj.business_name} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Generating…' : (renewOf ? 'Renew & Generate Key' : 'Generate Key')}</button></>}>
      {err && <div className="err">{err}</div>}
      <div className="grid2">
        <div className="field"><label>Plan</label>
          <select value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option>Standard</option><option>Premium</option><option>Lite</option>
          </select></div>
        <div className="field"><label>Validity</label>
          <select value={duration} onChange={(e) => setDuration(e.target.value)}>
            <option value="365">1 Year</option>
            <option value="730">2 Years</option>
            <option value="90">3 Months</option>
            <option value="custom-days">Custom (days)</option>
            <option value="custom-date">Until a date</option>
            <option value="never">Lifetime (never expires)</option>
          </select></div>
      </div>
      {duration === 'custom-days' && (
        <div className="field"><label>Number of days</label><input type="number" value={customDays} onChange={(e) => setCustomDays(e.target.value)} /></div>
      )}
      {duration === 'custom-date' && (
        <div className="field"><label>Expiry date</label><input type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)} /></div>
      )}
      <div className="grid2">
        <div className="field"><label>Reminder (days before expiry)</label><input type="number" value={reminder} onChange={(e) => setReminder(e.target.value)} /></div>
        <div className="field"><label>Lock to Machine ID (optional)</label>
          <input placeholder="XXXX-XXXX-XXXX-XXXX" value={machine} onChange={(e) => setMachine(e.target.value.toUpperCase())} /></div>
      </div>
      {renewOf && (
        <div className="field" style={{ background: 'var(--okbg)', border: '1px solid #6ee7b7', borderRadius: 8, padding: '10px 12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none', fontSize: 14 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={carryOver} onChange={(e) => setCarryOver(e.target.checked)} />
            Add the client's remaining (unused) days to the new term
          </label>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Recommended — if the client renews early, their leftover days are not wasted.
          </div>
        </div>
      )}
      <div className="field"><label>Notes (optional)</label><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      <p className="muted" style={{ fontSize: 12 }}>
        Leave Machine ID blank to allow any computer. For a computer-locked key, ask the client for the Machine ID shown on their RightServe activation screen.
      </p>
    </Modal>
  );
}
