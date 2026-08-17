import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, openPdf, downloadFile } from '../api/client';
import { Modal, useToast, fmt } from '../components/ui';
import { ListScreen } from '../components/ListScreen';
import { useScreenSetup, usePrint } from '../components/TallyFrame';
import { useHotkeys, useEnterNav } from '../keyboard';
import { BusinessInline } from '../components/BusinessSwitcher';

const MODES = [['road', 'Road'], ['rail', 'Rail'], ['air', 'Air'], ['ship', 'Ship']];

export default function Eway() {
  const nav = useNavigate();
  const toast = useToast();
  const preview = usePrint();
  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = () => api.get('/eway').then(setList).catch(() => {});
  useEffect(() => { load(); }, []);

  const del = async (row) => {
    if (!confirm(`Delete E-Way Bill for ${row.doc_no || 'this document'}?`)) return;
    try { await api.del('/eway/' + row.id); toast('Deleted'); load(); } catch (e) { toast(e.message); }
  };
  const printSlip = (row) => {
    const path = '/pdf/eway/' + row.id;
    if (preview) preview(path, 'E-Way Bill ' + (row.doc_no || '')); else openPdf(path);
  };
  const downloadJson = (row) => downloadFile('/eway/' + row.id + '/json?download=1', `EWB_${row.doc_no || row.id}.json`).catch((e) => toast(e.message));

  useScreenSetup({
    title: 'E-Way Bills', sub: `${list.length} bill(s)`,
    buttons: [
      { key: 'f5', label: 'F5', text: 'New E-Way Bill', onClick: () => setEditing({}) },
      { sep: true },
      { key: 'escape', label: 'Esc', text: 'Dashboard', onClick: () => nav('/') },
    ],
  }, [list]);
  useHotkeys({ escape: () => nav('/'), f5: () => setEditing({}) }, [nav]);

  return (
    <>
      <div className="filterbar">
        <span className="muted">F5 = new e-way bill • Generate JSON for the GST portal • Print slip</span>
        <span style={{ marginLeft: 'auto' }}><BusinessInline label="For business" /></span>
      </div>
      <ListScreen
        rows={list} onEnter={(r) => setEditing(r)} onDelete={del} deps={[]}
        emptyIcon="🚚" emptyText="No e-way bills yet. Press F5 to create one."
        columns={[
          { key: 'doc_no', label: 'Document', render: (r) => <b>{r.doc_no || '—'}</b> },
          { key: 'ewb_no', label: 'EWB No', render: (r) => r.ewb_no || <span className="muted">draft</span> },
          { key: 'to_name', label: 'To', render: (r) => r.to_name || '—' },
          { key: 'vehicle_no', label: 'Vehicle', render: (r) => r.vehicle_no || '—' },
          { key: 'trans_distance', label: 'Dist (km)', align: 'right', render: (r) => r.trans_distance || 0 },
          { key: 'total_value', label: 'Value', align: 'right', render: (r) => fmt(r.total_value) },
          { key: 'status', label: 'Status', render: (r) => <span className={'badge ' + (r.status === 'generated' ? 'badge-success' : r.status === 'cancelled' ? 'badge-danger' : 'badge-muted')}>{r.status}</span> },
          { key: 'act', label: '', align: 'right', render: (r) => (
            <span style={{ display: 'inline-flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
              <button className="btn btn-sm" onClick={() => setEditing(r)}>Edit</button>
              <button className="btn btn-sm" onClick={() => printSlip(r)}>Print</button>
              <button className="btn btn-sm" onClick={() => downloadJson(r)}>JSON</button>
              <button className="btn btn-sm" style={{ color: 'var(--accent)' }} onClick={() => del(r)}>Del</button>
            </span>
          ) },
        ]}
      />
      {editing && <EwayForm row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); toast('Saved'); }} />}
    </>
  );
}

