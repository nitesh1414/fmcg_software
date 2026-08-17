// Lightweight API client with token handling
const API_BASE = '/api';

export function getToken() {
  return localStorage.getItem('fmcg_token');
}
export function setToken(t) {
  if (t) localStorage.setItem('fmcg_token', t);
  else localStorage.removeItem('fmcg_token');
}

// Active business (multi-business support). Stored locally; sent on every
// request as X-Business-Id so the server scopes transactions/stock/reports.
export function getBusinessId() {
  const v = localStorage.getItem('fmcg_business');
  return v ? Number(v) : null;
}
export function setBusinessId(id) {
  if (id) localStorage.setItem('fmcg_business', String(id));
  else localStorage.removeItem('fmcg_business');
  try { window.dispatchEvent(new CustomEvent('rs-business-changed', { detail: id })); } catch (_) {}
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const token = getToken();
  const bid = getBusinessId();
  const res = await fetch(API_BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(bid ? { 'X-Business-Id': String(bid) } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    setToken(null);
    if (!path.startsWith('/auth')) window.location.href = '/login';
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error((data && (data.message || data.error)) || 'Request failed');
    err.code = (data && (data.code || data.error)) || undefined;
    err.status = res.status;
    err.data = data;
    if (res.status === 423) {
      // License read-only mode — let the whole app know so it can show a banner.
      try { window.dispatchEvent(new CustomEvent('rs-readonly')); } catch (_) {}
    }
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => request(p),
  post: (p, body) => request(p, { method: 'POST', body }),
  put: (p, body) => request(p, { method: 'PUT', body }),
  patch: (p, body) => request(p, { method: 'PATCH', body }),
  del: (p) => request(p, { method: 'DELETE' }),
};

// Fetch a PDF (with auth) and return an object URL. Caller must revoke it.
export async function fetchPdfUrl(path) {
  const token = getToken();
  const bid = getBusinessId();
  const res = await fetch(API_BASE + path, { headers: { Authorization: 'Bearer ' + token, ...(bid ? { 'X-Business-Id': String(bid) } : {}) } });
  if (!res.ok) throw new Error('Could not load PDF');
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// Open a PDF in a new tab with auth via blob
export async function openPdf(path) {
  const url = await fetchPdfUrl(path);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// POST a JSON body and open the returned PDF (used for bill-format previews).
export async function openPdfPost(path, body) {
  const token = getToken();
  const bid = getBusinessId();
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(bid ? { 'X-Business-Id': String(bid) } : {}) },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) throw new Error('Preview failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Download an authenticated file (e.g. a full data backup) to disk.
export async function downloadFile(path, filename) {
  const token = getToken();
  const bid = getBusinessId();
  const res = await fetch(API_BASE + path, { headers: { Authorization: 'Bearer ' + token, ...(bid ? { 'X-Business-Id': String(bid) } : {}) } });
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
