const TZ = 'Asia/Ho_Chi_Minh';

export function fmtNum(n, digits = 2) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('vi-VN', { maximumFractionDigits: digits });
}

const dtf = new Intl.DateTimeFormat('vi-VN', {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** ISO -> "14:05 13/11/2026" giờ Việt Nam */
export function fmtDateTime(iso) {
  if (!iso) return '';
  const parts = Object.fromEntries(dtf.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.hour}:${parts.minute} ${parts.day}/${parts.month}/${parts.year}`;
}

/** "2026-11-13T08:00" (giờ VN) -> "08:00 13/11/2026" */
export function fmtVnLocal(s) {
  if (!s) return '';
  const [d, t] = s.split('T');
  const [y, m, dd] = d.split('-');
  return `${t || '00:00'} ${dd}/${m}/${y}`;
}

export function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(x)}` : `${p(m)}:${p(x)}`;
}

export const STATUS_LABEL = {
  inactive: 'Chưa kích hoạt',
  upcoming: 'Sắp mở thi',
  open: 'Đang mở thi',
  ended: 'Đã kết thúc',
};
export const STATUS_TONE = { inactive: 'slate', upcoming: 'amber', open: 'green', ended: 'red' };

export const RESULT_LABEL = { pass: 'ĐẠT', fail: 'KHÔNG ĐẠT', pending: 'Chờ chấm tự luận' };
export const RESULT_TONE = { pass: 'green', fail: 'red', pending: 'amber' };

export const KIND_LABEL = {
  yaw: 'Quay đầu khỏi màn hình',
  gaze: 'Liếc mắt khỏi màn hình',
  no_face: 'Không thấy khuôn mặt',
  multi_face: 'Phát hiện nhiều khuôn mặt',
};

export const TYPE_LABEL = { single: 'Một đáp án', multiple: 'Nhiều đáp án', essay: 'Tự luận' };

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export function isAnswered(q, v) {
  if (!q) return false;
  if (q.type === 'essay') return typeof v === 'string' && v.trim() !== '';
  return Array.isArray(v) ? v.length > 0 : !!v;
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Không đọc được tệp.'));
    r.readAsDataURL(file);
  });
}

/** "2026-11-13T08:00" (giờ VN, GMT+7) -> Date */
export function vnLocalToDate(s) {
  if (!s) return null;
  const d = new Date(`${s.length === 16 ? s + ':00' : s}+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Khoảng thời gian dạng chữ: "2 ngày 3 giờ", "4 giờ 12 phút", "8 phút" */
export function fmtSpan(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d) return `${d} ngày ${h} giờ`;
  if (h) return `${h} giờ ${mm} phút`;
  return mm ? `${mm} phút` : 'dưới 1 phút';
}
