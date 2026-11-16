import { EventEmitter } from 'node:events';

/**
 * Bộ phát sự kiện thời gian thực (SSE).
 * type: 'settings' | 'participants' | 'attempt' | 'attempts_cleared'
 * Với 'attempt': { id, kind: 'start' | 'progress' | 'submit' | 'grade' | 'reset' | 'warning' }
 * Lưu ý: chạy trong bộ nhớ – đủ cho 1 máy chủ (Railway 1 replica).
 */
export const bus = new EventEmitter();
bus.setMaxListeners(0);

// Số phiên bản dữ liệu – để trình duyệt hỏi nhẹ "có gì mới không" khi luồng SSE bị mạng giữ lại
export const versions = { all: 0, settings: 0, cleared: 0, attempt: new Map() };

export function emit(type, data = {}) {
  versions.all++;
  if (type === 'settings') versions.settings++;
  if (type === 'attempts_cleared') {
    versions.cleared++;
    versions.attempt.clear();
  }
  if (type === 'attempt' && data.id && data.kind !== 'progress' && data.kind !== 'warning') {
    versions.attempt.set(data.id, (versions.attempt.get(data.id) || 0) + 1);
  }
  bus.emit('event', { type, ...data, at: Date.now() });
}

/** Mở luồng SSE; filter(ev) trả về sự kiện cần gửi hoặc null */
export function openStream(req, res, filter) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write('retry: 2000\n\n');
  res.write(`data: ${JSON.stringify({ type: 'hello', at: Date.now() })}\n\n`);
  const send = (ev) => {
    const out = filter(ev);
    if (out) res.write(`data: ${JSON.stringify(out)}\n\n`);
  };
  bus.on('event', send);
  // Tín hiệu sống mỗi 2 giây: trình duyệt dùng để phát hiện mạng giữ luồng (chuyển sang hỏi nhanh)
  const ping = setInterval(() => res.write(`data: {"type":"ping"}\n\n`), 2_000);
  req.on('close', () => {
    clearInterval(ping);
    bus.off('event', send);
  });
}
