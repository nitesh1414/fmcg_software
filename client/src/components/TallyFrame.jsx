import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth, can, isAdmin } from '../auth';
import { useHotkeys } from '../keyboard';
import { api } from '../api/client';
import { SECTIONS, GOTO } from '../nav';
import Icon from './Icon';
import logoUrl from '../assets/logo.png';
import ThemePanel from './ThemePanel';
import ConfigPanel from './ConfigPanel';
import BusinessSwitcher from './BusinessSwitcher';
import PrintPreview from './PrintPreview';
import StockLookup from './StockLookup';

/**
 * The persistent Tally/MARG chrome: top company bar, right function-key
 * button bar, and bottom status bar. Pages set their button bar + title via
 * the ScreenProvider context.
 */

const ScreenCtx = createContext(null);
export const useScreen = () => useContext(ScreenCtx);

// Lets any page trigger the in-app print preview: const preview = usePrint();
const PrintCtx = createContext(null);
export const usePrint = () => useContext(PrintCtx);

export function TallyFrame({ children }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [screen, setScreen] = useState({ title: 'Gateway of RightServe', sub: '', buttons: [] });
  const [company, setCompany] = useState('');
  const [clock, setClock] = useState(new Date());
  const [showConfig, setShowConfig] = useState(false);
  const [showStock, setShowStock] = useState(false);
  const [showTheme, setShowTheme] = useState(false);
  const [preview, setPreview] = useState(null); // { path, title }
  const [readOnly, setReadOnly] = useState(false);
  const [license, setLicense] = useState(null);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000 * 30);
    return () => clearInterval(t);
  }, []);

  // License read-only mode (desktop, expired license): show a persistent banner.
  useEffect(() => {
    const fetchLic = () => api.get('/license-state').then((s) => { setLicense(s); setReadOnly(!!s.readOnly); }).catch(() => {});
    fetchLic();
    const h = () => { setReadOnly(true); fetchLic(); };
    window.addEventListener('rs-readonly', h);
    return () => window.removeEventListener('rs-readonly', h);
  }, []);
  useEffect(() => {
    const h = () => setShowConfig(true);
    const t = () => setShowTheme(true);
    window.addEventListener('open-config', h);
    window.addEventListener('open-theme', t);
    return () => { window.removeEventListener('open-config', h); window.removeEventListener('open-theme', t); };
  }, []);
  useEffect(() => {
    api.get('/company').then((c) => setCompany(c.name)).catch(() => {});
  }, []);

  // Global hotkeys available everywhere.
  // Build the GOTO mnemonics (Alt+S=Sales, Alt+P=Purchase, Alt+R=Receipts...).
  // These are guarded so they never fire while a modal/voucher form is open
  // (so you can't navigate away mid-entry).
  const gotoMap = {};
  for (const g of GOTO) {
    gotoMap[g.keys] = () => {
      if (document.querySelector('.modal-overlay, .modal')) return false; // defer when a form is open
      if (g.mod && !can(user, g.mod, 'read')) return false; // no access → ignore shortcut
      nav(g.to);
    };
  }
  useHotkeys(
    {
      f1: () => nav('/support'),
      f12: () => setShowConfig(true),  // Configuration
      'ctrl+k': () => setShowStock(true), // Real-time stock lookup
      'ctrl+t': () => setShowTheme(true), // Theme / appearance
      'alt+m': () => { try { window.dispatchEvent(new CustomEvent('open-business-switcher')); } catch (_) {} }, // Switch business
      'ctrl+g': () => nav('/'),        // Dashboard
      'alt+f4': () => {},              // let OS handle in desktop
      'ctrl+l': () => logout(),
      // Alt+1..5 jump to a section's primary screen (kept for muscle memory)
      'alt+1': () => SECTIONS[0] && nav(SECTIONS[0].items[0].to),
      'alt+2': () => SECTIONS[1] && nav(SECTIONS[1].items[0].to),
      'alt+3': () => SECTIONS[2] && nav(SECTIONS[2].items[0].to),
      'alt+4': () => SECTIONS[3] && nav(SECTIONS[3].items[0].to),
      'alt+5': () => SECTIONS[4] && nav(SECTIONS[4].items[0].to),
      // Direct "Go To" any screen from any tab/sub-tab
      ...gotoMap,
    },
    [nav, logout]
  );

  // Register F-key buttons from the active screen so they actually fire.
  useHotkeys(
    Object.fromEntries(
      (screen.buttons || [])
        .filter((b) => b.key && b.onClick && !b.disabled)
        .map((b) => [b.key.toLowerCase(), () => b.onClick()])
    ),
    [screen.buttons]
  );

  const initials = (user?.name || 'U').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  const hasButtons = (screen.buttons || []).some((b) => !b.sep && !b.title);

  return (
    <ScreenCtx.Provider value={{ setScreen }}>
      <PrintCtx.Provider value={(path, title) => setPreview({ path, title })}>
        <div className="app-shell">
          <TopNav company={company} initials={initials} user={user} logout={logout} nav={nav} onTheme={() => setShowTheme(true)} license={license} />

          {readOnly && (
            <div className="readonly-banner" onClick={() => nav('/license')} style={{ cursor: 'pointer' }}>
              🔒 <b>License expired — Read-Only mode.</b> You can view &amp; print, but cannot create or edit records.
              Click here to <b>view License &amp; renew</b>. Support: support@StockVeda.com · +91 86693 0888
            </div>
          )}

          <div className="tbody">
            <div className="work">
              <div className="work-head">
                <span>{screen.title}</span>
                {screen.sub && <span className="sub">{screen.sub}</span>}
              </div>
              <div className="work-scroll">{children}</div>
            </div>

            {hasButtons && <ButtonBar buttons={screen.buttons} />}
          </div>

          <div className="statusbar">
            <span><b>Enter</b> Select/Next</span>
            <span><b>Esc</b> Back</span>
            <span><b>Ctrl+A</b> Accept</span>
            <span><b>Alt+S</b> Sale</span>
            <span><b>Alt+P</b> Purchase</span>
            <span><b>Alt+R</b> Receipts</span>
            <span><b>Alt+A</b> Parties</span>
            <span><b>Ctrl+K</b> Stock</span>
            <span><b>F12</b> Config</span>
            <span className="spacer" />
            <span>{company}</span>
            <span className="clock">{clock.toLocaleDateString('en-IN')} {clock.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>

        {showConfig && <ConfigPanel onClose={() => setShowConfig(false)} />}
        {showStock && <StockLookup onClose={() => setShowStock(false)} />}
        {showTheme && <ThemePanel onClose={() => setShowTheme(false)} />}
        {preview && <PrintPreview path={preview.path} title={preview.title} onClose={() => setPreview(null)} />}
      </PrintCtx.Provider>
    </ScreenCtx.Provider>
  );
}

