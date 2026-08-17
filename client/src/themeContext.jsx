import { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { loadThemePrefs, saveThemePrefs, applyTheme } from './theme';
import { useAuth } from './auth';
import { api } from './api/client';

const ThemeCtx = createContext(null);

export function ThemeProvider({ children }) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState(() => loadThemePrefs());
  const lastUserId = useRef(null);
  const ready = useRef(false); // becomes true once initial user theme is loaded

  // When the logged-in user changes, load THEIR saved theme.
  useEffect(() => {
    if (!user) {
      // logged out: fall back to last-used (shared) theme, allow re-init on next login
      lastUserId.current = null;
      ready.current = false;
      const p = loadThemePrefs();
      setPrefs(p);
      applyTheme(p);
      return;
    }
    if (lastUserId.current === user.id) return; // same user, nothing to reload
    lastUserId.current = user.id;
    ready.current = false;

    // 1) instant: per-user cache from localStorage
    const cached = loadThemePrefs(user.id);
    setPrefs(cached);
    applyTheme(cached);

    // 2) authoritative: theme saved on the server (from /auth/me or login payload)
    const fromServer = user.theme && Object.keys(user.theme).length ? user.theme : null;
    const finalPrefs = fromServer ? { ...cached, ...fromServer } : cached;
    setPrefs(finalPrefs);
    applyTheme(finalPrefs);
    saveThemePrefs(finalPrefs, user.id);
    // mark ready on next tick so we don't immediately PUT what we just loaded
    setTimeout(() => { ready.current = true; }, 0);
  }, [user]);

  // Apply + persist whenever prefs change.
  useEffect(() => {
    applyTheme(prefs);
    saveThemePrefs(prefs, user ? user.id : undefined);
    // Persist to server only for changes the user made after load (not the initial load).
    if (user && ready.current) {
      api.put('/auth/theme', prefs).catch(() => {});
    }
  }, [prefs]); // eslint-disable-line react-hooks/exhaustive-deps

  const setPalette = useCallback((palette) => setPrefs((p) => ({ ...p, palette })), []);
  const setDensity = useCallback((density) => setPrefs((p) => ({ ...p, density })), []);
  const setTextSize = useCallback((textSize) => setPrefs((p) => ({ ...p, textSize })), []);

  return (
    <ThemeCtx.Provider value={{ prefs, setPalette, setDensity, setTextSize, setPrefs }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export const useTheme = () => useContext(ThemeCtx) || { prefs: {}, setPalette: () => {}, setDensity: () => {}, setTextSize: () => {} };
