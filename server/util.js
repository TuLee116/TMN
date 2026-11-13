import crypto from 'node:crypto';

export const EMAIL_DOMAIN = (process.env.EMAIL_DOMAIN || 'tanminhnhan.com.vn').toLowerCase();
export const MAX_PARTICIPANTS = Number(process.env.MAX_PARTICIPANTS || 1000);
export const TEST_MODE = process.env.TEST_MODE === 'true';
const SECRET = process.env.SESSION_SECRET || 'doi-chuoi-bi-mat-nay-tren-railway';

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** "2026-11-12T09:20" (giờ Việt Nam) -> Date */
export function vnToDate(s) {
  if (!s) return null;
  const d = new Date(`${s.length === 16 ? s + ':00' : s}+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date -> "12/11/2026 09:20" giờ Việt Nam */
export function fmtVN(d) {
  if (!d) return '';
  const x = new Date(new Date(d).getTime() + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(x.getUTCDate())}/${p(x.getUTCMonth() + 1)}/${x.getUTCFullYear()} ${p(x.getUTCHours())}:${p(x.getUTCMinutes())}`;
}

export function examStatus(settings, now = new Date()) {
  if (!settings.active) return 'inactive';
  const open = vnToDate(settings.openingAt);
  const close = vnToDate(settings.closingAt);
  if (open && now < open) return 'upcoming';
  if (close && now > close) return 'ended';
  return 'open';
}

export function normalizeEmail(e) {
  return String(e || '').trim().toLowerCase();
}

export function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export function isCompanyEmail(e) {
  return isValidEmail(e) && e.endsWith('@' + EMAIL_DOMAIN);
}

function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
}

export function makeSigned(value) {
  return `${value}.${sign(value)}`;
}

export function readSigned(raw) {
  if (!raw) return null;
  const i = raw.lastIndexOf('.');
  if (i < 0) return null;
  const value = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const expected = sign(value);
  if (sig.length !== expected.length) return null;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? value : null;
}

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setCookie(res, name, value, { maxAge, secure } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAge != null) parts.push(`Max-Age=${maxAge}`);
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

export function safePasswordEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const round2 = (n) => Math.round(Number(n) * 100) / 100;

export function maxScoreOf(s) {
  return round2(s.multipleChoiceCount * s.mcPointsPerQuestion + s.essayCount * s.essayPointsPerQuestion);
}

/** Đổi điểm về thang 10 */
export function to10(total, max) {
  if (total == null || !max) return null;
  return round2((Number(total) / Number(max)) * 10);
}

export const SCORE_BUCKETS = [
  { label: 'Dưới 5', min: -1, max: 5 },
  { label: '5–6,9', min: 5, max: 7 },
  { label: '7–7,9', min: 7, max: 8 },
  { label: '8–8,9', min: 8, max: 9 },
  { label: 'Từ 9 trở lên', min: 9, max: 100 },
];

export function sameSet(a, b) {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

export const SUBMIT_REASON_LABEL = {
  manual: 'Thí sinh nộp',
  timeout: 'Hết giờ',
  tab_switch: 'Tự nộp do chuyển tab',
  webcam: 'Tự nộp do vi phạm webcam',
  finalized: 'Quản trị chốt bài hết hạn',
};
