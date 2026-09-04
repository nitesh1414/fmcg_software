import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import logo from './assets/logo.png';

const ICON = {
  dash: 'M3 3h8v8H3zM13 3h8v5h-8zM3 13h8v8H3zM13 16h8v5h-8z',
  clients: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21v-1a6 6 0 0112 0v1M17 13a6 6 0 015 6v2',
  license: 'M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3zM9.5 11.5l2 2 4-4',
  users: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21v-1a6 6 0 0112 0v1',
  menu: 'M3 6h18M3 12h18M3 18h18',
};

function Ico({ d, size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}

export default function Layout({ title, sub, actions, children }) {
  const { user, logout } = useAuth();
  const admin = user?.role === 'admin';
  const [nav, setNav] = useState(false);
  const loc = useLocation();
  // Any navigation closes the drawer (it is an overlay on phones).
  useEffect(() => { setNav(false); }, [loc.pathname]);

  const linkCls = ({ isActive }) => 'sb-link' + (isActive ? ' active' : '');

  return (
    <div className="app" data-nav={nav ? 'open' : 'closed'}>
      {nav && <button className="scrim" aria-label="Close menu" onClick={() => setNav(false)} />}
      <aside className="sidebar">
        <div className="sb-brand">
          <img className="sb-logo-img" src={logo} alt="RightServe logo" />
          <div><b>RightServe</b><span>Sales &amp; License Portal</span></div>
        </div>
        <nav className="sb-nav">
          <NavLink to="/" end className={linkCls}><Ico d={ICON.dash} /> Dashboard</NavLink>
          <NavLink to="/clients" className={linkCls}><Ico d={ICON.clients} /> {admin ? 'All Clients' : 'My Clients'}</NavLink>
          <NavLink to="/generate" className={linkCls}><Ico d={ICON.license} /> Generate License</NavLink>
          {admin && <NavLink to="/users" className={linkCls}><Ico d={ICON.users} /> Sales Team</NavLink>}
        </nav>
        <div className="sb-foot">
          <div className="sb-user">{user?.name}</div>
          <div className="sb-role">{user?.role}</div>
          <button className="sb-logout" onClick={logout}>Logout</button>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <div className="topbar-left">
            <button className="menu-btn" onClick={() => setNav((v) => !v)} aria-label="Open menu" aria-expanded={nav}>
              <Ico d={ICON.menu} size={20} />
            </button>
            <div><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div>
          </div>
          <div className="row">{actions}</div>
        </div>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
