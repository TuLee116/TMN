import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { q } from './db.js';

/* ------------------------------------------------------------------ */
/* Mật khẩu                                                            */
/* ------------------------------------------------------------------ */

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const got = crypto.scryptSync(String(pw), salt, 32);
  const want = Buffer.from(hash, 'hex');
  return want.length === got.length && crypto.timingSafeEqual(got, want);
}

export const ROLE_LABEL = { admin: 'Quản trị', grader: 'Giám khảo' };

/* ------------------------------------------------------------------ */
/* Nhật ký thao tác                                                    */
/* ------------------------------------------------------------------ */

export const AUDIT_LABEL = {
  login: 'Đăng nhập',
  login_failed: 'Đăng nhập thất bại',
  settings_save: 'Lưu cấu hình',
  logo_change: 'Đổi logo',
  project_add: 'Thêm công trình',
  project_update: 'Sửa công trình',
  project_delete: 'Xóa công trình',
  participants_import: 'Nhập danh sách email',
  participants_add: 'Thêm email',
  participants_delete: 'Xóa danh sách email',
  questions_import: 'Nhập câu hỏi',
  question_add: 'Thêm câu hỏi',
  question_edit: 'Sửa câu hỏi',
  question_delete: 'Xóa câu hỏi',
  question_toggle: 'Ẩn / hiện câu hỏi',
  grade_essay: 'Chấm tự luận',
  force_submit: 'Thu bài thí sinh',
  reconcile: 'Chốt bài hết hạn',
  export_zip: 'Tải ZIP hồ sơ',
  clear_results: 'Xóa dữ liệu bài làm',
  round_archive: 'Kết thúc & lưu trữ đợt thi',
  round_export: 'Tải ZIP đợt cũ',
  round_delete: 'Xóa đợt thi đã lưu',
  user_add: 'Thêm tài khoản',
  user_update: 'Sửa tài khoản',
  user_delete: 'Xóa tài khoản',
  email_send: 'Gửi email kết quả',
  email_test: 'Gửi email thử',
};

export async function audit(req, action, detail = null) {
  try {
    const u = req.adminUser;
    await q(`INSERT INTO audit_log(actor, role, action, detail, ip) VALUES ($1,$2,$3,$4,$5)`, [
      u ? u.username : String(detail?.username || ''),
      u ? u.role : '',
      action,
      detail,
      String(req.ip || '').slice(0, 64),
    ]);
  } catch (e) {
    console.error('audit error', e.message);
  }
}

/* ------------------------------------------------------------------ */
/* Gửi email: Resend (HTTPS) hoặc SMTP                                  */
/* ------------------------------------------------------------------ */

export function mailConfig() {
  const from = process.env.MAIL_FROM || process.env.SMTP_FROM || '';
  if (process.env.RESEND_API_KEY) return { provider: 'Resend', from: from || 'onboarding@resend.dev', ok: true };
  if (process.env.SMTP_HOST) return { provider: 'SMTP', from: from || process.env.SMTP_USER || '', ok: !!(from || process.env.SMTP_USER) };
  return { provider: '', from: '', ok: false };
}

let smtp = null;
function smtpTransport() {
  if (!smtp) {
    const port = Number(process.env.SMTP_PORT || 587);
    smtp = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
    });
  }
  return smtp;
}

export async function sendMail({ to, subject, text }) {
  const cfg = mailConfig();
  if (!cfg.ok) throw new Error('Chưa cấu hình gửi email (RESEND_API_KEY hoặc SMTP_HOST + MAIL_FROM).');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#0f172a">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
  if (cfg.provider === 'Resend') {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: cfg.from, to: [to], subject, text, html }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`Resend ${r.status}: ${body.slice(0, 200)}`);
    }
    return;
  }
  await smtpTransport().sendMail({ from: cfg.from, to, subject, text, html });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Thay {ho_ten}, {ky_thi}… trong mẫu email */
export function fillTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k] ?? '') : m));
}
