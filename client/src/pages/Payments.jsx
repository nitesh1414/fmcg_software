import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { Modal, useToast, fmt, today } from '../components/ui';
import { ListScreen } from '../components/ListScreen';
import { useScreenSetup } from '../components/TallyFrame';
import { useHotkeys } from '../keyboard';
import { downloadCSV } from '../api/csv';
import PartySearch from '../components/PartySearch';
import { BusinessInline, BusinessFieldPicker } from '../components/BusinessSwitcher';
import { useBusiness } from '../business';

export default function Payments() {
  const toast = useToast();
  const nav = useNavigate();
  const [list, setList] = useState([]);
  const [parties, setParties] = useState([]);
  const [adding, setAdding] = useState(false);

  const load = () => api.get('/payments').then(setList);
  useEffect(() => { load(); api.get('/parties').then(setParties); }, []);
  // Refresh when the active business changes (e.g. switched inside the voucher).
  useEffect(() => {
    const h = () => { load(); api.get('/parties').then(setParties); };
    window.addEventListener('rs-business-changed', h);
    return () => window.removeEventListener('rs-business-changed', h);
  }, []);

  const del = async (row) => { if (!confirm('Delete this payment?')) return; await api.del('/payments/' + row.id); toast('Deleted'); load(); };
  const exportCsv = () => downloadCSV('payments', list, [
    { key: 'date', label: 'Date' }, { key: 'party_name', label: 'Party' }, { key: 'type', label: 'Type' },
    { key: 'mode', label: 'Mode' }, { key: 'amount', label: 'Amount' }, { key: 'invoice_no', label: 'Invoice' }, { key: 'notes', label: 'Notes' },
  ]);

  const totalIn = list.filter((p) => p.type === 'in').reduce((s, p) => s + p.amount, 0);
  const totalOut = list.filter((p) => p.type === 'out').reduce((s, p) => s + p.amount, 0);

  useScreenSetup({
    title: 'Receipts & Payments', sub: `In ${fmt(totalIn)} · Out ${fmt(totalOut)} · Net ${fmt(totalIn - totalOut)}`,
    buttons: [
      { key: 'f5', label: 'F5', text: 'New Entry', onClick: () => setAdding(true) },
      { key: 'f8', label: 'F8/Del', text: 'Delete', onClick: () => list.length && del(list[0]) },
      { sep: true },
      { key: 'ctrl+e', label: 'Ctrl+E', text: 'Export CSV', onClick: exportCsv },
      { key: 'escape', label: 'Esc', text: 'Dashboard', onClick: () => nav('/') },
    ],
  }, [list, totalIn, totalOut]);
  useHotkeys({ escape: () => nav('/'), f5: () => setAdding(true) }, [nav]);

  return (
    <>
      <div className="filterbar"><span className="muted">F5 = new receipt/payment • F8 = delete • Enter on row to delete-confirm</span><span style={{ marginLeft: 'auto' }}><BusinessInline label="For business" /></span></div>
      <ListScreen
        rows={list} onDelete={del} emptyIcon="💰" emptyText="No payments. Press F5."
        columns={[
          { key: 'date', label: 'Date' },
          { key: 'party_name', label: 'Party', render: (r) => <b>{r.party_name || '—'}</b> },
          { key: 'type', label: 'Type', render: (r) => <span className={'badge ' + (r.type === 'in' ? 'badge-success' : 'badge-danger')}>{r.type === 'in' ? 'Received' : 'Paid'}</span> },
          { key: 'mode', label: 'Mode' },
          { key: 'invoice_no', label: 'Invoice' },
          { key: 'amount', label: 'Amount', align: 'right', render: (r) => fmt(r.amount) },
        ]}
      />
      {adding && <PaymentForm parties={parties} onPartyCreated={(p) => setParties((cur) => [p, ...cur])} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); toast('Payment recorded'); }} />}
    </>
  );
}

