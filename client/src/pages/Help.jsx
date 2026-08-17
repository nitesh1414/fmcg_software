import { useNavigate } from 'react-router-dom';
import { useScreenSetup } from '../components/TallyFrame';
import { useHotkeys } from '../keyboard';

const SECTIONS = [
  {
    title: 'Global Keys (work everywhere)',
    rows: [
      ['Ctrl + G', 'Go to Gateway (home menu)'],
      ['Esc', 'Go back / close popup'],
      ['Ctrl + A', 'Accept & Save the current form/voucher'],
      ['Ctrl + L', 'Logout'],
      ['F1', 'This help screen'],
      ['F12', 'Configuration / Company Features'],
      ['Ctrl + E', 'Export current list to CSV/Excel'],
    ],
  },
  {
    title: 'Configuration (F12)',
    rows: [
      ['↑ / ↓', 'Move between toggles'],
      ['Enter / Space', 'Turn a feature On / Off'],
      ['Esc', 'Close (changes save instantly)'],
      ['—', 'Toggle GST, batch, expiry, discount, round-off, print preview, etc.'],
    ],
  },
  {
    title: 'Printing',
    rows: [
      ['Ctrl + P / Alt + P', 'Print / preview the selected voucher'],
      ['P (in preview)', 'Send to printer'],
      ['O (in preview)', 'Open PDF in a new tab'],
      ['Esc (in preview)', 'Close preview'],
    ],
  },
  {
    title: 'Go To — works from ANY screen or sub-tab',
    rows: [
      ['Alt + S', 'Sales Voucher'],
      ['Alt + P', 'Purchase Voucher'],
      ['Alt + R', 'Receipts & Payments'],
      ['Alt + A', 'Parties (Accounts)'],
      ['Alt + I', 'Items / Stock Master'],
      ['Alt + B', 'Batch / Serial Inventory'],
      ['Alt + G', 'GST Return'],
      ['Alt + O', 'Reports'],
      ['Alt + H / Ctrl + G', 'Dashboard (Home)'],
      ['Alt + 1 … 5', 'Open a top section (Billing / Accounting / GST / Report / System)'],
    ],
  },
  {
    title: 'List / Display Screens',
    rows: [
      ['↑ / ↓', 'Move row highlight'],
      ['PgUp / PgDn', 'Jump 10 rows'],
      ['Home / End', 'First / last row'],
      ['Enter', 'Open / view the highlighted record'],
      ['F8 or Del', 'Delete highlighted record'],
    ],
  },
  {
    title: 'Data Entry (Vouchers & Masters)',
    rows: [
      ['Enter', 'Confirm field and move to next (Tally style)'],
      ['Shift + Enter', 'Move to previous field'],
      ['Tab / Shift+Tab', 'Next / previous field'],
      ['Ctrl + A', 'Accept the whole voucher (save)'],
      ['Esc', 'Abandon and go back'],
    ],
  },
  {
    title: 'On-Screen Action Keys',
    rows: [
      ['F5', 'New record (new sale / purchase / item / party / entry)'],
      ['F8 or Del', 'Delete highlighted record'],
      ['F12', 'Configuration (feature toggles)'],
      ['Ctrl + K', 'Quick stock lookup'],
      ['Ctrl + T', 'Theme / appearance'],
      ['Ctrl + E', 'Export current list to CSV'],
      ['Alt + N (in voucher)', 'Add a new item row'],
      ['Ctrl + P / Alt + P', 'Print PDF (on a saved invoice)'],
    ],
  },
  {
    title: 'Product Search & Batch Trace',
    rows: [
      ['Type in Item cell', 'Search products by name or code (type-ahead)'],
      ['↑ / ↓ then Enter', 'Pick a product from the suggestion list'],
      ['Sale → Batch list', 'Shows only unsold batches with their expiry dates (FEFO)'],
      ['Reports → W', 'Who-Bought: trace a product/batch to whom it was sold'],
    ],
  },
];

export default function Help() {
  const nav = useNavigate();
  useScreenSetup({ title: 'Keyboard Help (F1)', sub: 'Press Esc to go back', buttons: [
    { key: 'esc', label: 'Esc', text: 'Back', onClick: () => nav(-1) },
  ] }, []);
  useHotkeys({ escape: () => nav(-1) }, [nav]);

  return (
    <div className="entry" style={{ maxWidth: 760 }}>
      {SECTIONS.map((s) => (
        <div key={s.title} style={{ marginBottom: 16 }}>
          <div className="entry-sec">{s.title}</div>
          <table className="tbl" style={{ background: '#fff' }}>
            <tbody>
              {s.rows.map(([k, d]) => (
                <tr key={k}><td style={{ width: 200 }}><span className="kbd">{k}</span></td><td>{d}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
