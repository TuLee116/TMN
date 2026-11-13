import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { q, tx, initSchema, getSettings, saveSettings, getLogo, saveLogo, DEFAULT_SETTINGS } from './db.js';
import {
  HttpError,
  TEST_MODE,
  EMAIL_DOMAIN,
  MAX_PARTICIPANTS,
  examStatus,
  vnToDate,
  normalizeEmail,
  isCompanyEmail,
  isValidEmail,
  makeSigned,
  readSigned,
  parseCookies,
  setCookie,
  safePasswordEqual,
  shuffle,
  round2,
  maxScoreOf,
  to10,
  SCORE_BUCKETS,
  SUBMIT_REASON_LABEL,
} from './util.js';
import {
  questionMap,
  grade,
  sanitizeAnswers,
  submitAttempt,
  finalizeOverdue,
  regrade,
  isAnswered,
  participationStatus,
  PARTICIPATION_LABEL,
} from './attempts.js';
import {
  parseQuestionsXlsx,
  parseQuestionsDocx,
  questionTemplateXlsx,
  questionTemplateDocx,
  parseParticipantsXlsx,
  participantTemplateXlsx,
} from './importer.js';
import { renderAttemptPdf } from './pdf.js';
import { writeResultsZip, loadEvents, pdfFileName } from './export.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const EXAM_COOKIE = 'tmn_exam';
const ADMIN_COOKIE = 'tmn_admin';
const ADMIN_TTL_SEC = 12 * 3600;
const ANSWER_GRACE_MS = 30_000;
const MAX_SNAPSHOTS = 20;
const MAX_EVENTS = 500;

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const isSecure = (req) => req.secure;
const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function sendFile(res, buf, mime, filename) {
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(buf);
}

const rawUpload = (limit) => express.raw({ type: () => true, limit });

app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.use('/api', express.json({ limit: '2mb' }));

/* ------------------------------------------------------------------ */
/* Tiện ích chung                                                       */
/* ------------------------------------------------------------------ */

function publicSettings(s) {
  return {
    title: s.title,
    openingAt: s.openingAt,
    closingAt: s.closingAt,
    durationMinutes: s.durationMinutes,
    multipleChoiceCount: s.multipleChoiceCount,
    mcPointsPerQuestion: s.mcPointsPerQuestion,
    essayCount: s.essayCount,
    essayPointsPerQuestion: s.essayPointsPerQuestion,
    passingScore: s.passingScore,
    maxScore: maxScoreOf(s),
    displayMode: s.displayMode,
    showScore: s.showScore,
    webcamEnabled: s.webcamEnabled,
    webcamRequired: s.webcamRequired,
  };
}

function webcamConfig(s) {
  return {
    enabled: !!s.webcamEnabled,
    required: !!s.webcamRequired,
    holdSeconds: Number(s.webcamHoldSeconds) || 2,
    yawThreshold: Number(s.webcamYawThreshold) || 0.12,
    gazeThreshold: Number(s.webcamGazeThreshold) || 0.18,
    maxWarnings: Number(s.webcamMaxWarnings) || 0,
  };
}

async function attemptFromCookie(req) {
  const token = readSigned(parseCookies(req)[EXAM_COOKIE]);
  if (!token) return null;
  const r = await q(`SELECT * FROM exam_attempts WHERE token=$1`, [token]);
  return r.rows[0] || null;
}

async function requireAttempt(req) {
  const a = await attemptFromCookie(req);
  if (!a) throw new HttpError(401, 'Không tìm thấy lượt thi. Vui lòng tải lại trang.');
  return a;
}

