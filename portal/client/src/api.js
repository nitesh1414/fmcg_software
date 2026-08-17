const TOKEN_KEY = 'rs_portal_token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

// Backend base URL. Set VITE_API_BASE in the client's .env when the API server
// is deployed on a DIFFERENT host than the static frontend, e.g.
//   VITE_API_BASE=https://api.rightserve.com
// Leave empty to call the same origin that serves the app (default / single-server).
const RAW_BASE = (import.meta.env.VITE_API_BASE || '').trim().replace(/\/+$/, '');
export const API_BASE = RAW_BASE; // exported so other code can reference it
const apiUrl = (path) => `${RAW_BASE}/api${path}`;

async function request(path, { method = 'GET', body } = {}) {
  const token = getToken();
  const res = await fetch(apiUrl(path), {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    setToken(null);
    if (!path.startsWith('/auth')) window.location.href = '/login';
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error((data && (data.error || data.message)) || 'Request failed');
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => request(p),
  post: (p, body) => request(p, { method: 'POST', body }),
  put: (p, body) => request(p, { method: 'PUT', body }),
  del: (p) => request(p, { method: 'DELETE' }),
};
