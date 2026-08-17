import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from './auth';

const ICON = {
  dash: 'M3 3h8v8H3zM13 3h8v5h-8zM3 13h8v8H3zM13 16h8v5h-8z',
  clients: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21v-1a6 6 0 0112 0v1M17 13a6 6 0 015 6v2',
  license: 'M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3zM9.5 11.5l2 2 4-4',
  users: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM3 21v-1a6 6 0 0112 0v1',
};

function Ico({ d }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}

export default function Layout({ title, sub, actions, children }) {
  const { user, logout } = useAuth();
  const admin = user?.role === 'admin';
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sb-brand">
          <div className="sb-logo">RS</div>
          <div><b>RightServe</b><span>Sales &amp; License Portal</span></div>
        </div>
        <nav className="sb-nav">
          <NavLink to="/" end className={({ isActive }) => 'sb-link' + (isActive ? ' active' : '')}><Ico d={ICON.dash} /> Dashboard</NavLink>
          <NavLink to="/clients" className={({ isActive }) => 'sb-link' + (isActive ? ' active' : '')}><Ico d={ICON.clients} /> {admin ? 'All Clients' : 'My Clients'}</NavLink>
          <NavLink to="/generate" className={({ isActive }) => 'sb-link' + (isActive ? ' active' : '')}><Ico d={ICON.license} /> Generate License</NavLink>
          {admin && <NavLink to="/users" className={({ isActive }) => 'sb-link' + (isActive ? ' active' : '')}><Ico d={ICON.users} /> Sales Team</NavLink>}
        </nav>
        <div className="sb-foot">
          <div className="sb-user">{user?.name}</div>
          <div className="sb-role">{user?.role}</div>
          <button className="sb-logout" onClick={logout}>Logout</button>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <div><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div>
          <div className="row">{actions}</div>
        </div>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