function EwayForm({ row, onClose, onSaved }) {
  const toast = useToast();
  const enterNav = useEnterNav();
  const isNew = !row.id;
  const [f, setF] = useState({
    ewb_no: '', ewb_date: today(), supply_type: 'O', sub_type: 'supply', doc_type: 'INV',
    doc_no: '', doc_date: today(), invoice_id: '',
    from_gstin: '', from_name: '', from_addr: '', from_place: '', from_pin: '', from_state: '',
    to_gstin: '', to_name: '', to_addr: '', to_place: '', to_pin: '', to_state: '',
    transporter_id: '', transporter_name: '', trans_mode: 'road', trans_distance: 0,
    trans_doc_no: '', trans_doc_date: '', vehicle_no: '', vehicle_type: 'R',
    total_value: 0, taxable_value: 0, cgst: 0, sgst: 0, igst: 0, notes: '', status: 'draft',
    ...row,
  });
  const [invoices, setInvoices] = useState([]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    api.get('/invoices?type=sale').then(setInvoices).catch(() => {});
  }, []);

  const prefill = async (invId) => {
    if (!invId) return;
    try {
      const d = await api.get('/eway/from-invoice/' + invId);
      setF((cur) => ({ ...cur, ...d }));
    } catch (e) { toast(e.message); }
  };

  const save = async () => {
    if (!f.doc_no.trim()) return toast('Document number is required');
    try {
      if (isNew) await api.post('/eway', f);
      else await api.put('/eway/' + row.id, f);
      onSaved();
    } catch (e) { toast(e.message); }
  };
  useHotkeys({ 'ctrl+a': save }, [f], { modal: true });

  return (
    <Modal size="lg" title={isNew ? 'New E-Way Bill' : 'Edit E-Way Bill'} onClose={onClose} onAccept={save}>
      <div className="entry" onKeyDown={enterNav}>
        <div className="entry-sec">Link Invoice (optional)</div>
        <div className="entry-grid two">
          <label>From Sales Invoice</label>
          <select className="fld" value={f.invoice_id || ''} onChange={(e) => { set('invoice_id')(e); prefill(e.target.value); }}>
            <option value="">— manual entry —</option>
            {invoices.map((i) => <option key={i.id} value={i.id}>{i.invoice_no} · {i.party_name || 'Walk-in'} · {fmt(i.total)}</option>)}
          </select>
          <label>EWB No (after portal)</label><input className="fld" value={f.ewb_no} onChange={set('ewb_no')} placeholder="e.g. 1234 5678 9012" />
        </div>

        <div className="entry-sec" style={{ marginTop: 14 }}>Document</div>
        <div className="entry-grid two">
          <label>Supply Type</label>
          <select className="fld" value={f.supply_type} onChange={set('supply_type')}><option value="O">Outward</option><option value="I">Inward</option></select>
          <label>Doc Type</label>
          <select className="fld" value={f.doc_type} onChange={set('doc_type')}><option value="INV">Tax Invoice</option><option value="BIL">Bill of Supply</option><option value="CHL">Delivery Challan</option></select>
          <label>Doc No *</label><input className="fld" value={f.doc_no} onChange={set('doc_no')} />
          <label>Doc Date</label><input className="fld" type="date" value={f.doc_date} onChange={set('doc_date')} />
        </div>

        <div className="entry-sec" style={{ marginTop: 14 }}>From (Consignor)</div>
        <div className="entry-grid two">
          <label>Name</label><input className="fld" value={f.from_name} onChange={set('from_name')} />
          <label>GSTIN</label><input className="fld" value={f.from_gstin} onChange={set('from_gstin')} />
          <label>Address</label><input className="fld" value={f.from_addr} onChange={set('from_addr')} />
          <label>Place</label><input className="fld" value={f.from_place} onChange={set('from_place')} />
          <label>Pincode</label><input className="fld" value={f.from_pin} onChange={set('from_pin')} />
          <label>State</label><input className="fld" value={f.from_state} onChange={set('from_state')} />
        </div>

        <div className="entry-sec" style={{ marginTop: 14 }}>To (Consignee)</div>
        <div className="entry-grid two">
          <label>Name</label><input className="fld" value={f.to_name} onChange={set('to_name')} />
          <label>GSTIN</label><input className="fld" value={f.to_gstin} onChange={set('to_gstin')} />
          <label>Address</label><input className="fld" value={f.to_addr} onChange={set('to_addr')} />
          <label>Place</label><input className="fld" value={f.to_place} onChange={set('to_place')} />
          <label>Pincode</label><input className="fld" value={f.to_pin} onChange={set('to_pin')} />
          <label>State</label><input className="fld" value={f.to_state} onChange={set('to_state')} />
        </div>

        <div className="entry-sec" style={{ marginTop: 14 }}>Transport</div>
        <div className="entry-grid two">
          <label>Transporter Name</label><input className="fld" value={f.transporter_name} onChange={set('transporter_name')} />
          <label>Transporter ID</label><input className="fld" value={f.transporter_id} onChange={set('transporter_id')} />
          <label>Mode</label>
          <select className="fld" value={f.trans_mode} onChange={set('trans_mode')}>{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <label>Distance (km)</label><input className="fld" type="number" value={f.trans_distance} onChange={set('trans_distance')} />
          <label>Vehicle No</label><input className="fld" value={f.vehicle_no} onChange={set('vehicle_no')} placeholder="MH01AB1234" />
          <label>Vehicle Type</label>
          <select className="fld" value={f.vehicle_type} onChange={set('vehicle_type')}><option value="R">Regular</option><option value="O">Over-Dimensional</option></select>
          <label>Trans Doc No</label><input className="fld" value={f.trans_doc_no} onChange={set('trans_doc_no')} />
          <label>Trans Doc Date</label><input className="fld" type="date" value={f.trans_doc_date} onChange={set('trans_doc_date')} />
        </div>

        <div className="entry-sec" style={{ marginTop: 14 }}>Values</div>
        <div className="entry-grid two">
          <label>Taxable Value</label><input className="fld" type="number" value={f.taxable_value} onChange={set('taxable_value')} />
          <label>Total Value</label><input className="fld" type="number" value={f.total_value} onChange={set('total_value')} />
          <label>CGST</label><input className="fld" type="number" value={f.cgst} onChange={set('cgst')} />
          <label>SGST</label><input className="fld" type="number" value={f.sgst} onChange={set('sgst')} />
          <label>IGST</label><input className="fld" type="number" value={f.igst} onChange={set('igst')} />
          <label>Status</label>
          <select className="fld" value={f.status} onChange={set('status')}><option value="draft">Draft</option><option value="generated">Generated</option><option value="cancelled">Cancelled</option></select>
        </div>
      </div>
    </Modal>
  );
}

function today() { return new Date().toISOString().slice(0, 10); }
