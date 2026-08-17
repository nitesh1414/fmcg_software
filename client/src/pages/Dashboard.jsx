import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { fmt, fmtN, fmtCompact } from '../components/ui';
import { useScreenSetup } from '../components/TallyFrame';
import { SECTIONS } from '../nav';
import Icon from '../components/Icon';
import { useAuth, can, isAdmin } from '../auth';
import { BusinessInline } from '../components/BusinessSwitcher';

export default function Dashboard() {
  const nav = useNavigate();
  const { user } = useAuth();
  const admin = isAdmin(user);
  const [d, setD] = useState(null);
  const [company, setCompany] = useState('');

  // Filter the section cards + their links by the user's permissions.
  const sections = SECTIONS
    .map((s) => ({
      ...s,
      items: s.items.filter((it) => !it.sep && (it.adminItem ? admin : (!it.mod || can(user, it.mod, 'read')))),
    }))
    .filter((s) => (s.adminSection ? admin : s.items.length > 0));

  useEffect(() => {
    api.get('/reports/dashboard').then(setD).catch(() => {});
    api.get('/company').then((c) => setCompany(c.name)).catch(() => {});
  }, []);

  useScreenSetup({ title: 'Dashboard', sub: 'Overview & quick access', buttons: [] }, []);

  // Cards use compact money (₹2.50 L / ₹1.25 Cr) so large amounts never break
  // the layout; the exact value is shown on hover (full) via `title`.
  const kpis = [
    { cls: '', icon: 'sales', label: "Today's Sales", value: d ? fmtCompact(d.todaySales) : '—', full: d ? fmt(d.todaySales) : '', sub: 'Billed today' },
    { cls: 'green', icon: 'trend', label: 'This Month Sales', value: d ? fmtCompact(d.monthSales) : '—', full: d ? fmt(d.monthSales) : '', sub: 'Current month' },
    { cls: 'gold', icon: 'cash', label: 'To Receive', value: d ? fmtCompact(d.receivable) : '—', full: d ? fmt(d.receivable) : '', sub: 'From customers' },
    { cls: 'red', icon: 'receipt', label: 'To Pay', value: d ? fmtCompact(d.payable) : '—', full: d ? fmt(d.payable) : '', sub: 'To suppliers' },
    { cls: '', icon: 'box', label: 'Stock Value', value: d ? fmtCompact(d.stockValue) : '—', full: d ? fmt(d.stockValue) : '', sub: d ? `${fmtN(d.itemCount)} items` : '' },
    { cls: 'red', icon: 'alert', label: 'Alerts', value: d ? fmtN((d.lowStockCount || 0) + (d.expSoonCount || 0)) : '—', sub: d ? `${d.lowStockCount} low · ${d.expSoonCount} expiring` : '' },
  ];

  return (
    <div className="dash">
      <div className="dash-welcome" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1>Welcome to RightServe</h1>
          <p>{company || 'Your business'} · jump anywhere from any screen: <span className="kbd">Alt+S</span> Sale · <span className="kbd">Alt+P</span> Purchase · <span className="kbd">Alt+R</span> Receipts · <span className="kbd">Alt+A</span> Parties</p>
        </div>
        <BusinessInline label="Showing" />
      </div>

      <div className="dash-kpis">
        {kpis.map((k, i) => (
          <div key={i} className={'kpi ' + k.cls}>
            <div className="kpi-ico"><Icon name={k.icon} size={20} /></div>
            <div className="kpi-body">
              <div className="k-label">{k.label}</div>
              <div className="k-value" title={k.full || ''}>{k.value}</div>
              {k.sub && <div className="k-sub">{k.sub}</div>}
            </div>
          </div>
        ))}
      </div>

      <div className="section-title">Main Sections</div>
      <div className="dash-sections">
        {sections.map((s) => (
          <div key={s.id} className={'sec-card ' + s.cls}>
            <div className="sc-head" onClick={() => s.items[0] && nav(s.items[0].to)}>
              <div className="sc-ico"><Icon name={s.icon} size={26} stroke={2} /></div>
              <div>
                <div className="sc-title">{s.label}</div>
                <div className="sc-desc">{s.desc}</div>
              </div>
            </div>
            <div className="sc-links">
              {s.items.slice(0, 6).map((it, i) => (
                <div key={i} className="sc-link" onClick={() => nav(it.to)}>
                  <span className="scl-ico"><Icon name={it.icon} size={16} /></span>
                  <span>{it.label}</span>
                  <span className="arr">›</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
