import { useState } from 'react';
import { Modal, useToast } from './ui';
import { useFeatures } from '../features';
import { useHotkeys } from '../keyboard';

// Grouped toggle definitions (Tally F11/F12 "Company Features" style)
const GROUPS = [
  {
    title: 'Invoicing & Taxation',
    items: [
      ['enableGST', 'Enable GST (CGST/SGST, tax columns)'],
      ['enableHSN', 'Show HSN / SAC code column'],
      ['enableDiscount', 'Allow line-item discount %'],
      ['autoRoundOff', 'Auto round-off invoice total'],
    ],
  },
  {
    title: 'Inventory',
    items: [
      ['enableBatch', 'Maintain batch-wise inventory'],
      ['enableExpiry', 'Track manufacturing / expiry dates'],
      ['enableMRP', 'Maintain MRP on batches'],
      ['showStockInVoucher', 'Show available stock in voucher entry'],
      ['negativeStock', 'Allow negative stock (sell beyond available)'],
    ],
  },
  {
    title: 'Printing & Behaviour',
    items: [
      ['printPreview', 'Show in-app print preview (off = open in tab)'],
    ],
  },
  {
    title: 'WhatsApp',
    items: [
      ['whatsappAutoSend', 'Auto-send bill PDF to customer on WhatsApp after saving a sale'],
      ['whatsappAutoPrompt', 'If no number is saved, ask for one instead of skipping'],
    ],
  },
  {
    title: 'Bill Format — content blocks',
    hint: 'What prints on the tax invoice (applies to the Tally e-Invoice format)',
    items: [
      ['billEInvoice', 'e-Invoice IRN / Ack No. / Ack Date + QR'],
      ['billConsignee', 'Consignee (Ship-to) block'],
      ['billDispatch', 'Dispatch / transport fields (Delivery Note, Dispatch, Destination…)'],
      ['billOrderRef', "Buyer's Order No., Reference & Other References"],
      ['billEwayNo', 'e-Way Bill No. on the invoice'],
      ['billPlaceOfSupply', 'Place of Supply line'],
      ['billHsnSummary', 'HSN / SAC tax-summary grid'],
      ['billAmountWords', 'Amount chargeable (in words)'],
      ['billTaxWords', 'Tax amount (in words)'],
      ['billBankDetails', "Company's bank details block"],
      ['billDeclaration', 'Declaration paragraph'],
      ['billPan', "Company's PAN"],
      ['billUdyam', 'UDYAM / MSME number in seller block'],
      ['billRoundOff', 'Round-off line'],
      ['billCustomerSeal', "Customer's Seal & Signature box"],
      ['billComputerGenerated', '"This is a Computer Generated Invoice" footer'],
      ['billTriplicate', 'Print 3 copies — Original / Duplicate / Triplicate'],
    ],
  },
];

const TEXT_FIELDS = [
  ['invoiceFooter', 'Invoice footer message'],
];
const SELECT_FIELDS = [
  ['defaultPayMode', 'Default payment mode', ['cash', 'upi', 'bank', 'cheque']],
  ['discountMode', 'Discount type in bill', [['tcs', 'Trade + CD + SD'], ['pct', 'Single % Discount']]],
];

export default function ConfigPanel({ onClose }) {
  const toast = useToast();
  const { features, setFeature } = useFeatures();
  const flatToggles = GROUPS.flatMap((g) => g.items.map(([k]) => k));
  const [idx, setIdx] = useState(0);

  const toggle = (key) => {
    setFeature({ [key]: !features[key] });
  };

  useHotkeys(
    {
      escape: () => onClose(),
      arrowdown: () => setIdx((i) => Math.min(flatToggles.length - 1, i + 1)),
      arrowup: () => setIdx((i) => Math.max(0, i - 1)),
      enter: () => toggle(flatToggles[idx]),
      space: () => toggle(flatToggles[idx]),
    },
    [idx, features],
    { modal: true }
  );

  let n = -1;
  return (
    <Modal title="F12 — Configuration / Company Features" onClose={onClose} onAccept={onClose}
      footer={<><span className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>↑↓ move · Enter/Space toggle · Esc close · changes save instantly</span><button className="btn btn-primary" onClick={onClose}>Close (Esc)</button></>}>
      {GROUPS.map((g) => (
        <div key={g.title} style={{ marginBottom: 12 }}>
          <div className="entry-sec">{g.title}{g.hint && <span className="muted" style={{ fontWeight: 400, fontSize: 11.5, marginLeft: 8 }}>· {g.hint}</span>}</div>
          {g.items.map(([key, label]) => {
            n++;
            const active = n === idx;
            const on = !!features[key];
            const myN = n;
            return (
              <div key={key}
                className={'cfg-row ' + (active ? 'active' : '')}
                onMouseEnter={() => setIdx(myN)}
                onClick={() => toggle(key)}>
                <span className="cfg-label">{label}</span>
                <span className={'cfg-switch ' + (on ? 'on' : 'off')}>
                  <span className="knob" />
                  <span className="cfg-state">{on ? 'Yes' : 'No'}</span>
                </span>
              </div>
            );
          })}
        </div>
      ))}

      <div className="entry-sec">Defaults</div>
      {SELECT_FIELDS.map(([key, label, opts]) => (
        <div className="cfg-row" key={key}>
          <span className="cfg-label">{label}</span>
          <select className="fld" style={{ width: 170 }} value={features[key]} onChange={(e) => setFeature({ [key]: e.target.value })}>
            {opts.map((o) => {
              const [val, lbl] = Array.isArray(o) ? o : [o, o.toUpperCase()];
              return <option key={val} value={val}>{lbl}</option>;
            })}
          </select>
        </div>
      ))}
      {TEXT_FIELDS.map(([key, label]) => (
        <div className="cfg-row" key={key} style={{ alignItems: 'flex-start' }}>
          <span className="cfg-label">{label}</span>
          <input className="fld" style={{ flex: 1, maxWidth: 320 }} value={features[key] || ''}
            onChange={(e) => setFeature({ [key]: e.target.value })} />
        </div>
      ))}
    </Modal>
  );
}
