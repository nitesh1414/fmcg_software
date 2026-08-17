import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getBusinessId, setBusinessId } from './api/client';

const BusinessCtx = createContext(null);

export function BusinessProvider({ children }) {
  const [list, setList] = useState([]);
  const [activeId, setActiveIdState] = useState(getBusinessId());
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const rows = await api.get('/businesses');
      setList(rows);
      // Pick a valid active business: stored → default → first.
      const stored = getBusinessId();
      let active = rows.find((b) => b.id === stored);
      if (!active) active = rows.find((b) => b.is_default) || rows[0];
      if (active) {
        setBusinessId(active.id);
        setActiveIdState(active.id);
      }
      return rows;
    } catch (_) {
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Switch active business → persist + reload the whole app so every screen
  // refetches under the new business context.
  const switchTo = useCallback((id) => {
    if (!id || id === getBusinessId()) return;
    setBusinessId(id);
    setActiveIdState(id);
    // Simplest correct approach: full reload so all cached data refetches.
    window.location.reload();
  }, []);

  // Soft switch (no page reload) — used inside forms like the voucher so an
  // in-progress entry isn't lost. Callers are responsible for re-fetching any
  // business-scoped data (items/stock, parties) after calling this.
  const setActive = useCallback((id) => {
    if (!id || id === getBusinessId()) return;
    setBusinessId(id);         // persists + dispatches 'rs-business-changed'
    setActiveIdState(id);
  }, []);

  const active = list.find((b) => b.id === activeId) || list.find((b) => b.is_default) || list[0] || null;
  const multi = list.length > 1;

  return (
    <BusinessCtx.Provider value={{ list, active, activeId: active ? active.id : null, multi, loading, reload, switchTo, setActive }}>
      {children}
    </BusinessCtx.Provider>
  );
}

export const useBusiness = () =>
  useContext(BusinessCtx) || { list: [], active: null, activeId: null, multi: false, loading: false, reload: () => {}, switchTo: () => {}, setActive: () => {} };