/** Trạng thái lượt thi gửi cho thí sinh (không lộ đáp án) */
async function candidateView(a, qmap) {
  const s = a.settings_snapshot;
  const current = await getSettings();
  const base = {
    id: a.id,
    seq: a.seq,
    name: a.name,
    email: a.email,
    title: s.title,
    startedAt: a.started_at,
    deadlineAt: a.deadline_at,
    submittedAt: a.submitted_at,
    submitReason: a.submit_reason,
    submitReasonLabel: SUBMIT_REASON_LABEL[a.submit_reason] || null,
    serverNow: new Date().toISOString(),
    displayMode: s.displayMode,
    webcam: webcamConfig(s),
    webcamWarnings: a.webcam_warnings,
    testMode: TEST_MODE,
  };
  if (!a.submitted_at) {
    const questions = a.question_ids
      .map((id) => qmap.get(id))
      .filter(Boolean)
      .map((x) => ({ id: x.id, type: x.type, text: x.text, options: x.options }));
    return { ...base, status: 'in_progress', questions, answers: a.answers };
  }
  const answered = a.question_ids.filter((id) => isAnswered(qmap.get(id), a.answers[id])).length;
  const out = { ...base, status: 'submitted', answeredCount: answered, questionCount: a.question_ids.length };
  if (current.showScore) {
    const g = grade(a, qmap);
    out.result = {
      result: a.result,
      pending: a.result === 'pending' || g.pending,
      tabViolation: a.tab_violation,
      mcCorrect: g.mc_correct,
      mcTotal: g.mc_total,
      mcScore: g.mc_score,
      totalScore: a.total_score,
      maxScore: a.max_score,
      score10: to10(a.total_score, a.max_score),
      passingScore: s.passingScore,
    };
  } else {
    out.result = { hidden: true };
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Logo & webcam assets                                                */
/* ------------------------------------------------------------------ */

app.get(
  '/api/logo',
  wrap(async (_req, res) => {
    const logo = await getLogo();
    if (!logo?.data) {
      const fallback = [path.join(DIST, 'logo.png'), path.join(ROOT, 'public', 'logo.png')].find((p) => fs.existsSync(p));
      if (fallback) return res.sendFile(fallback);
      return res.status(404).end();
    }
    res.setHeader('Content-Type', logo.mime);
    res.setHeader('Cache-Control', 'no-cache');
    res.send(Buffer.from(logo.data, 'base64'));
  })
);

// WASM của MediaPipe phục vụ trực tiếp từ node_modules (không phụ thuộc CDN)
const MP_WASM = path.join(ROOT, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
if (fs.existsSync(MP_WASM)) app.use('/mediapipe/wasm', express.static(MP_WASM, { maxAge: '7d' }));

/* ------------------------------------------------------------------ */
/* API thí sinh                                                        */
/* ------------------------------------------------------------------ */

app.get(
  '/api/exam/info',
  wrap(async (_req, res) => {
    const s = await getSettings();
    const [projects, counts, logo] = await Promise.all([
      q(`SELECT id, name FROM projects WHERE active ORDER BY name`),
      q(`SELECT type, count(*)::int AS n FROM questions WHERE active GROUP BY type`),
      getLogo(),
    ]);
    const bank = { mc: 0, essay: 0 };
    for (const r of counts.rows) {
      if (r.type === 'essay') bank.essay += r.n;
      else bank.mc += r.n;
    }
    res.json({
      settings: publicSettings(s),
      status: examStatus(s),
      openingLabel: s.openingAt ? s.openingAt.replace('T', ' ') : '',
      closingLabel: s.closingAt ? s.closingAt.replace('T', ' ') : '',
      projects: projects.rows,
      bankReady: bank.mc >= s.multipleChoiceCount && bank.essay >= s.essayCount,
      emailDomain: EMAIL_DOMAIN,
      hasLogo: !!logo,
      testMode: TEST_MODE,
      serverNow: new Date().toISOString(),
    });
  })
);

app.post(
  '/api/exam/start',
  wrap(async (req, res) => {
    const s = await getSettings();
    const status = examStatus(s);
    if (status !== 'open') {
      const msg = { inactive: 'Kỳ thi chưa được kích hoạt.', upcoming: 'Chưa đến giờ kiểm tra.', ended: 'Kỳ thi đã kết thúc.' };
      throw new HttpError(403, msg[status]);
    }
    const body = req.body || {};
    const name = String(body.name || '').trim().slice(0, 120);
    const email = normalizeEmail(body.email);
    const jobTitle = String(body.jobTitle || '').trim().slice(0, 120);
    const level = String(body.level || '').trim().slice(0, 60);
    const projectId = body.projectId || null;
    if (!name) throw new HttpError(400, 'Vui lòng nhập họ và tên.');
    if (!isCompanyEmail(email)) throw new HttpError(400, `Email phải có đuôi @${EMAIL_DOMAIN}.`);
    if (!jobTitle) throw new HttpError(400, 'Vui lòng nhập chức danh / vị trí.');
    if (!level) throw new HttpError(400, 'Vui lòng nhập cấp bậc.');
    if (!body.agree) throw new HttpError(400, 'Bạn cần xác nhận cam kết tuân thủ nội quy.');

    const participant = (await q(`SELECT * FROM participants WHERE email=$1`, [email])).rows[0];
    if (!participant) throw new HttpError(403, 'Email chưa có trong danh sách được duyệt tham gia kiểm tra.');

    const activeProjects = (await q(`SELECT id FROM projects WHERE active`)).rows;
    if (activeProjects.length) {
      if (!projectId || !activeProjects.some((p) => p.id === projectId)) {
        throw new HttpError(400, 'Vui lòng chọn địa điểm kiểm tra.');
      }
    }

    // Đã có lượt thi
    const existing = (await q(`SELECT * FROM exam_attempts WHERE email=$1`, [email])).rows[0];
    if (existing) {
      const mine = await attemptFromCookie(req);
      if (mine?.id === existing.id) return res.json({ ok: true, resumed: true });
      throw new HttpError(409, 'Email này đã có lượt kiểm tra. Mỗi email chỉ được làm một lần.');
    }

    // Chọn đề ngẫu nhiên
    const mc = (
      await q(`SELECT id, position FROM questions WHERE active AND type <> 'essay' ORDER BY random() LIMIT $1`, [
        s.multipleChoiceCount,
      ])
    ).rows;
    const es = (
      await q(`SELECT id, position FROM questions WHERE active AND type = 'essay' ORDER BY random() LIMIT $1`, [s.essayCount])
    ).rows;
    if (mc.length < s.multipleChoiceCount || es.length < s.essayCount) {
      throw new HttpError(503, 'Ngân hàng câu hỏi chưa đủ số câu theo cấu hình. Vui lòng báo quản trị viên.');
    }
    const order = (rows) => (s.shuffleQuestions ? shuffle(rows) : [...rows].sort((a, b) => a.position - b.position || a.id - b.id));
    const questionIds = [...order(mc), ...order(es)].map((r) => r.id);

    const token = crypto.randomBytes(24).toString('base64url');
    const deadline = new Date(Date.now() + Number(s.durationMinutes) * 60_000);
    try {
      await q(
        `INSERT INTO exam_attempts(token, email, seq, name, job_title, level, project_id, question_ids, deadline_at, settings_snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [token, email, participant.seq, name, jobTitle, level, projectId, JSON.stringify(questionIds), deadline, s]
      );
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'Email này đã có lượt kiểm tra. Mỗi email chỉ được làm một lần.');
      throw e;
    }
    setCookie(res, EXAM_COOKIE, makeSigned(token), { maxAge: 3 * 24 * 3600, secure: isSecure(req) });
    res.json({ ok: true });
  })
);

app.get(
  '/api/exam/state',
  wrap(async (req, res) => {
    let a = await attemptFromCookie(req);
    if (!a) return res.json({ attempt: null, testMode: TEST_MODE });
    if (!a.submitted_at && new Date(a.deadline_at).getTime() + ANSWER_GRACE_MS < Date.now()) {
      a = await submitAttempt(a.id, 'timeout');
    }
    res.json({ attempt: await candidateView(a, await questionMap()), testMode: TEST_MODE });
  })
);

const saveAnswers = wrap(async (req, res) => {
    const a = await requireAttempt(req);
    if (a.submitted_at) throw new HttpError(409, 'Bài đã nộp, không thể sửa.', { submitted: true });
    if (new Date(a.deadline_at).getTime() + ANSWER_GRACE_MS < Date.now()) {
      await submitAttempt(a.id, 'timeout');
      throw new HttpError(409, 'Đã hết giờ làm bài.', { submitted: true });
    }
    const qmap = await questionMap();
    const clean = sanitizeAnswers(req.body?.answers, a, qmap);
    const r = await q(
      `UPDATE exam_attempts SET answers = answers || $2::jsonb WHERE id=$1 AND submitted_at IS NULL RETURNING id`,
      [a.id, JSON.stringify(clean)]
    );
    if (!r.rowCount) throw new HttpError(409, 'Bài đã nộp, không thể sửa.', { submitted: true });
    res.json({ ok: true, savedAt: new Date().toISOString() });
});
// PUT khi tự lưu; POST cho navigator.sendBeacon khi đóng trang
app.route('/api/exam/answers').put(saveAnswers).post(saveAnswers);

app.post(
  '/api/exam/submit',
  wrap(async (req, res) => {
    const a = await requireAttempt(req);
    const allowed = ['manual', 'timeout', 'tab_switch', 'webcam'];
    let reason = allowed.includes(req.body?.reason) ? req.body.reason : 'manual';
    if (reason === 'tab_switch' && TEST_MODE) throw new HttpError(400, 'Chế độ thử: chuyển tab không tự nộp.');
    const late = new Date(a.deadline_at).getTime() + ANSWER_GRACE_MS < Date.now();
    if (late) reason = 'timeout';
    const done = await submitAttempt(a.id, reason, { answers: late ? null : req.body?.answers });
    res.json({ attempt: await candidateView(done, await questionMap()) });
  })
);

app.post(
  '/api/exam/reset',
  wrap(async (req, res) => {
    if (!TEST_MODE) throw new HttpError(403, 'Chỉ dùng được ở chế độ thử.');
    const a = await attemptFromCookie(req);
    if (a) await q(`DELETE FROM exam_attempts WHERE id=$1`, [a.id]);
    setCookie(res, EXAM_COOKIE, '', { maxAge: 0, secure: isSecure(req) });
    res.json({ ok: true });
  })
);

app.get(
  '/api/exam/review-pdf',
  wrap(async (req, res) => {
    const a = await requireAttempt(req);
    const [qmap, logo, project] = await Promise.all([
      questionMap(),
      getLogo(),
      a.project_id ? q(`SELECT name FROM projects WHERE id=$1`, [a.project_id]) : null,
    ]);
    const pdf = await renderAttemptPdf({
      attempt: a,
      qmap,
      mode: 'review',
      projectName: project?.rows[0]?.name,
      logo,
      title: a.settings_snapshot.title,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('doi_chieu_' + pdfFileName(a))}`);
    res.send(pdf);
  })
);

/** Sự kiện giám sát (webcam). type: webcam_warning | webcam_denied | webcam_error | fullscreen_exit */
app.post(
  '/api/exam/event',
  wrap(async (req, res) => {
    const a = await requireAttempt(req);
    if (a.submitted_at) return res.json({ ok: true, submitted: true });
    const type = String(req.body?.type || '').slice(0, 40);
    if (!/^[a-z_]+$/.test(type)) throw new HttpError(400, 'Loại sự kiện không hợp lệ.');
    const detail = req.body?.detail && typeof req.body.detail === 'object' ? req.body.detail : {};
    const cleanDetail = {
      kind: String(detail.kind || '').slice(0, 30) || undefined,
      message: String(detail.message || '').slice(0, 200) || undefined,
      value: Number.isFinite(Number(detail.value)) ? round2(detail.value) : undefined,
    };
    let snapshot = typeof req.body?.snapshot === 'string' ? req.body.snapshot : null;
    if (snapshot && (!snapshot.startsWith('data:image/jpeg;base64,') || snapshot.length > 60_000)) snapshot = null;

    const result = await tx(async (c) => {
      const lock = await c.query(`SELECT * FROM exam_attempts WHERE id=$1 FOR UPDATE`, [a.id]);
      const cur = lock.rows[0];
      if (!cur || cur.submitted_at) return { submitted: true };
      const stats = (
        await c.query(`SELECT count(*)::int AS n, count(snapshot)::int AS snaps FROM exam_events WHERE attempt_id=$1`, [a.id])
      ).rows[0];
      if (stats.n >= MAX_EVENTS) return { ignored: true };
      if (snapshot && stats.snaps >= MAX_SNAPSHOTS) snapshot = null;
      await c.query(`INSERT INTO exam_events(attempt_id, type, detail, snapshot) VALUES ($1,$2,$3,$4)`, [
        a.id,
        type,
        cleanDetail,
        snapshot,
      ]);
      let warnings = cur.webcam_warnings;
      if (type === 'webcam_warning') {
        warnings += 1;
        await c.query(`UPDATE exam_attempts SET webcam_warnings=$2 WHERE id=$1`, [a.id, warnings]);
      }
      return { warnings };
    });
    if (result.submitted || result.ignored) return res.json({ ok: true, ...result });

    const max = Number(a.settings_snapshot.webcamMaxWarnings) || 0;
    if (type === 'webcam_warning' && max > 0 && result.warnings >= max && !TEST_MODE) {
      const done = await submitAttempt(a.id, 'webcam');
      return res.json({ ok: true, warnings: result.warnings, submitted: true, attempt: await candidateView(done, await questionMap()) });
    }
    res.json({ ok: true, warnings: result.warnings });
  })
);

/* ------------------------------------------------------------------ */
/* Xác thực admin                                                      */
/* ------------------------------------------------------------------ */

function isAdmin(req) {
  const v = readSigned(parseCookies(req)[ADMIN_COOKIE]);
  if (!v || !v.startsWith('admin:')) return false;
  return Number(v.slice(6)) > Date.now();
}

app.post(
  '/api/admin/login',
  wrap(async (req, res) => {
    if (!ADMIN_PASSWORD) throw new HttpError(500, 'Máy chủ chưa đặt ADMIN_PASSWORD.');
    const pw = String(req.body?.password || '');
    await new Promise((r) => setTimeout(r, 300)); // làm chậm dò mật khẩu
    if (!safePasswordEqual(pw, ADMIN_PASSWORD)) throw new HttpError(401, 'Mật khẩu không đúng.');
    setCookie(res, ADMIN_COOKIE, makeSigned(`admin:${Date.now() + ADMIN_TTL_SEC * 1000}`), {
      maxAge: ADMIN_TTL_SEC,
      secure: isSecure(req),
    });
    res.json({ ok: true });
  })
);

app.post('/api/admin/logout', (req, res) => {
  setCookie(res, ADMIN_COOKIE, '', { maxAge: 0, secure: isSecure(req) });
  res.json({ ok: true });
});

app.get('/api/admin/me', (req, res) => res.json({ admin: isAdmin(req), testMode: TEST_MODE }));

app.use('/api/admin', (req, _res, next) => {
  if (!isAdmin(req)) return next(new HttpError(401, 'Phiên quản trị đã hết hạn, vui lòng đăng nhập lại.'));
  next();
});

/* ------------------------------------------------------------------ */
/* Admin: cấu hình, logo, công trình                                   */
/* ------------------------------------------------------------------ */

function cleanSettings(input, prev) {
  const s = { ...prev };
  const num = (k, min, max, int = false) => {
    if (input[k] === undefined) return;
    let n = Number(input[k]);
    if (!Number.isFinite(n)) throw new HttpError(400, `Giá trị "${k}" không hợp lệ.`);
    if (int) n = Math.round(n);
    if (n < min || n > max) throw new HttpError(400, `Giá trị "${k}" phải trong khoảng ${min}–${max}.`);
    s[k] = round2(n);
  };
  const bool = (k) => {
    if (input[k] !== undefined) s[k] = !!input[k];
  };
  if (input.title !== undefined) s.title = String(input.title).trim().slice(0, 200) || DEFAULT_SETTINGS.title;
  for (const k of ['openingAt', 'closingAt']) {
    if (input[k] === undefined) continue;
    const v = String(input[k] || '').trim();
    if (v && !vnToDate(v)) throw new HttpError(400, 'Thời gian không hợp lệ (định dạng YYYY-MM-DDTHH:mm).');
    s[k] = v.slice(0, 16);
  }
  const o = vnToDate(s.openingAt);
  const c = vnToDate(s.closingAt);
  if (o && c && o >= c) throw new HttpError(400, 'Thời gian đóng phải sau thời gian mở.');
  num('durationMinutes', 1, 600, true);
  num('multipleChoiceCount', 0, 500, true);
  num('essayCount', 0, 100, true);
  num('mcPointsPerQuestion', 0, 100);
  num('essayPointsPerQuestion', 0, 100);
  num('passingScore', 0, 10);
  num('webcamHoldSeconds', 0.5, 30);
  num('webcamYawThreshold', 0.02, 1);
  num('webcamGazeThreshold', 0.02, 1);
  num('webcamMaxWarnings', 0, 100, true);
  if (input.displayMode !== undefined) s.displayMode = input.displayMode === 'all' ? 'all' : 'paged';
  for (const k of ['active', 'showScore', 'shuffleQuestions', 'webcamEnabled', 'webcamRequired']) bool(k);
  if (s.multipleChoiceCount + s.essayCount < 1) throw new HttpError(400, 'Đề phải có ít nhất 1 câu.');
  if (maxScoreOf(s) <= 0) throw new HttpError(400, 'Tổng điểm tối đa phải lớn hơn 0.');
  return s;
}

app.get(
  '/api/admin/settings',
  wrap(async (_req, res) => {
    const s = await getSettings();
    const logo = await getLogo();
    res.json({ settings: s, status: examStatus(s), maxScore: maxScoreOf(s), hasLogo: !!logo, testMode: TEST_MODE, emailDomain: EMAIL_DOMAIN });
  })
);

app.put(
  '/api/admin/settings',
  wrap(async (req, res) => {
    const s = cleanSettings(req.body || {}, await getSettings());
    await saveSettings(s);
    res.json({ settings: s, status: examStatus(s), maxScore: maxScoreOf(s) });
  })
);

app.put(
  '/api/admin/logo',
  wrap(async (req, res) => {
    const dataUrl = String(req.body?.dataUrl || '');
    if (!dataUrl) {
      await saveLogo(null);
      return res.json({ ok: true, hasLogo: false });
    }
    const m = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) throw new HttpError(400, 'Logo phải là ảnh PNG, JPEG, WEBP hoặc SVG.');
    if (m[2].length > 700_000) throw new HttpError(400, 'Logo quá lớn (tối đa ~500KB).');
    await saveLogo({ mime: m[1], data: m[2] });
    res.json({ ok: true, hasLogo: true });
  })
);

app.get(
  '/api/admin/projects',
  wrap(async (_req, res) => {
    const r = await q(
      `SELECT p.id, p.name, p.active, p.created_at, count(a.id)::int AS attempts
       FROM projects p LEFT JOIN exam_attempts a ON a.project_id = p.id
       GROUP BY p.id ORDER BY p.active DESC, p.name`
    );
    res.json({ projects: r.rows });
  })
);

app.post(
  '/api/admin/projects',
  wrap(async (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 200);
    if (!name) throw new HttpError(400, 'Vui lòng nhập tên công trình.');
    try {
      const r = await q(`INSERT INTO projects(name) VALUES ($1) RETURNING *`, [name]);
      res.json({ project: r.rows[0] });
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'Công trình đã tồn tại.');
      throw e;
    }
  })
);

app.patch(
  '/api/admin/projects/:id',
  wrap(async (req, res) => {
    const fields = [];
    const vals = [req.params.id];
    if (req.body?.active !== undefined) {
      vals.push(!!req.body.active);
      fields.push(`active=$${vals.length}`);
    }
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim().slice(0, 200);
      if (!name) throw new HttpError(400, 'Tên công trình không được trống.');
      vals.push(name);
      fields.push(`name=$${vals.length}`);
    }
    if (!fields.length) throw new HttpError(400, 'Không có thay đổi.');
    const r = await q(`UPDATE projects SET ${fields.join(', ')} WHERE id=$1 RETURNING *`, vals);
    if (!r.rowCount) throw new HttpError(404, 'Không tìm thấy công trình.');
    res.json({ project: r.rows[0] });
  })
);

