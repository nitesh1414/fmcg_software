import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import Layout from '../Layout';
import { productLabel } from '../components.jsx';

export default function Dashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [d, setD] = useState(null);
  useEffect(() => { api.get('/dashboard').then(setD).catch(() => {}); }, []);
  const c = d?.counts || {};

  return (
    <Layout title={`Welcome, ${user?.name?.split(' ')[0] || ''}`} sub={user?.role === 'admin' ? 'Company-wide overview' : 'Your clients overview'}
      actions={<button className="btn btn-primary" onClick={() => nav('/generate')}>+ Generate License</button>}>
      <div className="kpis">
        <div className="kpi"><div className="n">{c.clients ?? '—'}</div><div className="l">{user?.role === 'admin' ? 'Total Clients' : 'My Clients'}</div></div>
        <div className="kpi ok"><div className="n">{c.active ?? 0}</div><div className="l">Active</div></div>
        <div className="kpi warn"><div className="n">{c.expiring ?? 0}</div><div className="l">Expiring Soon</div></div>
        <div className="kpi bad"><div className="n">{c.expired ?? 0}</div><div className="l">Expired</div></div>
        <div className="kpi"><div className="n">{c.perpetual ?? 0}</div><div className="l">Lifetime</div></div>
        <div className="kpi"><div className="n">{c.noLicense ?? 0}</div><div className="l">No License</div></div>
        <div className="kpi"><div className="n">{c.desktop ?? 0}</div><div className="l">Desktop keys</div></div>
        <div className="kpi"><div className="n">{c.mobile ?? 0}</div><div className="l">Mobile keys</div></div>
        <div className="kpi"><div className="n">{c.addons ?? 0}</div><div className="l">Add-ons sold</div></div>
      </div>

      <div className="card">
        <div className="card-head">⏳ Renewals due (expiring / expired)
          <button className="btn btn-sm" onClick={() => nav('/clients')}>View all clients →</button></div>
        <div className="card-body" style={{ padding: 0 }}>
          {!d ? <div style={{ padding: 18 }} className="muted">Loading…</div> :
            d.expiringSoon.length === 0 ? <div style={{ padding: 18 }} className="muted">Nothing due — all good 🎉</div> : (
            <div className="table-scroll">
              <table className="tbl">
                <thead><tr><th>Client</th><th>Product</th><th>Phone</th><th>Expiry</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {d.expiringSoon.map((r) => (
                    <tr key={r.client_id + '-' + r.product}>
                      <td data-label="Client"><b>{r.business_name}</b><span className="stack-sub mono">{r.license_id}</span></td>
                      <td data-label="Product"><span className={'badge ' + (r.product === 'mobile' ? 'sales' : 'base')}>{productLabel(r.product)}</span></td>
                      <td data-label="Phone">{r.phone || '—'}</td>
                      <td data-label="Expiry">{r.expires}</td>
                      <td data-label="Status">
                        <span className={'badge ' + r.state}>{r.state === 'expired' ? `Expired · ${-r.daysLeft}d ago` : `Expiring · ${r.daysLeft}d`}</span>
                      </td>
                      <td data-label="" className="actions-cell right">
                        <span className="actions"><button className="btn btn-sm btn-primary" onClick={() => nav('/clients?focus=' + r.client_id)}>Renew</button></span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {d && d.addonOpportunities?.length > 0 && (
        <div className="card">
          <div className="card-head">📦 Add-on opportunities
            <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{d.addonCount} client(s) run one product only</span></div>
          <div className="card-body" style={{ padding: 0 }}>
            <div className="table-scroll">
              <table className="tbl">
                <thead><tr><th>Client</th><th>Runs</th><th>Can add</th><th>Phone</th><th></th></tr></thead>
                <tbody>
                  {d.addonOpportunities.map((r) => (
                    <tr key={r.client_id}>
                      <td data-label="Client"><b>{r.business_name}</b></td>
                      <td data-label="Runs"><span className={'badge ' + (r.has === 'mobile' ? 'sales' : 'base')}>{productLabel(r.has)}</span></td>
                      <td data-label="Can add"><span className="badge addon">+ {productLabel(r.missing)}</span></td>
                      <td data-label="Phone">{r.phone || '—'}</td>
                      <td data-label="" className="actions-cell right">
                        <span className="actions"><button className="btn btn-sm btn-primary" onClick={() => nav('/clients?focus=' + r.client_id + '&add=' + r.missing)}>Add {productLabel(r.missing)}</button></span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {user?.role === 'admin' && d?.teamStats && (
        <div className="card">
          <div className="card-head">👥 Sales Team Performance</div>
          <div className="card-body" style={{ padding: 0 }}>
            <div className="table-scroll">
              <table className="tbl">
                <thead><tr><th>Salesperson</th><th>Clients</th><th>Licenses Issued</th></tr></thead>
                <tbody>
                  {d.teamStats.map((t) => (
                    <tr key={t.id}>
                      <td data-label="Salesperson"><b>{t.name}</b> <span className="muted">@{t.username}</span></td>
                      <td data-label="Clients">{t.clients}</td>
                      <td data-label="Licenses">{t.licenses}</td>
                    </tr>
                  ))}
                  {d.teamStats.length === 0 && <tr><td data-label="" colSpan="3" className="muted">No salespeople yet</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
