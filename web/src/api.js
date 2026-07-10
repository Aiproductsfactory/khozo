// Thin API client. Token is read from localStorage on each call.
const BASE = '/api';

function authHeader() {
  const t = localStorage.getItem('khozo_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function handle(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (path) => fetch(`${BASE}${path}`, { headers: { ...authHeader() } }).then(handle),

  post: (path, body) =>
    fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(body || {}),
    }).then(handle),

  // multipart/form-data (file uploads) — don't set Content-Type, the browser adds the boundary.
  postForm: (path, formData) =>
    fetch(`${BASE}${path}`, { method: 'POST', headers: { ...authHeader() }, body: formData }).then(handle),

  blob: async (path) => {
    const res = await fetch(`${BASE}${path}`, { headers: { ...authHeader() } });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.blob();
  },
};

export const photoSrc = (url) => (url ? (url.startsWith('data:') ? url : url) : null);