app.delete(
  '/api/admin/projects/:id',
  wrap(async (req, res) => {
    const used = (await q(`SELECT count(*)::int AS n FROM exam_attempts WHERE project_id=$1`, [req.params.id])).rows[0].n;
    if (used) throw new HttpError(409, 'Công trình đã có bài thi, chỉ có thể ẩn.');
    await q(`DELETE FROM projects WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  })
);

/* ------------------------------------------------------------------ */
/* Admin: danh sách email & theo dõi tham gia                          */
/* ------------------------------------------------------------------ */

app.get(
  '/api/admin/participants',
  wrap(async (_req, res) => {
    const r = await q(`SELECT email, seq, name FROM participants ORDER BY seq NULLS LAST, email`);
    res.json({ participants: r.rows, count: r.rowCount, max: MAX_PARTICIPANTS, emailDomain: EMAIL_DOMAIN });
  })
);

/** Import Excel – thay toàn bộ danh sách */
app.post(
  '/api/admin/participants/import',
  rawUpload('256kb'),
  wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'Chưa chọn tệp.');
    let parsed;
    try {
      parsed = await parseParticipantsXlsx(req.body);
    } catch {
      throw new HttpError(400, 'Không đọc được tệp Excel (.xlsx).');
    }
    const { participants, invalid, duplicates } = parsed;
    if (!participants.length) throw new HttpError(400, 'Không có email hợp lệ trong tệp.', { invalid, duplicates });
    if (participants.length > MAX_PARTICIPANTS) throw new HttpError(400, `Tối đa ${MAX_PARTICIPANTS} email.`);
    await tx(async (c) => {
      await c.query(`DELETE FROM participants`);
      await c.query(
        `INSERT INTO participants(email, seq, name)
         SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(email text, seq int, name text)`,
        [JSON.stringify(participants)]
      );
    });
    res.json({ ok: true, count: participants.length, invalid, duplicates });
  })
);

/** Dán email để bổ sung */
app.post(
  '/api/admin/participants',
  wrap(async (req, res) => {
    const text = String(req.body?.text || '');
    const tokens = text.split(/[\s,;<>()"']+/).filter((t) => t.includes('@'));
    const existing = new Set((await q(`SELECT email FROM participants`)).rows.map((r) => r.email));
    const added = [];
    const duplicates = [];
    const invalid = [];
    for (const t of tokens) {
      const e = normalizeEmail(t);
      if (!isValidEmail(e) || !isCompanyEmail(e)) invalid.push(t);
      else if (existing.has(e)) duplicates.push(e);
      else {
        existing.add(e);
        added.push(e);
      }
    }
    if (existing.size > MAX_PARTICIPANTS) throw new HttpError(400, `Tối đa ${MAX_PARTICIPANTS} email.`);
    if (added.length) {
      const maxSeq = (await q(`SELECT COALESCE(max(seq),0)::int AS m FROM participants`)).rows[0].m;
      const rows = added.map((email, i) => ({ email, seq: maxSeq + i + 1, name: null }));
      await q(
        `INSERT INTO participants(email, seq, name)
         SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(email text, seq int, name text) ON CONFLICT DO NOTHING`,
        [JSON.stringify(rows)]
      );
    }
    res.json({ ok: true, added, duplicates, invalid });
  })
);

app.delete(
  '/api/admin/participants',
  wrap(async (_req, res) => {
    await q(`DELETE FROM participants`);
    res.json({ ok: true });
  })
);

app.get(
  '/api/admin/participant-template',
  wrap(async (_req, res) => sendFile(res, await participantTemplateXlsx(), xlsxMime, 'mau_danh_sach_email.xlsx'))
);

app.get(
  '/api/admin/participation',
  wrap(async (req, res) => {
    const r = await q(
      `SELECT COALESCE(p.email, a.email) AS email, COALESCE(p.seq, a.seq) AS seq, COALESCE(a.name, p.name) AS name,
              p.email IS NOT NULL AS listed,
              a.id AS attempt_id, a.started_at, a.submitted_at, a.submit_reason, a.deadline_at
       FROM participants p FULL OUTER JOIN exam_attempts a ON a.email = p.email
       ORDER BY COALESCE(p.seq, a.seq) NULLS LAST, 1`
    );
    const now = new Date();
    const counts = { all: 0, not_started: 0, in_progress: 0, overdue: 0, submitted: 0, auto_submitted: 0 };
    const rows = r.rows.map((x) => {
      const status = participationStatus(x.attempt_id ? x : null, now);
      counts.all++;
      counts[status]++;
      return {
        ...x,
        status,
        statusLabel: PARTICIPATION_LABEL[status],
        reasonLabel: SUBMIT_REASON_LABEL[x.submit_reason] || '',
      };
    });
    const filter = String(req.query.filter || 'all');
    res.json({ rows: filter === 'all' ? rows : rows.filter((x) => x.status === filter), counts });
  })
);

/* ------------------------------------------------------------------ */
/* Admin: câu hỏi                                                       */
/* ------------------------------------------------------------------ */

async function attemptCount() {
  return (await q(`SELECT count(*)::int AS n FROM exam_attempts`)).rows[0].n;
}

app.get(
  '/api/admin/questions',
  wrap(async (_req, res) => {
    const r = await q(`SELECT * FROM questions ORDER BY position, id`);
    res.json({ questions: r.rows, locked: (await attemptCount()) > 0 });
  })
);

app.get(
  '/api/admin/template',
  wrap(async (req, res) => {
    if (req.query.format === 'docx') return sendFile(res, await questionTemplateDocx(), docxMime, 'mau_cau_hoi.docx');
    sendFile(res, await questionTemplateXlsx(), xlsxMime, 'mau_cau_hoi.xlsx');
  })
);

/**
 * Nhập câu hỏi. Query: format=xlsx|docx, mode=replace|append, dryRun=1 (chỉ kiểm tra).
 * Thân request là nội dung tệp.
 */
app.post(
  '/api/admin/import',
  rawUpload('5mb'),
  wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'Chưa chọn tệp.');
    const format = req.query.format === 'docx' ? 'docx' : 'xlsx';
    const mode = req.query.mode === 'append' ? 'append' : 'replace';
    const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
    let parsed;
    try {
      parsed = format === 'docx' ? await parseQuestionsDocx(req.body) : await parseQuestionsXlsx(req.body);
    } catch {
      throw new HttpError(400, `Không đọc được tệp ${format === 'docx' ? 'Word (.docx)' : 'Excel (.xlsx)'}.`);
    }
    const { questions, errors } = parsed;
    const summary = {
      total: questions.length,
      single: questions.filter((x) => x.type === 'single').length,
      multiple: questions.filter((x) => x.type === 'multiple').length,
      essay: questions.filter((x) => x.type === 'essay').length,
    };
    const locked = (await attemptCount()) > 0;
    if (dryRun) return res.json({ ok: !errors.length, questions, errors, summary, locked, mode });
    if (locked) throw new HttpError(409, 'Đã có thí sinh bắt đầu làm bài, không thể sửa ngân hàng câu hỏi.');
    if (errors.length) throw new HttpError(400, 'Tệp còn lỗi, vui lòng sửa trước khi lưu.', { errors });
    if (!questions.length) throw new HttpError(400, 'Không có câu hỏi nào để lưu.');
    await tx(async (c) => {
      if (mode === 'replace') await c.query(`DELETE FROM questions`);
      const start = (await c.query(`SELECT COALESCE(max(position),0)::int AS m FROM questions`)).rows[0].m;
      const rows = questions.map((x, i) => ({ ...x, position: start + i + 1 }));
      await c.query(
        `INSERT INTO questions(type, text, options, correct, reference, position)
         SELECT type, text, options, correct, reference, position
         FROM jsonb_to_recordset($1::jsonb) AS x(type text, text text, options jsonb, correct jsonb, reference text, position int)`,
        [JSON.stringify(rows)]
      );
    });
    const total = (await q(`SELECT count(*)::int AS n FROM questions`)).rows[0].n;
    res.json({ ok: true, saved: questions.length, total, summary, mode });
  })
);

app.patch(
  '/api/admin/questions/:id',
  wrap(async (req, res) => {
    if ((await attemptCount()) > 0) throw new HttpError(409, 'Đã có thí sinh bắt đầu làm bài, không thể sửa ngân hàng câu hỏi.');
    const r = await q(`UPDATE questions SET active=$2 WHERE id=$1 RETURNING *`, [Number(req.params.id), !!req.body?.active]);
    if (!r.rowCount) throw new HttpError(404, 'Không tìm thấy câu hỏi.');
    res.json({ question: r.rows[0] });
  })
);

/* ------------------------------------------------------------------ */
/* Admin: chấm tự luận, xem bài                                        */
/* ------------------------------------------------------------------ */

function attemptSummary(a, qmap, projectName) {
  const essayIds = a.question_ids.filter((id) => qmap.get(id)?.type === 'essay');
  const graded = essayIds.filter((id) => a.essay_scores?.[id] != null).length;
  return {
    id: a.id,
    seq: a.seq,
    name: a.name,
    email: a.email,
    jobTitle: a.job_title,
    level: a.level,
    projectId: a.project_id,
    projectName: projectName || '',
    startedAt: a.started_at,
    submittedAt: a.submitted_at,
    deadlineAt: a.deadline_at,
    submitReason: a.submit_reason,
    submitReasonLabel: SUBMIT_REASON_LABEL[a.submit_reason] || '',
    mcCorrect: a.mc_correct,
    mcScore: a.mc_score,
    totalScore: a.total_score,
    maxScore: a.max_score,
    score10: to10(a.total_score, a.max_score),
    result: a.result,
    tabViolation: a.tab_violation,
    webcamWarnings: a.webcam_warnings,
    essayTotal: essayIds.length,
    essayGraded: graded,
    status: participationStatus(a),
  };
}

async function projectNames() {
  return new Map((await q(`SELECT id, name FROM projects`)).rows.map((p) => [p.id, p.name]));
}

app.get(
  '/api/admin/grading',
  wrap(async (req, res) => {
    const [qmap, names, r] = await Promise.all([
      questionMap(),
      projectNames(),
      q(`SELECT * FROM exam_attempts WHERE submitted_at IS NOT NULL ORDER BY seq NULLS LAST, submitted_at`),
    ]);
    let rows = r.rows.map((a) => attemptSummary(a, qmap, names.get(a.project_id))).filter((x) => x.essayTotal > 0);
    const counts = {
      need: rows.filter((x) => x.essayGraded < x.essayTotal).length,
      done: rows.filter((x) => x.essayGraded >= x.essayTotal).length,
      all: rows.length,
    };
    const filter = String(req.query.filter || 'need');
    if (filter === 'need') rows = rows.filter((x) => x.essayGraded < x.essayTotal);
    else if (filter === 'done') rows = rows.filter((x) => x.essayGraded >= x.essayTotal);
    const term = String(req.query.q || '').trim().toLowerCase();
    if (term) {
      rows = rows.filter(
        (x) => String(x.seq ?? '') === term || x.name.toLowerCase().includes(term) || x.email.includes(term)
      );
    }
    res.json({ rows, counts });
  })
);

/** Chi tiết một bài (có đáp án đúng, nhật ký webcam) */
app.get(
  '/api/admin/attempt',
  wrap(async (req, res) => {
    const id = String(req.query.id || '');
    const a = (await q(`SELECT * FROM exam_attempts WHERE id=$1`, [id]).catch(() => ({ rows: [] }))).rows[0];
    if (!a) throw new HttpError(404, 'Không tìm thấy bài làm.');
    const [qmap, names, events] = await Promise.all([questionMap(), projectNames(), loadEvents([a.id])]);
    const questions = a.question_ids
      .map((qid) => qmap.get(qid))
      .filter(Boolean)
      .map((x) => ({
        id: x.id,
        type: x.type,
        text: x.text,
        options: x.options,
        correct: x.correct,
        reference: x.reference,
        answer: a.answers?.[x.id] ?? null,
        score: x.type === 'essay' ? a.essay_scores?.[x.id] ?? null : null,
      }));
    res.json({
      attempt: attemptSummary(a, qmap, names.get(a.project_id)),
      essayMax: a.settings_snapshot.essayPointsPerQuestion,
      mcPoints: a.settings_snapshot.mcPointsPerQuestion,
      passingScore: a.settings_snapshot.passingScore,
      questions,
      events: events.get(a.id) || [],
    });
  })
);

app.post(
  '/api/admin/grade-essay-attempt',
  wrap(async (req, res) => {
    const id = String(req.body?.attemptId || '');
    const a = (await q(`SELECT * FROM exam_attempts WHERE id=$1`, [id]).catch(() => ({ rows: [] }))).rows[0];
    if (!a) throw new HttpError(404, 'Không tìm thấy bài làm.');
    if (!a.submitted_at) throw new HttpError(409, 'Bài chưa nộp, chưa thể chấm.');
    const qmap = await questionMap();
    const max = Number(a.settings_snapshot.essayPointsPerQuestion);
    const scores = {};
    for (const [k, v] of Object.entries(req.body?.scores || {})) {
      const qid = Number(k);
      if (!a.question_ids.includes(qid) || qmap.get(qid)?.type !== 'essay') continue;
      if (v === '' || v == null) {
        scores[qid] = null;
        continue;
      }
      const n = Number(String(v).replace(',', '.'));
      if (!Number.isFinite(n) || n < 0 || n > max) throw new HttpError(400, `Điểm mỗi câu phải trong khoảng 0–${max}.`);
      scores[qid] = round2(n);
    }
    const done = await regrade(a.id, scores);
    res.json({ attempt: attemptSummary(done, qmap, (await projectNames()).get(done.project_id)) });
  })
);

app.get(
  '/api/admin/attempt-pdf',
  wrap(async (req, res) => {
    const id = String(req.query.id || '');
    const a = (await q(`SELECT * FROM exam_attempts WHERE id=$1`, [id]).catch(() => ({ rows: [] }))).rows[0];
    if (!a) throw new HttpError(404, 'Không tìm thấy bài làm.');
    const [qmap, names, events, logo] = await Promise.all([questionMap(), projectNames(), loadEvents([a.id]), getLogo()]);
    const pdf = await renderAttemptPdf({
      attempt: a,
      qmap,
      mode: 'full',
      projectName: names.get(a.project_id),
      events: events.get(a.id) || [],
      logo,
      title: a.settings_snapshot.title,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(pdfFileName(a))}`);
    res.send(pdf);
  })
);

