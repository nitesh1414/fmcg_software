import { useState } from 'react';
import { api } from '../api';
import { Modal, Segmented, productLabel, expiryText } from '../components.jsx';

const DURATIONS = [
  { value: '365', label: '1 Year' },
  { value: '730', label: '2 Years' },
  { value: '90', label: '3 Months' },
  { value: 'custom-days', label: 'Custom (days)' },
  { value: 'custom-date', label: 'Until a date' },
  { value: 'never', label: 'Lifetime (never expires)' },
];

function initialDuration(lic) {
  if (!lic) return { duration: '365', customDate: '', customDays: '30' };
  if (lic.perpetual || !lic.expires) return { duration: 'never', customDate: '', customDays: '30' };
  return { duration: 'custom-date', customDate: lic.expires, customDays: '30' };
}

/**
 * One form for four jobs:
 *   mode="new"    issue a first (base) license — desktop, mobile or both
 *   mode="addon"  sell a second product later (desktop first → mobile add-on)
 *   mode="renew"  extend an existing license (keeps its product & add-on link)
 *   mode="edit"   correct a license — term/plan/machine changes RE-ISSUE the key
 */
export default function LicenseForm({ clientObj, mode = 'new', renewOf, license, parent, forceProduct, onClose, onDone }) {
  const owned = clientObj?.products || [];
  const missing = clientObj?.missing_products || ['desktop', 'mobile'];

  const isEdit = mode === 'edit';
  const isAddon = mode === 'addon';
  const isRenew = mode === 'renew';

  const [product, setProduct] = useState(
    forceProduct || (isEdit || isRenew ? (license?.product || 'desktop') : (isAddon ? (missing[0] || 'desktop') : 'desktop'))
  );
  const [plan, setPlan] = useState(license?.plan || parent?.plan || 'Standard');
  const d0 = initialDuration(isEdit || isRenew ? license : null);
  const [duration, setDuration] = useState(d0.duration);
  const [customDays, setCustomDays] = useState(d0.customDays);
  const [customDate, setCustomDate] = useState(d0.customDate);
  const [machine, setMachine] = useState(license?.machine || '');
  const [reminder, setReminder] = useState(String(license?.reminder_days ?? 15));
  const [notes, setNotes] = useState(license?.notes || '');
  const [carryOver, setCarryOver] = useState(true);
  const [matchBase, setMatchBase] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const baseLic = parent || clientObj?.licenses?.desktop || clientObj?.licenses?.mobile || null;

  const submit = async () => {
    setErr('');
    const body = { plan, reminderDays: Number(reminder), machine: machine.trim(), notes };

    if (matchBase && isAddon && baseLic) {
      // co-terminate: the server copies the base license's expiry onto the add-on
      body.matchBaseExpiry = true;
    } else if (duration === 'never') body.never = true;
    else if (duration === 'custom-days') body.days = Number(customDays);
    else if (duration === 'custom-date') {
      if (!customDate) { setErr('Pick an expiry date'); return; }
      body.expires = customDate;
    } else body.days = Number(duration);

    if (isRenew) body.carryOver = carryOver;

    setBusy(true);
    try {
      let out;
      if (isEdit) {
        out = await api.put('/licenses/' + license.id, {
          plan: body.plan, notes, reminder_days: body.reminderDays, machine: body.machine,
          product, days: body.days, expires: body.expires, never: body.never,
        });
      } else if (isRenew) {
        out = await api.post('/licenses/' + renewOf + '/renew', body);
      } else {
        out = await api.post('/licenses', {
          client_id: clientObj.id, product, kind: isAddon ? 'addon' : 'base',
          parent_id: isAddon && baseLic ? baseLic.id : undefined,
          matchBaseExpiry: body.matchBaseExpiry,
          plan: body.plan, days: body.days, expires: body.expires, never: body.never,
          machine: body.machine, reminderDays: body.reminderDays, notes,
        });
      }
      onDone(out);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const title =
    (isEdit ? 'Edit License — ' : isRenew ? 'Renew License — ' : isAddon ? 'Add-on License — ' : 'Generate License — ') +
    clientObj.business_name;

  const cta = isEdit ? 'Save Changes' : isRenew ? 'Renew & Generate Key' : isAddon ? 'Issue Add-on Key' : 'Generate Key';

  // A term/plan/machine change rewrites the signed key; notes & reminder do not.
  const willReissue = isEdit && (
    duration !== d0.duration ||
    (duration === 'custom-date' && customDate !== (license.expires || '')) ||
    (duration === 'custom-days') ||
    plan !== license.plan ||
    machine.trim().toUpperCase() !== (license.machine || '') ||
    product !== license.product
  );

  return (
    <Modal title={title} wide onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Working…' : cta}</button>
      </>}>
      {err && <div className="err">{err}</div>}

      {/* ---- who owns what today ---- */}
      <div className="info-box">
        <div style={{ fontWeight: 700, marginBottom: 6 }}>{clientObj.business_name} currently runs</div>
        <div className="tags">
          {['desktop', 'mobile'].map((p) => {
            const lic = (clientObj.licenses || {})[p];
            return (
              <span key={p} className={'badge ' + (lic ? 'active' : 'none')}>
                {productLabel(p)}{lic ? ` · ${expiryText(lic)}` : ' · not licensed'}
              </span>
            );
          })}
        </div>
      </div>

      {/* ---- product ---- */}
      {isAddon && (
        <div className="field">
          <label>Adding on to</label>
          <div className="info-box" style={{ marginBottom: 8 }}>
            {baseLic
              ? <>Base license <b className="mono">{baseLic.license_id}</b> · {productLabel(baseLic.product)} ·
                 {' '}{expiryText(baseLic)}{baseLic.kind === 'addon' ? ' (add-on)' : ''}</>
              : 'No base license found — the first product must be issued before an add-on.'}
          </div>
          <Segmented value={product} onChange={setProduct}
            options={['desktop', 'mobile'].map((p) => ({
              value: p, label: productLabel(p) + ' app',
              sub: owned.includes(p) ? 'already licensed' : 'not licensed yet',
              disabled: owned.includes(p),
            }))} />
          <div className="hint muted">One key per device — the add-on is a separate key for the other app.</div>
        </div>
      )}

      {!isAddon && !isRenew && (
        <div className="field"><label>Product</label>
          <Segmented value={product} onChange={setProduct} options={[
            { value: 'desktop', label: 'Desktop app', sub: owned.includes('desktop') ? 'already licensed' : 'standalone PC key' },
            { value: 'mobile', label: 'Mobile app', sub: owned.includes('mobile') ? 'already licensed' : 'phone key' },
            { value: 'both', label: 'Both', sub: 'two keys, same term' },
          ]} />
          <div className="hint muted">
            Each device needs its own key (activation locks one phone or one PC). The same business can hold both —
            buy desktop now and add mobile later from the client screen.
          </div>
          {owned.length > 0 && (
            <div className="err" style={{ marginTop: 8 }}>
              {clientObj.business_name} already has {owned.map(productLabel).join(' + ')}.
              Issuing the same product again needs a confirm — usually you want <b>Renew</b> or <b>Add-on</b> instead.
            </div>
          )}
        </div>
      )}

      {(isRenew || isEdit) && (
        <div className="field"><label>Product</label>
          <div className="info-box" style={{ marginBottom: 0 }}>
            {productLabel(license?.product)}{license?.kind === 'addon' ? ' · add-on' : ' · base license'} ·
            {' '}<span className="mono">{license?.license_id}</span>
            {isEdit && (
              <div className="hint muted">Changing the product mints a key for the other app — the current device will need the new key.</div>
            )}
            {isEdit && (
              <div style={{ marginTop: 8 }}>
                <Segmented value={product} onChange={setProduct}
                  options={['desktop', 'mobile'].map((p) => ({ value: p, label: productLabel(p) + ' app' }))} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---- term ---- */}
      <div className="grid2">
        <div className="field"><label>Plan</label>
          <select value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option>Standard</option><option>Premium</option><option>Lite</option>
          </select></div>
        <div className="field"><label>Validity</label>
          <select value={duration} onChange={(e) => setDuration(e.target.value)} disabled={matchBase && isAddon}>
            {DURATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select></div>
      </div>

      {matchBase && isAddon && baseLic && (
        <div className="checkrow">
          <input type="checkbox" id="matchBase" checked={matchBase} onChange={(e) => setMatchBase(e.target.checked)} />
          <label htmlFor="matchBase" style={{ textTransform: 'none', fontSize: 14, fontWeight: 600, margin: 0 }}>
            End on the same day as the base license ({expiryText(baseLic)})
            <div className="muted" style={{ fontSize: 12, fontWeight: 400, marginTop: 2 }}>
              Recommended — the client renews desktop &amp; mobile together in one go.
            </div>
          </label>
        </div>
      )}

      {duration === 'custom-days' && !(matchBase && isAddon) && (
        <div className="field"><label>Number of days</label><input type="number" min="1" value={customDays} onChange={(e) => setCustomDays(e.target.value)} /></div>
      )}
      {duration === 'custom-date' && !(matchBase && isAddon) && (
        <div className="field"><label>Expiry date</label><input type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)} /></div>
      )}

      <div className="grid2">
        <div className="field"><label>Reminder (days before expiry)</label>
          <input type="number" min="0" value={reminder} onChange={(e) => setReminder(e.target.value)} /></div>
        <div className="field"><label>Lock to Machine ID (optional)</label>
          <input placeholder="XXXX-XXXX-XXXX-XXXX" value={machine} onChange={(e) => setMachine(e.target.value.toUpperCase())}
            inputMode="text" autoCapitalize="characters" /></div>
      </div>

      {isRenew && (
        <div className="checkrow">
          <input type="checkbox" id="carry" checked={carryOver} onChange={(e) => setCarryOver(e.target.checked)} />
          <label htmlFor="carry" style={{ textTransform: 'none', fontSize: 14, fontWeight: 600, margin: 0 }}>
            Add the client's remaining (unused) days to the new term
            <div className="muted" style={{ fontSize: 12, fontWeight: 400, marginTop: 2 }}>
              Recommended — if the client renews early, their leftover days are not wasted.
            </div>
          </label>
        </div>
      )}

      {isEdit && (
        <div className={willReissue ? 'err' : 'info-box'}>
          {willReissue
            ? '⚠ This change alters the signed key — a NEW key will be generated. Send the new key to the client; the old one stops working.'
            : 'Notes and reminder days are portal records — saving these keeps the same key.'}
        </div>
      )}

      <div className="field"><label>Notes (optional)</label><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      <p className="muted" style={{ fontSize: 12 }}>
        Leave Machine ID blank to allow any device. For a device-locked key, ask the client for the Machine ID shown
        on their RightServe activation screen.
      </p>
    </Modal>
  );
}
