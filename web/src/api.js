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

  del: (path) => fetch(`${BASE}${path}`, { method: 'DELETE', headers: { ...authHeader() } }).then(handle),

  // multipart/form-data (file uploads) — don't set Content-Type, the browser adds the boundary.
  postForm: (path, formData) =>
    fetch(`${BASE}${path}`, { method: 'POST', headers: { ...authHeader() }, body: formData }).then(handle),

  /**
   * postForm with upload progress: `onProgress` receives 0..1 as the body is
   * sent, so a reporter on a slow connection sees their photo going rather than
   * a frozen button. A network failure rejects with `network: true` (and the
   * same "Failed to fetch" message fetch gives), which is what sends a report
   * to the offline queue.
   */
  postFormWithProgress: (path, formData, onProgress) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}${path}`);
      for (const [name, value] of Object.entries(authHeader())) xhr.setRequestHeader(name, value);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total) onProgress?.(event.loaded / event.total);
      };
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText || '{}'); } catch {}
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(1);
          resolve(data);
          return;
        }
        const err = new Error(data.error || `Request failed (${xhr.status})`);
        err.status = xhr.status;
        err.data = data;
        reject(err);
      };
      const networkError = () => reject(Object.assign(new TypeError('Failed to fetch'), { network: true }));
      xhr.onerror = networkError;
      xhr.ontimeout = networkError;
      xhr.send(formData);
    }),

  blob: async (path) => {
    const res = await fetch(`${BASE}${path}`, { headers: { ...authHeader() } });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.blob();
  },
};

export const photoSrc = (url) => (url ? (url.startsWith('data:') ? url : url) : null);