/* ------------------------------------------------------------------ */
/* Admin: thống kê                                                     */
/* ------------------------------------------------------------------ */

function rateGroup(rows, keyFn) {
  const m = new Map();
  for (const x of rows) {
    const k = keyFn(x) || '(không ghi)';
    if (!m.has(k)) m.set(k, { name: k, total: 0, pass: 0, fail: 0, pending: 0 });
    const g = m.get(k);
    g.total++;
    if (x.result === 'pass') g.pass++;
    else if (x.result === 'fail') g.fail++;
    else g.pending++;
  }
  return [...m.values()]
    .map((g) => ({ ...g, passRate: g.pass + g.fail ? round2((g.pass / (g.pass + g.fail)) * 100) : null }))
    .sort((a, b) => b.total - a.total);
}

app.get(
  '/api/admin/dashboard',
  wrap(async (req, res) => {
    const [qmap, names, r] = await Promise.all([
      questionMap(),
      projectNames(),
      q(`SELECT * FROM exam_attempts ORDER BY seq NULLS LAST, started_at`),
    ]);
    const all = r.rows.map((a) => attemptSummary(a, qmap, names.get(a.project_id)));
    const levels = [...new Set(all.map((x) => x.level).filter(Boolean))].sort();
    const { projectId, level } = req.query;
    const min = req.query.min !== undefined && req.query.min !== '' ? Number(req.query.min) : null;
    const max = req.query.max !== undefined && req.query.max !== '' ? Number(req.query.max) : null;
    let rows = all;
    if (projectId) rows = rows.filter((x) => x.projectId === projectId);
    if (level) rows = rows.filter((x) => x.level === level);
    if (min != null) rows = rows.filter((x) => x.score10 != null && x.score10 >= min);
    if (max != null) rows = rows.filter((x) => x.score10 != null && x.score10 <= max);

    const submitted = rows.filter((x) => x.submittedAt);
    const scored = submitted.filter((x) => x.score10 != null);
    const violations = submitted.filter((x) => x.tabViolation || x.submitReason === 'webcam').length;
    const buckets = SCORE_BUCKETS.map((b) => ({
      label: b.label,
      count: scored.filter((x) => x.score10 >= b.min && x.score10 < b.max).length,
    }));
    res.json({
      stats: {
        submitted: submitted.length,
        inProgress: rows.filter((x) => !x.submittedAt).length,
        pass: submitted.filter((x) => x.result === 'pass').length,
        fail: submitted.filter((x) => x.result === 'fail').length,
        pending: submitted.filter((x) => x.result === 'pending').length,
        avgScore10: scored.length ? round2(scored.reduce((t, x) => t + x.score10, 0) / scored.length) : null,
        violations,
        webcamWarnings: submitted.reduce((t, x) => t + (x.webcamWarnings || 0), 0),
      },
      buckets,
      byProject: rateGroup(submitted, (x) => x.projectName),
      byLevel: rateGroup(submitted, (x) => x.level),
      rows,
      filters: {
        projects: [...names.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'vi')),
        levels,
      },
    });
  })
);

