import { useEffect } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { ToastProvider } from './components/ui';
import { KeyboardProvider } from './keyboard';
import { FeatureProvider } from './features';
import { BusinessProvider } from './business';
import { TallyFrame } from './components/TallyFrame';
import ErrorBoundary from './components/ErrorBoundary';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Items from './pages/Items';
import Inventory from './pages/Inventory';
import SerialLookup from './pages/SerialLookup';
import WhatsApp from './pages/WhatsApp';
import Parties from './pages/Parties';
import Invoices from './pages/Invoices';
import Payments from './pages/Payments';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Help from './pages/Help';
import Support from './pages/Support';
import Migrate from './pages/Migrate';
import License from './pages/License';
import Users from './pages/Users';
import Businesses from './pages/Businesses';
import Eway from './pages/Eway';
import { can, isAdmin } from './auth';

// Block direct-URL access to a screen the user has no permission for.
function Guard({ user, mod, level = 'read', adminOnly, children }) {
  if (adminOnly && !isAdmin(user)) return <Navigate to="/" replace />;
  if (mod && !can(user, mod, level)) return <Navigate to="/" replace />;
  return children;
}

// Persistent shell: providers + chrome mount ONCE and stay mounted while the
// inner <Outlet/> swaps screens. An ErrorBoundary keyed by route keeps a crash
// on one screen from blanking the whole app.
function Shell() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();
  useEffect(() => {
    const h = () => logout();
    window.addEventListener('app-logout', h);
    return () => window.removeEventListener('app-logout', h);
  }, [logout]);
  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <KeyboardProvider>
      <ToastProvider>
        <BusinessProvider>
          <FeatureProvider>
            <TallyFrame>
              <ErrorBoundary routeKey={location.pathname + location.search}>
                <Outlet />
              </ErrorBoundary>
            </TallyFrame>
          </FeatureProvider>
        </BusinessProvider>
      </ToastProvider>
    </KeyboardProvider>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user && !loading ? <Navigate to="/" replace /> : <Login />} />
      <Route element={<Shell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/sales" element={<Guard user={user} mod="sales"><Invoices type="sale" /></Guard>} />
        <Route path="/quotations" element={<Guard user={user} mod="sales"><Invoices type="quotation" /></Guard>} />
        <Route path="/purchases" element={<Guard user={user} mod="purchase"><Invoices type="purchase" /></Guard>} />
        <Route path="/payments" element={<Guard user={user} mod="payments"><Payments /></Guard>} />
        <Route path="/eway" element={<Guard user={user} mod="payments"><Eway /></Guard>} />
        <Route path="/items" element={<Guard user={user} mod="items"><Items /></Guard>} />
        <Route path="/inventory" element={<Guard user={user} mod="items"><Inventory /></Guard>} />
        <Route path="/serials" element={<Guard user={user} mod="items"><SerialLookup /></Guard>} />
        <Route path="/whatsapp" element={<Guard user={user} mod="sales"><WhatsApp /></Guard>} />
        <Route path="/parties" element={<Guard user={user} mod="parties"><Parties /></Guard>} />
        <Route path="/reports" element={
          (can(user, 'reports', 'read') || can(user, 'gst', 'read')) ? <Reports /> : <Navigate to="/" replace />
        } />
        <Route path="/settings" element={<Guard user={user} adminOnly><Settings /></Guard>} />
        <Route path="/help" element={<Help />} />
        <Route path="/support" element={<Support />} />
        <Route path="/migrate" element={<Guard user={user} adminOnly><Migrate /></Guard>} />
        <Route path="/license" element={<Guard user={user} adminOnly><License /></Guard>} />
        <Route path="/users" element={<Guard user={user} adminOnly><Users /></Guard>} />
        <Route path="/businesses" element={<Guard user={user} adminOnly><Businesses /></Guard>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
