import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, openPdfPost } from '../api/client';
import { Modal, useToast } from '../components/ui';
import { ListScreen } from '../components/ListScreen';
import { useScreenSetup } from '../components/TallyFrame';
import { useHotkeys, useEnterNav } from '../keyboard';
import { useAuth, isAdmin } from '../auth';
import { useBusiness } from '../business';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// The 6 redesigned tax-invoice formats (named per the reference software look).
const BILL_FORMATS = [
  ['format1', 'Format 1 · Vyapar', 'Colourful band header, modern'],
  ['format2', 'Format 2 · Marg', 'Navy framed, distribution style'],
  ['format3', 'Format 3 · Miracle', 'Teal line header, clean'],
  ['format4', 'Format 4 · Tally', 'Classic boxed B/W GST invoice'],
  ['format5', 'Format 5 · Busy', 'Boxed with tinted headers'],
  ['format6', 'Format 6 · Zoho', 'Minimal, spacious, elegant'],
];
// Map any legacy saved format value onto the new set.
const FORMAT_MAP = { classic: 'format4', tally: 'format4', vyapar: 'format1', marg: 'format2', modern: 'format6', compact: 'format3' };
const normFormat = (v) => (BILL_FORMATS.some(([id]) => id === v) ? v : (FORMAT_MAP[v] || 'format1'));

