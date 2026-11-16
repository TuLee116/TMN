import { useEffect, useRef } from 'react';

const PING_TIMEOUT = 4500; // quá 4,5 giây không có tín hiệu sống → coi như mạng đang giữ luồng
const POLL_MS = 1500; // khi đó hỏi nhanh phiên bản dữ liệu mỗi 1,5 giây

/**
 * Kết nối SSE có tự kết nối lại + dự phòng hỏi nhanh.
 * - onEvent(ev): sự kiện từ máy chủ
 * - onResync(): đồng bộ lại toàn bộ (sau khi mất kết nối, hoặc khi hỏi nhanh thấy dữ liệu đổi)
 * - versionUrl: API trả phiên bản dữ liệu (rất nhẹ); dùng khi SSE không tới kịp → độ trễ tối đa ~2–3 giây
 */
export function connect(url, onEvent, onResync, versionUrl) {
  let es = null;
  let closed = false;
  let broken = false;
  let timer = null;
  let lastMsg = Date.now();
  let ver = null;
  let polling = false;

  const checkVersion = async (resyncIfChanged) => {
    if (!versionUrl || polling) return;
    polling = true;
    try {
      const r = await fetch(versionUrl, { credentials: 'same-origin', cache: 'no-store' });
      if (r.ok) {
        const v = await r.text();
        if (resyncIfChanged && ver !== null && v !== ver) onResync?.();
        ver = v;
      }
    } catch {
      /* mất mạng – thử lại ở nhịp sau */
    } finally {
      polling = false;
    }
  };

  const open = () => {
    if (closed) return;
    es = new EventSource(url, { withCredentials: true });
    es.onopen = () => {
      lastMsg = Date.now();
      if (broken) onResync?.();
      broken = false;
    };
    es.onmessage = (e) => {
      lastMsg = Date.now();
      try {
        const ev = JSON.parse(e.data);
        if (ev.type === 'ping' || ev.type === 'hello') return;
        onEvent(ev);
        checkVersion(false); // cập nhật mốc phiên bản để không đồng bộ trùng
      } catch {
        /* bỏ qua */
      }
    };
    es.onerror = () => {
      broken = true;
      // trình duyệt tự nối lại khi còn CONNECTING; nếu đã CLOSED (vd. 401) thì thử lại sau 3 giây
      if (es.readyState === EventSource.CLOSED) {
        es.close();
        timer = setTimeout(open, 3000);
      }
    };
  };
  open();
  checkVersion(false);

  // Canh gác: luồng SSE im quá lâu (mạng giữ / proxy đệm) → hỏi nhanh phiên bản
  const watchdog = setInterval(() => {
    if (Date.now() - lastMsg > PING_TIMEOUT) checkVersion(true);
  }, POLL_MS);

  return () => {
    closed = true;
    clearTimeout(timer);
    clearInterval(watchdog);
    es?.close();
  };
}

/* ---------- Kênh admin dùng chung một kết nối ---------- */

const listeners = new Set();
let stopAdmin = null;

function ensureAdmin() {
  if (stopAdmin || !listeners.size) return;
  stopAdmin = connect(
    '/api/admin/stream',
    (ev) => listeners.forEach((l) => l(ev)),
    () => listeners.forEach((l) => l({ type: 'resync' })),
    '/api/admin/version'
  );
}

/**
 * Gọi cb (đã gom nhịp `delay` ms) khi có sự kiện admin thỏa match(ev).
 * Sự kiện 'resync' (kết nối lại) luôn kích hoạt cb.
 */
export function useAdminLive(match, cb, delay = 800) {
  const cbRef = useRef(cb);
  const matchRef = useRef(match);
  cbRef.current = cb;
  matchRef.current = match;
  useEffect(() => {
    let t = null;
    const l = (ev) => {
      if (ev.type !== 'resync' && !matchRef.current(ev)) return;
      if (t) return;
      t = setTimeout(() => {
        t = null;
        cbRef.current();
      }, delay);
    };
    listeners.add(l);
    ensureAdmin();
    return () => {
      clearTimeout(t);
      listeners.delete(l);
      if (!listeners.size && stopAdmin) {
        stopAdmin();
        stopAdmin = null;
      }
    };
  }, [delay]);
}

export const isAttemptEvent = (ev) => ev.type === 'attempt' || ev.type === 'attempts_cleared' || ev.type === 'participants';
export const isResultEvent = (ev) =>
  (ev.type === 'attempt' && ['submit', 'grade', 'reset'].includes(ev.kind)) || ev.type === 'attempts_cleared';