// Compact license status chip for the top bar. Hidden in plain web mode.
function LicenseChip({ license, nav }) {
  if (!license || license.state === 'web' || !license.desktop) return null;
  const s = license;
  let cls = 'lic-chip-ok', icon = '🛡️', text = 'Licensed';
  if (s.state === 'expired') { cls = 'lic-chip-bad'; icon = '🔒'; text = 'Expired'; }
  else if (s.state === 'invalid' || s.state === 'none') { cls = 'lic-chip-bad'; icon = '⚠️'; text = 'Not Activated'; }
  else if (s.state === 'expiring') { cls = 'lic-chip-warn'; icon = '⏳'; text = `${s.daysLeft}d left`; }
  else if (s.perpetual) { cls = 'lic-chip-ok'; icon = '🛡️'; text = 'Lifetime'; }
  else if (typeof s.daysLeft === 'number') { cls = 'lic-chip-ok'; icon = '🛡️'; text = `${s.daysLeft}d`; }

  const title = s.perpetual
    ? 'License: Active (Lifetime / never expires) — click for details'
    : s.expires
      ? `License ${s.state}${s.expires ? ' · valid till ' + s.expires : ''}${typeof s.daysLeft === 'number' ? ' (' + s.daysLeft + ' days)' : ''} — click for details`
      : 'License details';

  return (
    <button className={'lic-chip ' + cls} title={title} onClick={() => nav('/license')}>
      <span className="lic-chip-ico">{icon}</span>
      <span className="lic-chip-txt">{text}</span>
    </button>
  );
}

// Filter nav sections/items by the current user's permissions.
function visibleSections(user) {
  const admin = isAdmin(user);
  const itemVisible = (it) => {
    if (it.sep) return true;
    if (it.adminItem) return admin;
    if (!it.mod) return true;            // always-visible item
    return can(user, it.mod, 'read');
  };
  return SECTIONS
    .map((s) => {
      let items = s.items.filter(itemVisible);
      // drop leading/trailing/double separators left after filtering
      items = items.filter((it, i) => !(it.sep && (i === 0 || i === items.length - 1 || items[i - 1]?.sep)));
      return { ...s, items };
    })
    .filter((s) => {
      if (s.adminSection) return admin || s.items.some((it) => !it.sep);
      return s.items.some((it) => !it.sep);
    });
}

