import { useNavigate } from 'react-router-dom';
import { useScreenSetup } from '../components/TallyFrame';
import { useHotkeys } from '../keyboard';

const DEVELOPERS = [
  {
    name: 'RightServe Infotech System',
    url: 'https://rightserveinfotechsystem.com/',
    blurb: 'Software development & IT solutions',
  },
  {
    name: 'LivePro Solutions',
    url: 'https://liveprosolutions.com/',
    blurb: 'Business software & support',
  },
];

const FAQ = [
  ['How is my data stored?', 'All data lives in a single local SQLite file on this computer. Use Settings → Backup (or the desktop File menu) to keep a copy safe.'],
  ['How do I create a bill fast?', 'Press F2 (Sales) → F5 (New) → type the product name → Enter → fill qty → Ctrl+A to save. Everything works on the keyboard.'],
  ['How do I see who bought a batch?', 'Go to Reports (F10) → "Who-Bought (Batch/Serial Trace)" and search by product or batch number.'],
  ['How do I turn features on/off?', 'Press F12 anywhere to open Configuration (GST, batch, expiry, discount, print preview, etc.).'],
  ['Where are the keyboard shortcuts?', 'Press F1 any time for the full keyboard help.'],
];

export default function Support() {
  const nav = useNavigate();
  useScreenSetup({
    title: 'Support & Help Desk',
    sub: 'We are here to help — designed with simplicity to save your time',
    buttons: [
      { key: 'f1', label: 'F1', text: 'Keyboard Help', onClick: () => nav('/help') },
      { sep: true },
      { key: 'escape', label: 'Esc', text: 'Dashboard', onClick: () => nav('/') },
    ],
  }, [nav]);
  useHotkeys({ escape: () => nav('/') }, [nav]);

  return (
    <div className="entry" style={{ maxWidth: 880 }}>
      <div className="support-hero">
        <div className="sv-logo">▣ RightServe</div>
        <div className="muted">Simple, fast, keyboard-first inventory & billing for FMCG distributors and retailers.</div>
      </div>

      <div className="support-grid">
        <div className="support-card">
          <div className="entry-sec">📞 Get Support</div>
          <table className="tbl" style={{ background: '#fff' }}>
            <tbody>
              <tr><td style={{ width: 130 }}><b>Email</b></td><td><a href="mailto:support@StockVeda.com">support@StockVeda.com</a></td></tr>
              <tr><td><b>Phone</b></td><td><a href="tel:+91866930888">+91 86693 0888</a> &nbsp;·&nbsp; <a href="tel:+919404484560">+91 94044 84560</a></td></tr>
              <tr><td><b>Helpline</b></td><td>Mon–Sat, 10:00 AM – 7:00 PM IST</td></tr>
              <tr><td><b>Remote help</b></td><td>Available on request via our support team</td></tr>
            </tbody>
          </table>
          <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            Tip: keep your data file backed up regularly (Settings → Backup or desktop File menu).
          </p>
        </div>

        <div className="support-card">
          <div className="entry-sec">💻 Designed &amp; Developed by</div>
          {DEVELOPERS.map((d) => (
            <div className="dev-row" key={d.url}>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--navy)' }}>{d.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>{d.blurb}</div>
              </div>
              <a className="btn btn-sm btn-primary" href={d.url} target="_blank" rel="noreferrer noopener">Visit Website ↗</a>
            </div>
          ))}
        </div>
      </div>

      <div className="entry-sec" style={{ marginTop: 16 }}>❓ Frequently Asked Questions</div>
      <div className="support-card">
        {FAQ.map(([q, a], i) => (
          <div key={i} className="faq-item">
            <div className="faq-q">{q}</div>
            <div className="faq-a muted">{a}</div>
          </div>
        ))}
      </div>

      <div className="muted" style={{ marginTop: 16, fontSize: 12, textAlign: 'center' }}>
        RightServe · © {new Date().getFullYear()} ·{' '}
        <a href="https://rightserveinfotechsystem.com/" target="_blank" rel="noreferrer noopener">RightServe Infotech System</a>
        {' '}&amp;{' '}
        <a href="https://liveprosolutions.com/" target="_blank" rel="noreferrer noopener">LivePro Solutions</a>
      </div>
    </div>
  );
}
