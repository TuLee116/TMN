import { useEffect, useRef } from 'react';

/**
 * Kết nối SSE có tự kết nối lại. onEvent nhận sự kiện; onResync gọi khi kết nối lại sau gián đoạn
 * (đồng bộ lại toàn bộ để không bỏ sót thay đổi trong lúc mất mạng).
 */
export function connect(url, onEvent, onResync) {
  let es = null;
  let closed = false;
  let broken = false;
  let timer = null;
  const open = () => {
    if (closed) return;
    es = new EventSource(url, { withCredentials: true });
    es.onopen = () => {
      if (broken) onResync?.();
      broken = false;
    };
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.type !== 'hello') onEvent(ev);
      } catch {
        /* bỏ qua */
      }
    };
    es.onerror = () => {
      broken = true;
      // trình duyệt tự kết nối lại khi còn CONNECTING; nếu đã CLOSED (vd. 401) thì thử lại sau 5 giây
      if (es.readyState === EventSource.CLOSED) {
        es.close();
        timer = setTimeout(open, 5000);
      }
    };
  };
  open();
  return () => {
    closed = true;
    clearTimeout(timer);
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
    () => listeners.forEach((l) => l({ type: 'resync' }))
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