function PaymentForm({ parties, onClose, onSaved, onPartyCreated }) {
  const toast = useToast();
  const { activeId: bizId } = useBusiness();
  const [f, setF] = useState({ party_id: '', type: 'in', amount: 0, mode: 'cash', date: today(), notes: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // Live balance of the selected party (refetched for accuracy; re-runs when the
  // active business changes so the shown balance matches the selected firm).
  const [bal, setBal] = useState(null); // { balance, name }
  useEffect(() => {
    if (!f.party_id) { setBal(null); return; }
    let on = true;
    api.get('/parties/' + f.party_id).then((p) => { if (on) setBal({ balance: p.balance, name: p.name }); }).catch(() => {});
    return () => { on = false; };
  }, [f.party_id, bizId]);

  // Balance sign: positive = party owes us (receivable); negative = we owe them.
  const balText = () => {
    if (!bal) return null;
    const b = bal.balance;
    if (Math.abs(b) < 0.01) return { txt: 'Settled — no dues', cls: 'badge-success' };
    if (b > 0) return { txt: `${bal.name} owes you ${fmt(b)}`, cls: 'badge-warning' };
    return { txt: `You owe ${bal.name} ${fmt(Math.abs(b))}`, cls: 'badge-danger' };
  };
  // After this entry, projected remaining balance.
  const projected = () => {
    if (!bal) return null;
    const amt = Number(f.amount) || 0;
    // 'in' (received) reduces receivable; 'out' (paid) reduces payable.
    const next = f.type === 'in' ? bal.balance - amt : bal.balance + amt;
    return next;
  };

  const save = async () => {
    if (!f.party_id) return toast('Select a party');
    if (!f.amount || Number(f.amount) <= 0) return toast('Enter amount');
    await api.post('/payments', f); onSaved();
  };
  const bt = balText();
  const proj = projected();
  return (
    <Modal title="Receipt / Payment Voucher" onClose={onClose} onAccept={save}
      footer={<><span className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>Enter = next • Ctrl+A = accept</span><button className="btn" onClick={onClose}>Esc</button><button className="btn btn-primary" data-accept="1" onClick={save}>Accept</button></>}>
      <div className="entry-grid two">
        <BusinessFieldPicker value={bizId} label="Business" />
        <label>Party</label>
        <PartySearch
          parties={parties}
          value={f.party_id}
          type={f.type === 'in' ? 'customer' : 'supplier'}
          onSelect={(p) => setF({ ...f, party_id: p ? p.id : '' })}
          onCreated={(p) => onPartyCreated && onPartyCreated(p)}
        />
        <label>Type</label><select className="fld" value={f.type} onChange={set('type')}><option value="in">Received (In)</option><option value="out">Paid (Out)</option></select>
        <label>Amount ₹</label>
        <div>
          <input className="fld" type="number" value={f.amount} onChange={set('amount')} style={{ width: '100%' }} />
          {bal && Math.abs(bal.balance) > 0.01 && (
            <button type="button" className="btn btn-sm" style={{ marginTop: 4 }}
              title="Set the full outstanding amount"
              onClick={() => setF({ ...f, amount: Math.abs(bal.balance) })}>
              Settle full {fmt(Math.abs(bal.balance))}
            </button>
          )}
        </div>
        <label>Mode</label><select className="fld" value={f.mode} onChange={set('mode')}><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank">Bank</option><option value="cheque">Cheque</option></select>
        <label>Date</label><input className="fld" type="date" value={f.date} onChange={set('date')} />
        <label>Notes</label><input className="fld" value={f.notes} onChange={set('notes')} />
      </div>

      {f.party_id && (
        <div className="totbox" style={{ marginTop: 12 }}>
          <div className="totrow">
            <span>Current balance</span>
            <span>{bt ? <span className={'badge ' + bt.cls}>{bt.txt}</span> : <span className="muted">Loading…</span>}</span>
          </div>
          {bal && Number(f.amount) > 0 && (
            <div className="totrow grand">
              <span>Balance after this {f.type === 'in' ? 'receipt' : 'payment'}</span>
              <span className="num">
                {Math.abs(proj) < 0.01 ? 'Settled' : proj > 0 ? `${fmt(proj)} Dr` : `${fmt(Math.abs(proj))} Cr`}
              </span>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