function TopNav({ company, initials, user, logout, nav, onTheme, license }) {
  const SECS = visibleSections(user);
  const [open, setOpen] = useState(null);      // section id whose dropdown is open
  const [mobileOpen, setMobileOpen] = useState(false); // mobile slide-out menu
  const ref = useRef(null);
  const location = useLocation();

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(null); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Close any open menu when the route changes (e.g. after picking an item).
  useEffect(() => { setOpen(null); setMobileOpen(false); }, [location.pathname, location.search]);

  // Esc closes an open dropdown / mobile menu first. If nothing is open we
  // return false so the active screen's Esc (→ back to Dashboard) still fires.
  useHotkeys({
    escape: () => {
      if (open || mobileOpen) { setOpen(null); setMobileOpen(false); return true; }
      return false; // let the screen-level Esc handle it
    },
  }, [open, mobileOpen]);

  const go = (to) => { setOpen(null); setMobileOpen(false); nav(to); };

  return (
    <div className="topnav" ref={ref}>
      <button className="hamburger" onClick={() => setMobileOpen((v) => !v)} aria-label="Menu">
        <Icon name="menu" size={22} />
      </button>

      <div className="brand-box" onClick={() => go('/')}>
        <div className="brand-logo"><img src={logoUrl} alt="RightServe" /></div>
        <div className="brand-text">
          <span className="b1">RightServe</span>
          <span className="b2">Inventory &amp; Billing ERP</span>
        </div>
      </div>

      <div className="menu-tabs">
        {SECS.map((s) => (
          <div
            key={s.id}
            className={'menu-tab ' + (open === s.id ? 'active' : '')}
            onClick={() => setOpen(open === s.id ? null : s.id)}
            onMouseEnter={() => open && setOpen(s.id)}
          >
            <span className="mt-ico"><Icon name={s.icon} size={17} /></span>
            <span>{s.label}</span>
            <span className="mt-key">{s.key}</span>
            <span className="mt-caret">▾</span>
            {open === s.id && (
              <div className="menu-pop" onClick={(e) => e.stopPropagation()}>
                <div className="mi-head">{s.label}</div>
                {s.items.map((it, i) =>
                  it.sep ? (
                    <div className="mi-sep" key={i} />
                  ) : (
                    <div className="mi" key={i} onClick={() => go(it.to)}>
                      <span className="mi-ico"><Icon name={it.icon} size={16} /></span>
                      <span>{it.label}</span>
                      {it.key && <span className="mi-key">{it.key}</span>}
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="topnav-right">
        <BusinessSwitcher />
        <span className="co co-single" title={company}>{company}</span>
        <LicenseChip license={license} nav={nav} />
        <button className="icon-btn" title="Appearance / Theme (Ctrl+T)" onClick={onTheme}>
          <Icon name="palette" size={18} />
        </button>
        <div className="userchip">
          <span className="avatar">{initials}</span>
          <button className="logout-btn" onClick={logout}><Icon name="logout" size={15} /><span className="lbl">Logout</span></button>
        </div>
      </div>

      {/* Mobile / tablet slide-out menu */}
      {mobileOpen && (
        <div className="mobile-menu-backdrop" onClick={() => setMobileOpen(false)}>
          <div className="mobile-menu" onClick={(e) => e.stopPropagation()}>
            <div className="mm-head">
              <span><img src={logoUrl} alt="" style={{ height: 20, verticalAlign: 'middle' }} /> RightServe</span>
              <button className="icon-btn" onClick={() => setMobileOpen(false)}><Icon name="close" size={18} /></button>
            </div>
            <div className="mm-item mm-dash" onClick={() => go('/')}><Icon name="dashboard" size={18} /> Dashboard</div>
            {SECS.map((s) => (
              <div key={s.id} className="mm-group">
                <div className="mm-group-title"><Icon name={s.icon} size={16} /> {s.label}</div>
                {s.items.filter((it) => !it.sep).map((it, i) => (
                  <div key={i} className="mm-item" onClick={() => go(it.to)}>
                    <Icon name={it.icon} size={16} /> {it.label}
                  </div>
                ))}
              </div>
            ))}
            <div className="mm-item" onClick={() => { setMobileOpen(false); onTheme(); }}><Icon name="palette" size={16} /> Appearance / Theme</div>
            <div className="mm-item" onClick={logout}><Icon name="logout" size={16} /> Logout</div>
          </div>
        </div>
      )}
    </div>
  );
}

function ButtonBar({ buttons = [] }) {
  return (
    <div className="buttonbar">
      {buttons.length === 0 && <div className="bb-title">No actions</div>}
      {buttons.map((b, i) =>
        b.sep ? (
          <div className="bb-sep" key={i} />
        ) : b.title ? (
          <div className="bb-title" key={i}>{b.title}</div>
        ) : (
          <button key={i} className="fbtn" disabled={b.disabled} onClick={b.onClick}>
            <span className="fk">{b.label}</span>
            <span className="fl">{b.text}</span>
          </button>
        )
      )}
    </div>
  );
}

/** Hook a page uses to publish its title + function-key buttons to the frame. */
export function useScreenSetup(config, deps = []) {
  const { setScreen } = useScreen() || {};
  useEffect(() => {
    if (setScreen) setScreen(config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
