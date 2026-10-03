// Cliente HTTP con token de sesión.
let token = localStorage.getItem('token') || null;
let onUnauthorized = () => {};

export const setToken = (t) => { token = t; t ? localStorage.setItem('token', t) : localStorage.removeItem('token'); };
export const getToken = () => token;
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(method, url, body) {
  const opts = { method, headers: {} };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch('/api' + url, opts);
  if (res.status === 401 && !url.startsWith('/auth/login')) { onUnauthorized(); }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b) => request('POST', u, b ?? {}),
  put: (u, b) => request('PUT', u, b ?? {}),
  del: (u) => request('DELETE', u),
  upload: (u, form) => request('POST', u, form),
};

/** Descarga un archivo autenticado (PDF, Excel, TXT). Los PDF e imágenes se abren en una pestaña. */
export async function openFile(u, filename) {
  const win = /\.pdf|receipt|files\//.test(u) && !filename ? window.open('', '_blank') : null;
  const res = await fetch('/api' + u, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { win?.close(); const d = await res.json().catch(() => ({})); throw new Error(d.error || 'No se pudo descargar'); }
  const url = URL.createObjectURL(await res.blob());
  if (win) { win.location.href = url; return; }
  const name = filename || res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] || 'archivo';
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export const qs = (o) => '?' + new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