/* ------------------------------------------------------------------ */
/* Admin: hồ sơ kết quả                                                */
/* ------------------------------------------------------------------ */

app.get(
  '/api/admin/export',
  wrap(async (_req, res) => {
    const stamp = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 16).replace(/[-:T]/g, '');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="ho_so_ket_qua_${stamp}.zip"`);
    await writeResultsZip(res);
  })
);

app.post(
  '/api/admin/clear-results',
  wrap(async (req, res) => {
    const s = await getSettings();
    const st = examStatus(s);
    if (st === 'open' || st === 'upcoming') throw new HttpError(409, 'Chỉ xóa được khi kỳ thi đã đóng (tắt "Mở kỳ thi" hoặc đã qua giờ đóng).');
    const running = (await q(`SELECT count(*)::int AS n FROM exam_attempts WHERE submitted_at IS NULL`)).rows[0].n;
    if (running) throw new HttpError(409, `Còn ${running} bài chưa nộp. Hãy "Chốt bài hết hạn" trước.`);
    if (req.body?.confirm !== true) throw new HttpError(400, 'Thiếu xác nhận xóa.');
    const r = await q(`DELETE FROM exam_attempts`);
    res.json({ ok: true, deleted: r.rowCount });
  })
);

app.post(
  '/api/admin/reconcile',
  wrap(async (_req, res) => {
    const n = await finalizeOverdue('finalized');
    res.json({ ok: true, finalized: n });
  })
);

/* ------------------------------------------------------------------ */
/* Lỗi & giao diện                                                     */
/* ------------------------------------------------------------------ */

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Không tìm thấy API.')));

if (fs.existsSync(DIST)) {
  app.use(express.static(DIST, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(DIST, 'index.html'));
  });
} else {
  app.get('/', (_req, res) =>
    res.type('text').send('Chưa có bản build giao diện. Chạy "npm run build" (hoặc "npm run dev" để phát triển).')
  );
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Tệp hoặc dữ liệu gửi lên quá lớn.' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Dữ liệu gửi lên không hợp lệ.' });
  console.error(err);
  res.status(500).json({ error: 'Lỗi máy chủ, vui lòng thử lại.' });
});

const PORT = Number(process.env.PORT || 3000);
await initSchema();
app.listen(PORT, () => {
  console.log(`TMN-Exam chạy tại http://localhost:${PORT}${TEST_MODE ? ' (CHẾ ĐỘ THỬ)' : ''}`);
  if (!ADMIN_PASSWORD) console.warn('Cảnh báo: chưa đặt ADMIN_PASSWORD – không đăng nhập được trang quản trị.');
  if (!process.env.SESSION_SECRET) console.warn('Cảnh báo: chưa đặt SESSION_SECRET – đang dùng chuỗi mặc định.');
});