// Terms may arrive as a JSON array, a newline string, or undefined.
function parseTermsList(raw) {
  if (Array.isArray(raw)) return raw.map((s) => String(s)).filter((s) => s.trim());
  if (typeof raw === 'string' && raw.trim()) {
    try { const p = JSON.parse(raw); if (Array.isArray(p)) return p.map(String).filter((s) => s.trim()); } catch (_) {}
    return raw.split('\n').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export default function Businesses() {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { reload: reloadBiz, switchTo, activeId } = useBusiness();
  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(null);
  const [showInactive, setShowInactive] = useState(false);

  const load = () => api.get('/businesses?all=1').then(setList).catch(() => {});
  useEffect(() => { load(); }, []);
  useEffect(() => { if (user && !isAdmin(user)) nav('/'); }, [user]);

  const makeDefault = async (row) => {
    try { await api.post(`/businesses/${row.id}/default`); toast(`"${row.name}" is now the default business`); load(); reloadBiz(); }
    catch (e) { toast(e.message); }
  };

  const toggleActive = async (row) => {
    if (row.active) {
      if (!confirm(`Mark "${row.name}" as INACTIVE? It will be hidden from business selection and cannot be used for new sales, purchases or payments.`)) return;
      try { await api.del('/businesses/' + row.id); toast(`"${row.name}" marked inactive`); load(); reloadBiz(); }
      catch (e) { toast(e.message); }
    } else {
      try { await api.put('/businesses/' + row.id, { active: 1 }); toast(`"${row.name}" reactivated`); load(); reloadBiz(); }
      catch (e) { toast(e.message); }
    }
  };

  useScreenSetup({
    title: 'Business Profiles', sub: `${list.filter((b) => b.active).length} active`,
    buttons: [
      { key: 'f5', label: 'F5', text: 'New Business', onClick: () => setEditing({ fy_start_month: 4, invoice_prefix: 'INV' }) },
      { sep: true },
      { key: 'escape', label: 'Esc', text: 'Dashboard', onClick: () => nav('/') },
    ],
  }, [list]);
  useHotkeys({ escape: () => nav('/'), f5: () => setEditing({ fy_start_month: 4, invoice_prefix: 'INV' }) }, [nav]);

  const rows = showInactive ? list : list.filter((b) => b.active);

  return (
    <>
      <div className="filterbar" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span className="muted">F5 = add business • Click a row to edit • Set one as default • Mark inactive to stop new transactions</span>
        <label style={{ marginLeft: 'auto', fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
        </label>
      </div>
      <ListScreen
        rows={rows} onEnter={(r) => setEditing(r)} deps={[showInactive, list]}
        emptyIcon="🏢" emptyText="No businesses."
        columns={[
          { key: 'name', label: 'Business', render: (r) => (
            <span><b>{r.name}</b>{r.id === activeId && <span className="badge badge-primary" style={{ marginLeft: 8 }}>current</span>}</span>
          ) },
          { key: 'gstin', label: 'GSTIN', render: (r) => r.gstin || <span className="muted">—</span> },
          { key: 'state', label: 'State', render: (r) => r.state || <span className="muted">—</span> },
          { key: 'invoice_count', label: 'Invoices', align: 'right', render: (r) => r.invoice_count ?? 0 },
          { key: 'is_default', label: 'Default', render: (r) => r.is_default ? <span className="badge badge-success">Default</span> : <span className="muted">—</span> },
          { key: 'active', label: 'Status', render: (r) => <span className={'badge ' + (r.active ? 'badge-success' : 'badge-muted')}>{r.active ? 'Active' : 'Inactive'}</span> },
          { key: 'act', label: '', align: 'right', render: (r) => (
            <span style={{ display: 'inline-flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
              <button className="btn btn-sm" onClick={() => setEditing(r)}>Edit</button>
              {r.active && r.id !== activeId && <button className="btn btn-sm" onClick={() => switchTo(r.id)}>Switch</button>}
              {r.active && !r.is_default && <button className="btn btn-sm" onClick={() => makeDefault(r)}>Set Default</button>}
              <button className="btn btn-sm" style={{ color: r.active ? 'var(--accent)' : 'var(--teal-dark)' }} onClick={() => toggleActive(r)}>
                {r.active ? 'Deactivate' : 'Reactivate'}
              </button>
            </span>
          ) },
        ]}
      />
      {editing && <BusinessForm biz={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); reloadBiz(); toast('Saved'); }} />}
    </>
  );
}

// Read an image file, downscale it to fit `max` px, and return a PNG/JPEG data
// URI (keeps the DB small). PNG kept for logo/signature/stamp to preserve
// transparency; large photos are re-encoded as JPEG.
function fileToDataUri(file, max = 480) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve('');
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return reject(new Error('Please upload a PNG or JPG image'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file'));
      img.onload = () => {
        let { width, height } = img;
        if (width > max || height > max) {
          const s = Math.min(max / width, max / height);
          width = Math.round(width * s); height = Math.round(height * s);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        // Preserve transparency (logo/signature/stamp) → PNG.
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Single upload+preview control for a branding image.
function ImageField({ label, hint, value, onChange }) {
  const toast = useToast();
  const pick = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try { onChange(await fileToDataUri(file)); }
    catch (err) { toast(err.message || 'Could not load image'); }
    e.target.value = '';
  };
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{label}</div>
      <div style={{ height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa', borderRadius: 6, marginBottom: 8, overflow: 'hidden' }}>
        {value
          ? <img src={value} alt={label} style={{ maxHeight: 84, maxWidth: '100%', objectFit: 'contain' }} />
          : <span className="muted" style={{ fontSize: 12 }}>{hint}</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
        <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
          {value ? 'Change' : 'Upload'}
          <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={pick} />
        </label>
        {value && <button type="button" className="btn btn-sm" style={{ color: 'var(--accent)' }} onClick={() => onChange('')}>Remove</button>}
      </div>
    </div>
  );
}

// A colour picker with an optional "Auto" (blank = use format default) state.
function ColorField({ value, onChange, allowClear = true }) {
  const has = /^#[0-9a-fA-F]{6}$/.test(value || '');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input type="color" value={has ? value : '#2563eb'} onChange={(e) => onChange(e.target.value)}
        style={{ width: 44, height: 30, padding: 2, border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }} />
      <span className="muted" style={{ fontSize: 12, minWidth: 92 }}>{has ? value : (allowClear ? 'Auto (default)' : '—')}</span>
      {allowClear && has && <button type="button" className="btn btn-sm" onClick={() => onChange('')}>Clear</button>}
    </div>
  );
}

function BusinessForm({ biz, onClose, onSaved }) {
  const toast = useToast();
  const enterNav = useEnterNav();
  const isNew = !biz.id;
  const [f, setF] = useState({
    name: biz.name || '', gstin: biz.gstin || '', phone: biz.phone || '', email: biz.email || '',
    address: biz.address || '', state: biz.state || '', state_code: biz.state_code || '',
    pan: biz.pan || '', udyam: biz.udyam || '', cin: biz.cin || '',
    invoice_prefix: biz.invoice_prefix || 'INV', terms: biz.terms || 'Goods once sold will not be taken back.',
    fy_start_month: biz.fy_start_month || 4, is_default: !!biz.is_default,
    logo: '', signature: '', stamp: '',
    bank_name: biz.bank_name || '', bank_account: biz.bank_account || '', bank_ifsc: biz.bank_ifsc || '',
    bank_branch: biz.bank_branch || '', account_holder: biz.account_holder || '', upi_id: biz.upi_id || '',
    qr_image: '', bill_terms: biz.bill_terms || '', bill_format: biz.bill_format || 'format1',
    bill_color: biz.bill_color || '#2563eb',
    bill_header_bg: biz.bill_header_bg || '', bill_header_fg: biz.bill_header_fg || '',
    bill_table_bg: biz.bill_table_bg || '', bill_table_fg: biz.bill_table_fg || '',
    bill_total_bg: biz.bill_total_bg || '', bill_total_fg: biz.bill_total_fg || '',
    bill_title: biz.bill_title || '', bill_signatory: biz.bill_signatory || '',
    bill_billto_label: biz.bill_billto_label || '', bill_terms_heading: biz.bill_terms_heading || '',
    bill_declaration: biz.bill_declaration || '', bill_footer_note: biz.bill_footer_note || '',
    bill_terms_list: parseTermsList(biz.bill_terms_list),
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setImg = (k) => (v) => setF((cur) => ({ ...cur, [k]: v }));

  // The list endpoint strips image data — fetch the full record when editing so
  // existing images + bank details show up and aren't wiped on save.
  useEffect(() => {
    if (biz.id) {
      api.get('/businesses/' + biz.id).then((full) => {
        setF((cur) => ({
          ...cur,
          logo: full.logo || '', signature: full.signature || '', stamp: full.stamp || '', qr_image: full.qr_image || '',
          bank_name: full.bank_name || '', bank_account: full.bank_account || '', bank_ifsc: full.bank_ifsc || '',
          bank_branch: full.bank_branch || '', account_holder: full.account_holder || '', upi_id: full.upi_id || '',
          pan: full.pan || '', udyam: full.udyam || '', cin: full.cin || '',
          bill_terms: full.bill_terms || '', bill_format: normFormat(full.bill_format), bill_color: full.bill_color || '#2563eb',
          bill_header_bg: full.bill_header_bg || '', bill_header_fg: full.bill_header_fg || '',
          bill_table_bg: full.bill_table_bg || '', bill_table_fg: full.bill_table_fg || '',
          bill_total_bg: full.bill_total_bg || '', bill_total_fg: full.bill_total_fg || '',
          bill_title: full.bill_title || '', bill_signatory: full.bill_signatory || '',
          bill_billto_label: full.bill_billto_label || '', bill_terms_heading: full.bill_terms_heading || '',
          bill_declaration: full.bill_declaration || '', bill_footer_note: full.bill_footer_note || '',
          bill_terms_list: parseTermsList(full.bill_terms_list),
        }));
      }).catch(() => {});
    }
  }, [biz.id]);

  // Serialize the terms list to JSON for the API.
  const payload = () => ({ ...f, bill_terms_list: JSON.stringify((f.bill_terms_list || []).map((s) => String(s).trim()).filter(Boolean)) });
  const save = async () => {
    if (!f.name.trim()) return toast('Business name is required');
    try {
      if (isNew) await api.post('/businesses', payload());
      else await api.put('/businesses/' + biz.id, payload());
      onSaved();
    } catch (e) { toast(e.message); }
  };
  // Open a sample invoice PDF in the chosen design (uses current form values).
  const previewFormat = async (fmt) => {
    try { await openPdfPost('/pdf/invoice-preview?format=' + fmt, { ...payload(), bill_format: fmt }); }
    catch (e) { toast(e.message || 'Could not open preview'); }
  };
  // Terms list editing helpers (add / edit / remove rows).
  const terms = f.bill_terms_list || [];
  const setTerm = (i, v) => setF({ ...f, bill_terms_list: terms.map((t, idx) => (idx === i ? v : t)) });
  const addTerm = () => setF({ ...f, bill_terms_list: [...terms, ''] });
  const removeTerm = (i) => setF({ ...f, bill_terms_list: terms.filter((_, idx) => idx !== i) });
  useHotkeys({ 'ctrl+a': save }, [f], { modal: true });

  return (
    <Modal size="lg" title={isNew ? 'New Business' : 'Edit Business'} onClose={onClose} onAccept={save}
      footer={<><span className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>Ctrl+A = save · Esc = cancel</span><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" data-accept="1" onClick={save}>💾 Save Business</button></>}>
      <div className="entry" onKeyDown={enterNav}>
        <div className="entry-sec">Business Profile</div>
        <div className="entry-grid two">
          <label>Business Name *</label><input className="fld" value={f.name} onChange={set('name')} autoFocus />
          <label>GSTIN</label><input className="fld" value={f.gstin} onChange={set('gstin')} />
          <label>Phone</label><input className="fld" value={f.phone} onChange={set('phone')} />
          <label>Email</label><input className="fld" value={f.email} onChange={set('email')} />
          <label>Address</label><input className="fld" value={f.address} onChange={set('address')} />
          <label>State</label><input className="fld" value={f.state} onChange={set('state')} />
          <label>State Code</label><input className="fld" value={f.state_code} onChange={set('state_code')} />
          <label>PAN</label><input className="fld" value={f.pan} onChange={set('pan')} placeholder="e.g. ABCPM9909M" />
          <label>UDYAM / MSME</label><input className="fld" value={f.udyam} onChange={set('udyam')} placeholder="e.g. UDYAM-DL-10-0006027" />
          <label>CIN</label><input className="fld" value={f.cin} onChange={set('cin')} placeholder="optional" />
          <label>Invoice Prefix</label><input className="fld" value={f.invoice_prefix} onChange={set('invoice_prefix')} />
          <label>Financial Year Start</label>
          <select className="fld" value={f.fy_start_month} onChange={set('fy_start_month')}>
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <label>Terms &amp; Conditions</label><input className="fld" value={f.terms} onChange={set('terms')} />
        </div>

        <div className="entry-sec" style={{ marginTop: 16 }}>Bill Branding <span className="muted" style={{ fontWeight: 400 }}>· shown on invoices &amp; bills (PNG/JPG)</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
          <ImageField label="Business Logo" hint="Top of the bill" value={f.logo} onChange={setImg('logo')} />
          <ImageField label="Signature" hint="Authorised signatory" value={f.signature} onChange={setImg('signature')} />
          <ImageField label="Stamp / Seal" hint="Company stamp" value={f.stamp} onChange={setImg('stamp')} />
          <ImageField label="Payment QR" hint="Or set UPI ID below" value={f.qr_image} onChange={setImg('qr_image')} />
        </div>

        <div className="entry-sec" style={{ marginTop: 16 }}>Bank &amp; Payment Details <span className="muted" style={{ fontWeight: 400 }}>· printed on bills</span></div>
        <div className="entry-grid two">
          <label>Bank Name</label><input className="fld" value={f.bank_name} onChange={set('bank_name')} />
          <label>Account Holder</label><input className="fld" value={f.account_holder} onChange={set('account_holder')} />
          <label>Account No</label><input className="fld" value={f.bank_account} onChange={set('bank_account')} />
          <label>IFSC</label><input className="fld" value={f.bank_ifsc} onChange={set('bank_ifsc')} />
          <label>Branch</label><input className="fld" value={f.bank_branch} onChange={set('bank_branch')} />
          <label>UPI ID</label><input className="fld" value={f.upi_id} onChange={set('upi_id')} placeholder="name@bank — auto-generates a pay QR" />
        </div>

        <div className="entry-sec" style={{ marginTop: 16 }}>Tax Invoice Format <span className="muted" style={{ fontWeight: 400 }}>· pick a design; all support Trade/CD/SD &amp; multi-page</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 10 }}>
          {BILL_FORMATS.map(([id, name, desc]) => (
            <label key={id} style={{ border: '2px solid ' + (f.bill_format === id ? 'var(--teal)' : 'var(--border)'), borderRadius: 8, padding: 10, cursor: 'pointer', background: f.bill_format === id ? 'var(--teal-soft)' : 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                <input type="radio" name="bill_format" checked={f.bill_format === id} onChange={() => setF({ ...f, bill_format: id })} /> {name}
              </div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>{desc}</div>
              <button type="button" className="btn btn-sm" style={{ marginTop: 6, fontSize: 11, padding: '2px 8px' }}
                onClick={(e) => { e.preventDefault(); previewFormat(id); }}>👁 Preview</button>
            </label>
          ))}
        </div>

        <div className="entry-sec" style={{ marginTop: 16 }}>Invoice Colours <span className="muted" style={{ fontWeight: 400 }}>· leave blank to use the format's default</span></div>
        <div className="entry-grid two">
          <label>Accent Colour</label>
          <ColorField value={f.bill_color} onChange={(v) => setF({ ...f, bill_color: v })} allowClear={false} />
          <label>Header Background</label>
          <ColorField value={f.bill_header_bg} onChange={(v) => setF({ ...f, bill_header_bg: v })} />
          <label>Header Text</label>
          <ColorField value={f.bill_header_fg} onChange={(v) => setF({ ...f, bill_header_fg: v })} />
          <label>Table Header Background</label>
          <ColorField value={f.bill_table_bg} onChange={(v) => setF({ ...f, bill_table_bg: v })} />
          <label>Table Header Text</label>
          <ColorField value={f.bill_table_fg} onChange={(v) => setF({ ...f, bill_table_fg: v })} />
          <label>Grand Total Background</label>
          <ColorField value={f.bill_total_bg} onChange={(v) => setF({ ...f, bill_total_bg: v })} />
          <label>Grand Total Text</label>
          <ColorField value={f.bill_total_fg} onChange={(v) => setF({ ...f, bill_total_fg: v })} />
        </div>

        <div className="entry-sec" style={{ marginTop: 16 }}>Invoice Texts <span className="muted" style={{ fontWeight: 400 }}>· customise labels &amp; wording on the bill</span></div>
        <div className="entry-grid two">
          <label>Invoice Title</label><input className="fld" value={f.bill_title} onChange={set('bill_title')} placeholder="TAX INVOICE" />
          <label>&quot;Bill To&quot; Label</label><input className="fld" value={f.bill_billto_label} onChange={set('bill_billto_label')} placeholder="Bill To" />
          <label>Authorised Signatory</label><input className="fld" value={f.bill_signatory} onChange={set('bill_signatory')} placeholder="Authorised Signatory / Proprietor / Partner" />
          <label>Terms Heading</label><input className="fld" value={f.bill_terms_heading} onChange={set('bill_terms_heading')} placeholder="Terms & Conditions" />
          <label>Declaration</label><input className="fld" value={f.bill_declaration} onChange={set('bill_declaration')} placeholder="We declare that this invoice shows the actual price…" />
          <label>Footer Note</label><input className="fld" value={f.bill_footer_note} onChange={set('bill_footer_note')} placeholder="Thank you for your business!" />
        </div>

        <div className="entry-sec" style={{ marginTop: 16 }}>Terms &amp; Conditions <span className="muted" style={{ fontWeight: 400 }}>· printed as a numbered list</span></div>
        <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
          {terms.length === 0 && <div className="muted" style={{ fontSize: 13 }}>No terms yet. Add your first condition below.</div>}
          {terms.map((t, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="muted" style={{ width: 18, textAlign: 'right' }}>{i + 1}.</span>
              <input className="fld" style={{ flex: 1 }} value={t} onChange={(e) => setTerm(i, e.target.value)} placeholder="e.g. Goods once sold will not be taken back." />
              <button type="button" className="btn btn-sm" style={{ color: 'var(--accent)' }} onClick={() => removeTerm(i)}>✕</button>
            </div>
          ))}
          <div><button type="button" className="btn btn-sm" onClick={addTerm}>＋ Add Term</button></div>
        </div>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, fontSize: 14 }}>
          <input type="checkbox" checked={f.is_default} onChange={(e) => setF({ ...f, is_default: e.target.checked })} />
          Set as default business (used automatically when nothing else is selected)
        </label>
      </div>
    </Modal>
  );
}
