/** Gọi API JSON. Lỗi ném Error có .status và .data */
export async function api(path, { method = 'GET', body, raw, keepalive } = {}) {
  const opts = { method, headers: {}, credentials: 'same-origin', keepalive: !!keepalive };
  if (raw !== undefined) {
    opts.body = raw;
    opts.headers['content-type'] = 'application/octet-stream';
  } else if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers['content-type'] = 'application/json';
  }
  let r;
  try {
    r = await fetch('/api' + path, opts);
  } catch {
    const e = new Error('Không kết nối được máy chủ. Kiểm tra mạng và thử lại.');
    e.status = 0;
    throw e;
  }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json().catch(() => null) : null;
  if (!r.ok) {
    const e = new Error(data?.error || `Lỗi máy chủ (${r.status})`);
    e.status = r.status;
    e.data = data;
    if (r.status === 401 && path.startsWith('/admin/') && path !== '/admin/login') {
      window.dispatchEvent(new Event('tmn-admin-401'));
    }
    throw e;
  }
  return data;
}

function filenameFrom(disposition, fallback) {
  const m = /filename\*=UTF-8''([^;]+)/i.exec(disposition || '');
  if (m) return decodeURIComponent(m[1]);
  const m2 = /filename="?([^";]+)"?/i.exec(disposition || '');
  return m2 ? m2[1] : fallback;
}

/** Tải tệp từ API về máy */
export async function download(path, fallbackName = 'tai_ve') {
  const r = await fetch('/api' + path, { credentials: 'same-origin' });
  if (!r.ok) {
    const data = await r.json().catch(() => null);
    throw new Error(data?.error || `Không tải được tệp (${r.status})`);
  }
  const blob = await r.blob();
  const name = filenameFrom(r.headers.get('content-disposition'), fallbackName);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}
