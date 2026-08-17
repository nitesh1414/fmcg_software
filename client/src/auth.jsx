import { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api/client';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) { setLoading(false); return; }
    api.get('/auth/me').then(setUser).catch(() => setToken(null)).finally(() => setLoading(false));
  }, []);

  const login = async (username, password) => {
    const res = await api.post('/auth/login', { username, password });
    setToken(res.token);
    setUser(res.user);
    return res.user;
  };
  // First-run admin creation (security Q&A required for password recovery).
  const register = async (payload) => {
    const res = await api.post('/auth/register', payload);
    setToken(res.token);
    setUser(res.user);
    return res.user;
  };
  const logout = () => { setToken(null); setUser(null); window.location.href = '/login'; };

  return (
    <AuthCtx.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);

// Permission helper: admin (permissions === null) has full access.
// level: 'read' | 'write'. Returns true if the user meets/exceeds it.
export function can(user, moduleName, level = 'read') {
  if (!user) return false;
  if (user.role === 'admin' || user.permissions == null) return true;
  const have = (user.permissions && user.permissions[moduleName]) || 'none';
  const rank = { none: 0, read: 1, write: 2 };
  return rank[have] >= rank[level];
}
export const isAdmin = (user) => !!user && user.role === 'admin';
