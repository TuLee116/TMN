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
  sameSet,
  fmtVN,
} from './util.js';
import {
  questionMap,
  grade,
  sanitizeAnswers,
  submitAttempt,
  finalizeOverdue,
  regrade,
  regradeQuestion,
  answerList,
  isAnswered,
  participationStatus,
  PARTICIPATION_LABEL,
  RESULT_LABEL,
  canShuffleOptions,
  optionOrder,
  toDisplayLetters,
} from './attempts.js';
import {
  parseQuestionsXlsx,
  finishQuestion,
  parseQuestionsDocx,
  questionTemplateXlsx,
  questionTemplateDocx,
  parseParticipantsXlsx,
  participantTemplateXlsx,
} from './importer.js';
import { renderAttemptPdf } from './pdf.js';
import { writeResultsZip, loadEvents, pdfFileName } from './export.js';
import { audit, AUDIT_LABEL, fillTemplate, hashPassword, mailConfig, ROLE_LABEL, sendMail, verifyPassword } from './accounts.js';

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
    organization: s.organization,
    subtitle: s.subtitle,
    intro: s.intro,
    rules: s.rules,
    finishMessage: s.finishMessage,
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
/** Đáp án theo thứ tự phương án thí sinh thấy */
function displayAnswers(a, qmap) {
  const out = {};
  for (const [k, v] of Object.entries(a.answers || {})) {
    const qu = qmap.get(Number(k));
    out[k] = qu && qu.type !== 'essay' ? toDisplayLetters(a, Number(k), v) : v;
  }
  return out;
}

/** Bản câu hỏi + bài làm theo thứ tự thí sinh thấy (dùng cho PDF đối chiếu của thí sinh) */
function displayView(a, qmap) {
  if (!a.option_orders || !Object.keys(a.option_orders).length) return { attempt: a, qmap };
  const m = new Map(qmap);
  for (const id of a.question_ids) {
    const qu = qmap.get(id);
    const o = optionOrder(a, id);
    if (qu && o) m.set(id, { ...qu, options: o.map((i) => qu.options[i]), correct: toDisplayLetters(a, id, qu.correct) });
  }
  return { attempt: { ...a, answers: displayAnswers(a, qmap) }, qmap: m };
}

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
      .map((x) => {
        const o = optionOrder(a, x.id);
        return { id: x.id, type: x.type, text: x.text, options: o ? o.map((i) => x.options[i]) : x.options };
      });
    return { ...base, status: 'in_progress', questions, answers: displayAnswers(a, qmap) };
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

/** Số câu mỗi mức độ khó theo tỷ lệ cấu hình (tổng đúng bằng n) */
function mixTargets(s, n) {
  const pct = { easy: Number(s.mixEasy) || 0, medium: Number(s.mixMedium) || 0, hard: Number(s.mixHard) || 0 };
  const t = { easy: Math.round((n * pct.easy) / 100), hard: Math.round((n * pct.hard) / 100) };
  t.medium = Math.max(0, n - t.easy - t.hard);
  if (t.easy + t.hard > n) t.hard = n - t.easy;
  return t;
}

/** Rút câu trắc nghiệm; thiếu câu ở mức nào thì bù bằng câu bất kỳ còn lại */
async function drawMc(s) {
  const n = s.multipleChoiceCount;
  if (!n) return [];
  if (!s.mixEnabled) {
    return (await q(`SELECT id, position FROM questions WHERE active AND type <> 'essay' ORDER BY random() LIMIT $1`, [n])).rows;
  }
  const t = mixTargets(s, n);
  const picked = [];
  for (const lv of ['easy', 'medium', 'hard']) {
    if (!t[lv]) continue;
    const r = await q(`SELECT id, position FROM questions WHERE active AND type <> 'essay' AND difficulty=$1 ORDER BY random() LIMIT $2`, [lv, t[lv]]);
    picked.push(...r.rows);
  }
  if (picked.length < n) {
    const r = await q(
      `SELECT id, position FROM questions WHERE active AND type <> 'essay' AND NOT (id = ANY($1::int[])) ORDER BY random() LIMIT $2`,
      [picked.map((x) => x.id), n - picked.length]
    );
    picked.push(...r.rows);
  }
  return picked;
}

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

    // Chọn đề ngẫu nhiên (trắc nghiệm có thể theo tỷ lệ độ khó)
    const mc = await drawMc(s);
    const es = (
      await q(`SELECT id, position FROM questions WHERE active AND type = 'essay' ORDER BY random() LIMIT $1`, [s.essayCount])
    ).rows;
    if (mc.length < s.multipleChoiceCount || es.length < s.essayCount) {
      throw new HttpError(503, 'Ngân hàng câu hỏi chưa đủ số câu theo cấu hình. Vui lòng báo quản trị viên.');
    }
    const order = (rows) => (s.shuffleQuestions ? shuffle(rows) : [...rows].sort((a, b) => a.position - b.position || a.id - b.id));
    const questionIds = [...order(mc), ...order(es)].map((r) => r.id);
    // Xáo phương án từng câu (lưu thứ tự riêng cho bài này)
    const optionOrders = {};
    if (s.shuffleOptions && mc.length) {
      const qmap = await questionMap();
      for (const r of mc) {
        const qu = qmap.get(r.id);
        if (canShuffleOptions(qu)) optionOrders[r.id] = shuffle(qu.options.map((_, i) => i));
      }
    }

    const token = crypto.randomBytes(24).toString('base64url');
    const deadline = new Date(Date.now() + Number(s.durationMinutes) * 60_000);
    try {
      await q(
        `INSERT INTO exam_attempts(token, email, seq, name, job_title, level, project_id, question_ids, deadline_at, settings_snapshot, option_orders)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [token, email, participant.seq, name, jobTitle, level, projectId, JSON.stringify(questionIds), deadline, s, JSON.stringify(optionOrders)]
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
    const view = displayView(a, qmap);
    const pdf = await renderAttemptPdf({
      attempt: view.attempt,
      qmap: view.qmap,
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

const SUPER = { id: 0, username: 'admin', name: 'Quản trị chính', role: 'admin' };

/** Đọc phiên quản trị: trả về người dùng { id, username, name, role } hoặc null */
async function adminFromReq(req) {
  const v = readSigned(parseCookies(req)[ADMIN_COOKIE]);
  if (!v || !v.startsWith('admin:')) return null;
  const [, exp, uid] = v.split(':');
  if (!(Number(exp) > Date.now())) return null;
  const id = Number(uid || 0);
  if (!id) return SUPER;
  const r = await q(`SELECT id, username, name, role FROM admin_users WHERE id=$1 AND active`, [id]);
  return r.rows[0] || null;
}

app.post(
  '/api/admin/login',
  wrap(async (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const pw = String(req.body?.password || '');
    await new Promise((r) => setTimeout(r, 300)); // làm chậm dò mật khẩu
    let user = null;
    if (!username || username === 'admin') {
      if (!ADMIN_PASSWORD) throw new HttpError(500, 'Máy chủ chưa đặt ADMIN_PASSWORD.');
      if (safePasswordEqual(pw, ADMIN_PASSWORD)) user = SUPER;
    } else {
      const r = await q(`SELECT * FROM admin_users WHERE username=$1 AND active`, [username]);
      if (r.rows[0] && verifyPassword(pw, r.rows[0].password_hash)) user = r.rows[0];
    }
    if (!user) {
      await audit(req, 'login_failed', { username: username || 'admin' });
      throw new HttpError(401, 'Tên đăng nhập hoặc mật khẩu không đúng.');
    }
    if (user.id) await q(`UPDATE admin_users SET last_login_at=now() WHERE id=$1`, [user.id]);
    req.adminUser = { id: user.id, username: user.username, name: user.name, role: user.role };
    await audit(req, 'login');
    setCookie(res, ADMIN_COOKIE, makeSigned(`admin:${Date.now() + ADMIN_TTL_SEC * 1000}:${user.id}`), {
      maxAge: ADMIN_TTL_SEC,
      secure: isSecure(req),
    });
    res.json({ ok: true, user: req.adminUser });
  })
);

app.post('/api/admin/logout', (req, res) => {
  setCookie(res, ADMIN_COOKIE, '', { maxAge: 0, secure: isSecure(req) });
  res.json({ ok: true });
});

app.get(
  '/api/admin/me',
  wrap(async (req, res) => {
    const u = await adminFromReq(req);
    res.json({ admin: !!u, user: u, testMode: TEST_MODE });
  })
);

// Giám khảo chỉ được dùng các API chấm bài
const GRADER_ALLOWED = [
  ['GET', '/grading'],
  ['GET', '/attempt'],
  ['GET', '/attempt-pdf'],
  ['POST', '/grade-essay-attempt'],
];

app.use(
  '/api/admin',
  wrap(async (req, _res, next) => {
    const u = await adminFromReq(req);
    if (!u) throw new HttpError(401, 'Phiên quản trị đã hết hạn, vui lòng đăng nhập lại.');
    req.adminUser = u;
    if (u.role !== 'admin' && !GRADER_ALLOWED.some(([m, p]) => req.method === m && req.path === p))
      throw new HttpError(403, 'Tài khoản Giám khảo chỉ được chấm bài tự luận.');
    next();
  })
);

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
  const text = (k, max) => {
    if (input[k] !== undefined) s[k] = String(input[k] ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
  };
  text('organization', 200);
  text('subtitle', 300);
  text('intro', 5000);
  text('rules', 5000);
  text('finishMessage', 2000);
  text('emailSubject', 300);
  text('emailBody', 5000);
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
  num('mixEasy', 0, 100, true);
  num('mixMedium', 0, 100, true);
  num('mixHard', 0, 100, true);
  if (input.displayMode !== undefined) s.displayMode = input.displayMode === 'all' ? 'all' : 'paged';
  for (const k of ['active', 'showScore', 'shuffleQuestions', 'shuffleOptions', 'webcamEnabled', 'webcamRequired', 'mixEnabled']) bool(k);
  if (s.mixEnabled && s.mixEasy + s.mixMedium + s.mixHard !== 100) throw new HttpError(400, 'Tổng tỷ lệ Dễ + Trung bình + Khó phải bằng 100%.');
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
    await audit(req, 'settings_save', { title: s.title, active: s.active });
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
    await audit(req, 'logo_change', null);
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
      await audit(req, 'project_add', { name });
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
    await audit(req, 'project_update', { name: r.rows[0].name, active: r.rows[0].active });
    res.json({ project: r.rows[0] });
  })
);

app.delete(
  '/api/admin/projects/:id',
  wrap(async (req, res) => {
    const used = (await q(`SELECT count(*)::int AS n FROM exam_attempts WHERE project_id=$1`, [req.params.id])).rows[0].n;
    if (used) throw new HttpError(409, 'Công trình đã có bài thi, chỉ có thể ẩn.');
    await q(`DELETE FROM projects WHERE id=$1`, [req.params.id]);
    await audit(req, 'project_delete', { id: req.params.id });
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
    await audit(req, 'participants_import', { count: participants.length });
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
    await audit(req, 'participants_add', { added });
    res.json({ ok: true, added, duplicates, invalid });
  })
);

app.delete(
  '/api/admin/participants/one',
  wrap(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const has = (await q(`SELECT 1 FROM exam_attempts WHERE email=$1`, [email])).rowCount;
    if (has) throw new HttpError(409, 'Email này đã có bài làm, không xóa khỏi danh sách được (để giữ hồ sơ).');
    const r = await q(`DELETE FROM participants WHERE email=$1`, [email]);
    if (!r.rowCount) throw new HttpError(404, 'Không tìm thấy email trong danh sách.');
    await audit(req, 'participant_delete', { email });
    res.json({ ok: true });
  })
);

app.delete(
  '/api/admin/participants',
  wrap(async (req, res) => {
    await q(`DELETE FROM participants`);
    await audit(req, 'participants_delete', null);
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

/** Thống kê từng câu từ các bài đã nộp: số lần xuất hiện, tỷ lệ đúng / điểm TB tự luận */
async function questionStats() {
  const r = await q(`SELECT question_ids, answers, essay_scores, settings_snapshot FROM exam_attempts WHERE submitted_at IS NOT NULL`);
  const qmap = await questionMap();
  const st = {};
  for (const a of r.rows) {
    for (const id of a.question_ids) {
      const qu = qmap.get(id);
      if (!qu) continue;
      const x = (st[id] ||= { shown: 0, answered: 0, correct: 0, scored: 0, scoreSum: 0 });
      x.shown++;
      const v = a.answers?.[id];
      if (isAnswered(qu, v)) x.answered++;
      if (qu.type === 'essay') {
        const sc = a.essay_scores?.[id];
        const max = Number(a.settings_snapshot?.essayPointsPerQuestion) || 0;
        if (sc != null && sc !== '' && max > 0) {
          x.scored++;
          x.scoreSum += Number(sc) / max;
        }
      } else if (answerList(v).length && sameSet(answerList(v), qu.correct)) x.correct++;
    }
  }
  for (const [id, x] of Object.entries(st)) {
    const qu = qmap.get(Number(id));
    x.rate = qu?.type === 'essay' ? (x.scored ? round2((x.scoreSum / x.scored) * 100) : null) : x.shown ? round2((x.correct / x.shown) * 100) : null;
  }
  return st;
}

app.get(
  '/api/admin/questions',
  wrap(async (_req, res) => {
    const [r, stats, n] = await Promise.all([q(`SELECT * FROM questions ORDER BY position, id`), questionStats(), attemptCount()]);
    res.json({ questions: r.rows.map((x) => ({ ...x, stats: stats[x.id] || null })), locked: n > 0 });
  })
);

function questionInput(body) {
  const b = body || {};
  const options = Array.isArray(b.options) ? b.options.slice(0, 6).map((o) => String(o ?? '')) : [];
  const correct = Array.isArray(b.correct) ? b.correct.join(',') : String(b.correct || '');
  const { question, errors } = finishQuestion({ ...b, options, correct });
  if (errors.length) throw new HttpError(400, errors.join('; '));
  return question;
}

app.post(
  '/api/admin/questions',
  wrap(async (req, res) => {
    if ((await attemptCount()) > 0) throw new HttpError(409, 'Đã có thí sinh bắt đầu làm bài, không thể thêm câu hỏi. Có thể thêm sau khi dọn dữ liệu bài làm.');
    const x = questionInput(req.body);
    const r = await q(
      `INSERT INTO questions(type, text, options, correct, reference, topic, difficulty, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,(SELECT COALESCE(max(position),0)+1 FROM questions)) RETURNING *`,
      [x.type, x.text, JSON.stringify(x.options), JSON.stringify(x.correct), x.reference, x.topic, x.difficulty]
    );
    await audit(req, 'question_add', { id: r.rows[0].id, text: r.rows[0].text.slice(0, 120) });
    res.json({ question: r.rows[0] });
  })
);

app.put(
  '/api/admin/questions/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const cur = (await q(`SELECT * FROM questions WHERE id=$1`, [id])).rows[0];
    if (!cur) throw new HttpError(404, 'Không tìm thấy câu hỏi.');
    const x = questionInput(req.body);
    const locked = (await attemptCount()) > 0;
    let regraded = 0;
    if (locked) {
      // Đã có bài làm: chỉ cho sửa đáp án đúng, đáp án tham khảo, chủ đề, độ khó
      const same = x.type === cur.type && x.text === cur.text && JSON.stringify(x.options) === JSON.stringify(cur.options);
      if (!same)
        throw new HttpError(409, 'Đã có bài làm: không sửa được nội dung, phương án hay loại câu. Chỉ sửa được đáp án đúng, đáp án tham khảo, chủ đề, độ khó.');
    }
    const r = await q(
      `UPDATE questions SET type=$2, text=$3, options=$4, correct=$5, reference=$6, topic=$7, difficulty=$8 WHERE id=$1 RETURNING *`,
      [id, x.type, x.text, JSON.stringify(x.options), JSON.stringify(x.correct), x.reference, x.topic, x.difficulty]
    );
    if (locked && JSON.stringify(x.correct) !== JSON.stringify(cur.correct)) regraded = await regradeQuestion(id);
    await audit(req, 'question_edit', { id, text: cur.text.slice(0, 120), regraded });
    res.json({ question: r.rows[0], regraded });
  })
);

app.delete(
  '/api/admin/questions/:id',
  wrap(async (req, res) => {
    if ((await attemptCount()) > 0) throw new HttpError(409, 'Đã có bài làm: không xóa được câu hỏi, hãy dùng "Ẩn".');
    const r = await q(`DELETE FROM questions WHERE id=$1`, [Number(req.params.id)]);
    if (!r.rowCount) throw new HttpError(404, 'Không tìm thấy câu hỏi.');
    await audit(req, 'question_delete', { id: Number(req.params.id) });
    res.json({ ok: true });
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
        `INSERT INTO questions(type, text, options, correct, reference, position, topic, difficulty)
         SELECT type, text, options, correct, reference, position, topic, difficulty
         FROM jsonb_to_recordset($1::jsonb)
           AS x(type text, text text, options jsonb, correct jsonb, reference text, position int, topic text, difficulty text)`,
        [JSON.stringify(rows)]
      );
    });
    const total = (await q(`SELECT count(*)::int AS n FROM questions`)).rows[0].n;
    await audit(req, 'questions_import', { saved: questions.length, mode });
    res.json({ ok: true, saved: questions.length, total, summary, mode });
  })
);

app.patch(
  '/api/admin/questions/:id',
  wrap(async (req, res) => {
    // Ẩn / hiện chỉ ảnh hưởng các lượt rút đề sau, bài đã làm vẫn chấm theo câu gốc
    const r = await q(`UPDATE questions SET active=$2 WHERE id=$1 RETURNING *`, [Number(req.params.id), !!req.body?.active]);
    if (!r.rowCount) throw new HttpError(404, 'Không tìm thấy câu hỏi.');
    await audit(req, 'question_toggle', { id: r.rows[0].id, active: r.rows[0].active });
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

/** Nạp một bài làm – đợt hiện tại hoặc đợt đã lưu trữ (query.round) */
async function loadAttemptAny(query) {
  const id = String(query.id || '');
  if (query.round) {
    const { round, qmap, names } = await loadRound(query.round);
    const a = (await roundAttempts(round.id, id))[0];
    if (!a) throw new HttpError(404, 'Không tìm thấy bài làm.');
    return { a, qmap, names, events: await roundEvents(round.id, [a.id]) };
  }
  const a = (await q(`SELECT * FROM exam_attempts WHERE id=$1`, [id]).catch(() => ({ rows: [] }))).rows[0];
  if (!a) throw new HttpError(404, 'Không tìm thấy bài làm.');
  const [qmap, names, events] = await Promise.all([questionMap(), projectNames(), loadEvents([a.id])]);
  return { a, qmap, names, events };
}

/** Chi tiết một bài (có đáp án đúng, nhật ký webcam) */
app.get(
  '/api/admin/attempt',
  wrap(async (req, res) => {
    const { a, qmap, names, events } = await loadAttemptAny(req.query);
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
    await audit(req, 'grade_essay', { name: done.name, email: done.email, scores });
    res.json({ attempt: attemptSummary(done, qmap, (await projectNames()).get(done.project_id)) });
  })
);

app.get(
  '/api/admin/attempt-pdf',
  wrap(async (req, res) => {
    const [{ a, qmap, names, events }, logo] = await Promise.all([loadAttemptAny(req.query), getLogo()]);
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
/* Admin: tổng quan & theo dõi trực tiếp                                */
/* ------------------------------------------------------------------ */

const FLAG_WARNINGS = 3; // từ số cảnh báo webcam này trở lên thì gắn cờ nghi vấn

function flagsOf(a) {
  const f = [];
  if (a.tab_violation) f.push('Rời trang làm bài');
  if (a.submit_reason === 'webcam') f.push('Tự nộp do webcam');
  if ((a.webcam_warnings || 0) >= FLAG_WARNINGS) f.push(`${a.webcam_warnings} cảnh báo webcam`);
  return f;
}

app.get(
  '/api/admin/overview',
  wrap(async (_req, res) => {
    const s = await getSettings();
    const [att, parts, bankR] = await Promise.all([
      q(`SELECT started_at, submitted_at, submit_reason, deadline_at, result, total_score, max_score, tab_violation, webcam_warnings
         FROM exam_attempts`),
      q(`SELECT count(*)::int AS n FROM participants`),
      q(`SELECT type, count(*)::int AS n FROM questions WHERE active GROUP BY type`),
    ]);
    const now = new Date();
    const c = { not_started: 0, in_progress: 0, overdue: 0, submitted: 0, auto_submitted: 0 };
    let pass = 0, fail = 0, pending = 0, flagged = 0, sum = 0, scored = 0;
    for (const a of att.rows) {
      c[participationStatus(a, now)]++;
      if (!a.submitted_at) continue;
      if (a.result === 'pass') pass++;
      else if (a.result === 'fail') fail++;
      else pending++;
      if (flagsOf(a).length) flagged++;
      const v = to10(a.total_score, a.max_score);
      if (v != null && a.result !== 'pending') {
        sum += v;
        scored++;
      }
    }
    const bank = { mc: 0, essay: 0 };
    for (const r of bankR.rows) bank[r.type === 'essay' ? 'essay' : 'mc'] += r.n;
    const participants = parts.rows[0].n;
    c.not_started = Math.max(0, participants - att.rows.length);
    const submitted = c.submitted + c.auto_submitted;
    const status = examStatus(s);

    const todo = [];
    if (bank.mc < s.multipleChoiceCount)
      todo.push({ tone: 'red', tab: 'questions', text: `Thiếu câu trắc nghiệm: có ${bank.mc}/${s.multipleChoiceCount} câu đang dùng.` });
    if (bank.essay < s.essayCount)
      todo.push({ tone: 'red', tab: 'questions', text: `Thiếu câu tự luận: có ${bank.essay}/${s.essayCount} câu đang dùng.` });
    if (s.mixEnabled && s.multipleChoiceCount) {
      const t = mixTargets(s, s.multipleChoiceCount);
      const lv = (await q(`SELECT difficulty, count(*)::int AS n FROM questions WHERE active AND type <> 'essay' GROUP BY difficulty`)).rows;
      const have = Object.fromEntries(lv.map((x) => [x.difficulty, x.n]));
      const NAME = { easy: 'Dễ', medium: 'Trung bình', hard: 'Khó' };
      const short = ['easy', 'medium', 'hard'].filter((k) => (have[k] || 0) < t[k]);
      if (short.length)
        todo.push({
          tone: 'amber',
          tab: 'questions',
          text: `Thiếu câu theo độ khó (${short.map((k) => `${NAME[k]} ${have[k] || 0}/${t[k]}`).join(', ')}) – hệ thống sẽ bù bằng câu khác.`,
        });
    }
    if (!participants) todo.push({ tone: 'red', tab: 'participants', text: 'Chưa có danh sách email được phép thi.' });
    if (!s.openingAt || !s.closingAt) todo.push({ tone: 'amber', tab: 'settings', text: 'Chưa đặt đủ thời gian mở / đóng kỳ thi.' });
    if (!s.active) todo.push({ tone: 'amber', tab: 'settings', text: 'Kỳ thi đang tắt ("Mở kỳ thi" chưa bật).' });
    if (pending) todo.push({ tone: 'amber', tab: 'grading', text: `${pending} bài đang chờ chấm tự luận.` });
    if (c.overdue) todo.push({ tone: 'amber', tab: 'archive', text: `${c.overdue} bài quá hạn chưa chốt.` });
    if (flagged) todo.push({ tone: 'amber', tab: 'live', text: `${flagged} bài có dấu hiệu nghi vấn cần xem lại.` });
    if (TEST_MODE) todo.push({ tone: 'amber', text: 'Máy chủ đang ở CHẾ ĐỘ THỬ – tắt TEST_MODE trước khi thi chính thức.' });

    res.json({
      title: s.title,
      status,
      openingAt: s.openingAt,
      closingAt: s.closingAt,
      serverNow: now.toISOString(),
      durationMinutes: s.durationMinutes,
      participants,
      counts: { ...c, submitted, started: att.rows.length },
      results: { pass, fail, pending, flagged, avgScore10: scored ? round2(sum / scored) : null },
      passRate: pass + fail ? round2((pass / (pass + fail)) * 100) : null,
      bank: { ...bank, needMc: s.multipleChoiceCount, needEssay: s.essayCount },
      todo,
      testMode: TEST_MODE,
    });
  })
);

app.get(
  '/api/admin/live',
  wrap(async (_req, res) => {
    const [qmap, names, run, flagged] = await Promise.all([
      questionMap(),
      projectNames(),
      q(`SELECT a.*, e.last_event_at, e.last_event
         FROM exam_attempts a
         LEFT JOIN LATERAL (
           SELECT created_at AS last_event_at, type AS last_event FROM exam_events WHERE attempt_id = a.id ORDER BY id DESC LIMIT 1
         ) e ON TRUE
         WHERE a.submitted_at IS NULL ORDER BY a.started_at`),
      q(`SELECT * FROM exam_attempts
         WHERE submitted_at IS NOT NULL AND (tab_violation OR submit_reason = 'webcam' OR webcam_warnings >= $1)
         ORDER BY submitted_at DESC LIMIT 50`, [FLAG_WARNINGS]),
    ]);
    const now = Date.now();
    const live = run.rows.map((a) => ({
      id: a.id,
      seq: a.seq,
      name: a.name,
      email: a.email,
      level: a.level,
      projectName: names.get(a.project_id) || '',
      startedAt: a.started_at,
      deadlineAt: a.deadline_at,
      remainingSec: Math.round((new Date(a.deadline_at).getTime() - now) / 1000),
      answered: a.question_ids.filter((id) => isAnswered(qmap.get(id), a.answers[id])).length,
      questionCount: a.question_ids.length,
      webcamWarnings: a.webcam_warnings,
      lastEventAt: a.last_event_at,
      lastEvent: a.last_event,
      flags: flagsOf(a),
    }));
    res.json({
      serverNow: new Date(now).toISOString(),
      live,
      flagged: flagged.rows.map((a) => ({ ...attemptSummary(a, qmap, names.get(a.project_id)), flags: flagsOf(a) })),
    });
  })
);

app.post(
  '/api/admin/force-submit',
  wrap(async (req, res) => {
    const id = String(req.body?.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Mã bài làm không hợp lệ.');
    const a = await submitAttempt(id, 'admin');
    if (!a) throw new HttpError(404, 'Không tìm thấy bài làm.');
    await audit(req, 'force_submit', { name: a.name, email: a.email });
    res.json({ ok: true });
  })
);

/* ------------------------------------------------------------------ */
/* Admin: hồ sơ kết quả                                                */
/* ------------------------------------------------------------------ */

app.get(
  '/api/admin/export',
  wrap(async (req, res) => {
    const stamp = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 16).replace(/[-:T]/g, '');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="ho_so_ket_qua_${stamp}.zip"`);
    await audit(req, 'export_zip');
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
    await audit(req, 'clear_results', { deleted: r.rowCount });
    res.json({ ok: true, deleted: r.rowCount });
  })
);

app.post(
  '/api/admin/reconcile',
  wrap(async (req, res) => {
    const n = await finalizeOverdue('finalized');
    await audit(req, 'reconcile', { finalized: n });
    res.json({ ok: true, finalized: n });
  })
);

/* ------------------------------------------------------------------ */
/* Đợt thi: kết thúc & lưu trữ, xem lại đợt cũ                          */
/* ------------------------------------------------------------------ */

function roundStats(attempts) {
  let submitted = 0, pass = 0, fail = 0, pending = 0, flagged = 0, sum = 0, scored = 0;
  for (const a of attempts) {
    if (!a.submitted_at) continue;
    submitted++;
    if (a.result === 'pass') pass++;
    else if (a.result === 'fail') fail++;
    else pending++;
    if (flagsOf(a).length) flagged++;
    const v = to10(a.total_score, a.max_score);
    if (v != null && a.result !== 'pending') {
      sum += v;
      scored++;
    }
  }
  return {
    total: attempts.length,
    submitted,
    pass,
    fail,
    pending,
    flagged,
    avgScore10: scored ? round2(sum / scored) : null,
    passRate: pass + fail ? round2((pass / (pass + fail)) * 100) : null,
  };
}

async function loadRound(id) {
  const r = (await q(`SELECT * FROM exam_rounds WHERE id=$1`, [Number(id) || 0])).rows[0];
  if (!r) throw new HttpError(404, 'Không tìm thấy đợt thi.');
  const qmap = new Map(r.questions.map((x) => [x.id, x]));
  const names = new Map(r.projects.map((p) => [p.id, p.name]));
  return { round: r, qmap, names };
}

async function roundAttempts(roundId, attemptId = null) {
  const r = attemptId
    ? await q(`SELECT data FROM archived_attempts WHERE round_id=$1 AND id=$2`, [roundId, attemptId]).catch(() => ({ rows: [] }))
    : await q(`SELECT data FROM archived_attempts WHERE round_id=$1`, [roundId]);
  return r.rows
    .map((x) => x.data)
    .sort((a, b) => (a.seq ?? 1e9) - (b.seq ?? 1e9) || String(a.started_at).localeCompare(String(b.started_at)));
}

async function roundEvents(roundId, ids) {
  if (!ids.length) return new Map();
  const r = await q(
    `SELECT attempt_id, type, detail, snapshot, created_at FROM archived_events WHERE round_id=$1 AND attempt_id = ANY($2::uuid[]) ORDER BY created_at`,
    [roundId, ids]
  );
  const m = new Map();
  for (const e of r.rows) {
    if (!m.has(e.attempt_id)) m.set(e.attempt_id, []);
    m.get(e.attempt_id).push(e);
  }
  return m;
}

app.post(
  '/api/admin/rounds/archive',
  wrap(async (req, res) => {
    const s = await getSettings();
    const st = examStatus(s);
    if (st === 'open' || st === 'upcoming') throw new HttpError(409, 'Chỉ lưu trữ được khi kỳ thi đã đóng (tắt "Mở kỳ thi" hoặc đã qua giờ đóng).');
    const running = (await q(`SELECT count(*)::int AS n FROM exam_attempts WHERE submitted_at IS NULL`)).rows[0].n;
    if (running) throw new HttpError(409, `Còn ${running} bài chưa nộp. Hãy "Chốt bài hết hạn" trước.`);
    const name = String(req.body?.name || '').trim().slice(0, 200) || `${s.title} (${fmtVN(new Date())})`;
    const clearParticipants = !!req.body?.clearParticipants;
    const out = await tx(async (c) => {
      const att = (await c.query(`SELECT * FROM exam_attempts`)).rows;
      if (!att.length) throw new HttpError(400, 'Chưa có bài làm nào để lưu trữ.');
      const ids = [...new Set(att.flatMap((a) => a.question_ids))];
      const qs = (await c.query(`SELECT id, type, text, options, correct, reference, active, position, topic, difficulty FROM questions WHERE id = ANY($1::int[])`, [ids])).rows;
      const projects = (await c.query(`SELECT id, name FROM projects`)).rows;
      const participants = (await c.query(`SELECT count(*)::int AS n FROM participants`)).rows[0].n;
      const opened = att.reduce((m, a) => (!m || a.started_at < m ? a.started_at : m), null);
      const r = await c.query(
        `INSERT INTO exam_rounds(name, opened_at, archived_by, settings, questions, projects, participants, stats)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [name, opened, req.adminUser.username, s, JSON.stringify(qs), JSON.stringify(projects), participants, roundStats(att)]
      );
      const rid = r.rows[0].id;
      await c.query(`INSERT INTO archived_attempts(id, round_id, data) SELECT a.id, $1, to_jsonb(a) FROM exam_attempts a`, [rid]);
      await c.query(
        `INSERT INTO archived_events(round_id, attempt_id, type, detail, snapshot, created_at)
         SELECT $1, attempt_id, type, detail, snapshot, created_at FROM exam_events`,
        [rid]
      );
      await c.query(`DELETE FROM exam_attempts`);
      if (clearParticipants) await c.query(`DELETE FROM participants`);
      return { id: rid, attempts: att.length };
    });
    await audit(req, 'round_archive', { id: out.id, name, attempts: out.attempts, clearParticipants });
    res.json({ ok: true, ...out, name });
  })
);

app.get(
  '/api/admin/rounds',
  wrap(async (_req, res) => {
    const r = await q(`SELECT id, name, opened_at, archived_at, archived_by, participants, stats, settings->>'title' AS title FROM exam_rounds ORDER BY archived_at DESC`);
    res.json({ rounds: r.rows });
  })
);

app.get(
  '/api/admin/rounds/:id',
  wrap(async (req, res) => {
    const { round, qmap, names } = await loadRound(req.params.id);
    const rows = (await roundAttempts(round.id)).map((a) => ({ ...attemptSummary(a, qmap, names.get(a.project_id)), flags: flagsOf(a) }));
    const { questions: _q, settings, ...meta } = round;
    res.json({ round: { ...meta, title: settings.title, settings }, rows });
  })
);

app.get(
  '/api/admin/rounds/:id/export',
  wrap(async (req, res) => {
    const { round, qmap, names } = await loadRound(req.params.id);
    const attempts = await roundAttempts(round.id);
    const events = await roundEvents(
      round.id,
      attempts.map((a) => a.id)
    );
    await audit(req, 'round_export', { id: round.id, name: round.name });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="ho_so_dot_${round.id}.zip"`);
    await writeResultsZip(res, { attempts, qmap, projectName: names, events, title: round.settings.title });
  })
);

app.delete(
  '/api/admin/rounds/:id',
  wrap(async (req, res) => {
    const { round } = await loadRound(req.params.id);
    if (req.body?.confirm !== true) throw new HttpError(400, 'Thiếu xác nhận xóa.');
    await q(`DELETE FROM exam_rounds WHERE id=$1`, [round.id]);
    await audit(req, 'round_delete', { id: round.id, name: round.name });
    res.json({ ok: true });
  })
);

/* ------------------------------------------------------------------ */
/* Tài khoản quản trị / giám khảo                                      */
/* ------------------------------------------------------------------ */

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

app.get(
  '/api/admin/users',
  wrap(async (_req, res) => {
    const r = await q(`SELECT id, username, name, role, active, created_at, last_login_at FROM admin_users ORDER BY role, username`);
    res.json({ users: r.rows, roles: ROLE_LABEL });
  })
);

app.post(
  '/api/admin/users',
  wrap(async (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim().slice(0, 100);
    const role = req.body?.role === 'admin' ? 'admin' : 'grader';
    const password = String(req.body?.password || '');
    if (!USERNAME_RE.test(username) || username === 'admin')
      throw new HttpError(400, 'Tên đăng nhập 3–32 ký tự (chữ thường, số, . _ -), không dùng "admin".');
    if (!name) throw new HttpError(400, 'Vui lòng nhập họ tên.');
    if (password.length < 8) throw new HttpError(400, 'Mật khẩu tối thiểu 8 ký tự.');
    try {
      const r = await q(
        `INSERT INTO admin_users(username, name, role, password_hash) VALUES ($1,$2,$3,$4) RETURNING id, username, name, role, active`,
        [username, name, role, hashPassword(password)]
      );
      await audit(req, 'user_add', { username, role });
      res.json({ user: r.rows[0] });
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'Tên đăng nhập đã tồn tại.');
      throw e;
    }
  })
);

app.patch(
  '/api/admin/users/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const cur = (await q(`SELECT * FROM admin_users WHERE id=$1`, [id])).rows[0];
    if (!cur) throw new HttpError(404, 'Không tìm thấy tài khoản.');
    const b = req.body || {};
    const name = b.name !== undefined ? String(b.name).trim().slice(0, 100) || cur.name : cur.name;
    const role = b.role !== undefined ? (b.role === 'admin' ? 'admin' : 'grader') : cur.role;
    const active = b.active !== undefined ? !!b.active : cur.active;
    let hash = cur.password_hash;
    if (b.password !== undefined && b.password !== '') {
      if (String(b.password).length < 8) throw new HttpError(400, 'Mật khẩu tối thiểu 8 ký tự.');
      hash = hashPassword(b.password);
    }
    const r = await q(
      `UPDATE admin_users SET name=$2, role=$3, active=$4, password_hash=$5 WHERE id=$1 RETURNING id, username, name, role, active`,
      [id, name, role, active, hash]
    );
    await audit(req, 'user_update', { username: cur.username, role, active, passwordChanged: hash !== cur.password_hash });
    res.json({ user: r.rows[0] });
  })
);

app.delete(
  '/api/admin/users/:id',
  wrap(async (req, res) => {
    const r = await q(`DELETE FROM admin_users WHERE id=$1 RETURNING username`, [Number(req.params.id)]);
    if (!r.rowCount) throw new HttpError(404, 'Không tìm thấy tài khoản.');
    await audit(req, 'user_delete', { username: r.rows[0].username });
    res.json({ ok: true });
  })
);

/* ------------------------------------------------------------------ */
/* Nhật ký thao tác                                                    */
/* ------------------------------------------------------------------ */

app.get(
  '/api/admin/audit',
  wrap(async (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const where = [];
    const params = [];
    if (req.query.action) {
      params.push(String(req.query.action));
      where.push(`action = $${params.length}`);
    }
    if (req.query.actor) {
      params.push(String(req.query.actor));
      where.push(`actor = $${params.length}`);
    }
    if (req.query.before) {
      params.push(Number(req.query.before));
      where.push(`id < $${params.length}`);
    }
    params.push(limit);
    const r = await q(
      `SELECT id, at, actor, role, action, detail, ip FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT $${params.length}`,
      params
    );
    const actors = (await q(`SELECT DISTINCT actor FROM audit_log WHERE actor <> '' ORDER BY actor`)).rows.map((x) => x.actor);
    res.json({ rows: r.rows.map((x) => ({ ...x, label: AUDIT_LABEL[x.action] || x.action })), actions: AUDIT_LABEL, actors });
  })
);

/* ------------------------------------------------------------------ */
/* Email kết quả                                                       */
/* ------------------------------------------------------------------ */

const EMAIL_ELIGIBLE = `submitted_at IS NOT NULL AND result IN ('pass','fail')`;

async function emailVars(a) {
  const s = await getSettings();
  return {
    ho_ten: a.name,
    email: a.email,
    ky_thi: a.settings_snapshot?.title || s.title,
    don_vi: s.organization || '',
    ket_qua: RESULT_LABEL[a.result] || '',
    thang_10: fmtNum10(to10(a.total_score, a.max_score)),
    tong_diem: fmtNum10(a.total_score),
    diem_toi_da: fmtNum10(a.max_score),
    ngay_nop: fmtVN(a.submitted_at),
  };
}

function fmtNum10(n) {
  return n == null ? '—' : String(round2(Number(n))).replace('.', ',');
}

app.get(
  '/api/admin/email/status',
  wrap(async (_req, res) => {
    const cfg = mailConfig();
    const r = (
      await q(`SELECT count(*)::int AS eligible, count(result_emailed_at)::int AS sent FROM exam_attempts WHERE ${EMAIL_ELIGIBLE}`)
    ).rows[0];
    const pending = (await q(`SELECT count(*)::int AS n FROM exam_attempts WHERE submitted_at IS NOT NULL AND result = 'pending'`)).rows[0].n;
    res.json({ configured: cfg.ok, provider: cfg.provider, from: cfg.from, eligible: r.eligible, sent: r.sent, unsent: r.eligible - r.sent, waitingGrade: pending });
  })
);

app.post(
  '/api/admin/email/preview',
  wrap(async (req, res) => {
    const s = await getSettings();
    const a = (await q(`SELECT * FROM exam_attempts WHERE ${EMAIL_ELIGIBLE} ORDER BY submitted_at LIMIT 1`)).rows[0];
    const vars = a
      ? await emailVars(a)
      : { ho_ten: 'Nguyễn Văn A', email: 'nguyenvana@' + EMAIL_DOMAIN, ky_thi: s.title, don_vi: s.organization, ket_qua: 'ĐẠT', thang_10: '8,5', tong_diem: '8,5', diem_toi_da: '10', ngay_nop: fmtVN(new Date()) };
    const subject = fillTemplate(req.body?.subject ?? s.emailSubject, vars);
    const body = fillTemplate(req.body?.body ?? s.emailBody, vars);
    res.json({ subject, body, sample: !a });
  })
);

app.post(
  '/api/admin/email/test',
  wrap(async (req, res) => {
    const to = normalizeEmail(req.body?.to);
    if (!isValidEmail(to)) throw new HttpError(400, 'Email nhận thử không hợp lệ.');
    const s = await getSettings();
    const vars = { ho_ten: 'Người nhận thử', email: to, ky_thi: s.title, don_vi: s.organization, ket_qua: 'ĐẠT', thang_10: '8,5', tong_diem: '8,5', diem_toi_da: '10', ngay_nop: fmtVN(new Date()) };
    try {
      await sendMail({ to, subject: '[Thử] ' + fillTemplate(s.emailSubject, vars), text: fillTemplate(s.emailBody, vars) });
    } catch (e) {
      throw new HttpError(502, `Gửi thất bại: ${e.message}`);
    }
    await audit(req, 'email_test', { to });
    res.json({ ok: true });
  })
);

app.post(
  '/api/admin/email/send',
  wrap(async (req, res) => {
    if (!mailConfig().ok) throw new HttpError(400, 'Chưa cấu hình gửi email trên máy chủ.');
    const s = await getSettings();
    const skip = (Array.isArray(req.body?.skip) ? req.body.skip : []).filter((x) => /^[0-9a-f-]{36}$/i.test(String(x)));
    const batch = (
      await q(
        `SELECT * FROM exam_attempts WHERE ${EMAIL_ELIGIBLE} AND result_emailed_at IS NULL AND NOT (id = ANY($1::uuid[])) ORDER BY seq NULLS LAST, submitted_at LIMIT 20`,
        [skip]
      )
    ).rows;
    let sent = 0;
    const failed = [];
    for (const a of batch) {
      const vars = await emailVars(a);
      try {
        await sendMail({ to: a.email, subject: fillTemplate(s.emailSubject, vars), text: fillTemplate(s.emailBody, vars) });
        await q(`UPDATE exam_attempts SET result_emailed_at=now() WHERE id=$1`, [a.id]);
        sent++;
      } catch (e) {
        failed.push({ id: a.id, email: a.email, error: e.message.slice(0, 200) });
      }
    }
    const remaining = (
      await q(`SELECT count(*)::int AS n FROM exam_attempts WHERE ${EMAIL_ELIGIBLE} AND result_emailed_at IS NULL AND NOT (id = ANY($1::uuid[]))`, [
        [...skip, ...failed.map((f) => f.id)],
      ])
    ).rows[0].n;
    if (sent || failed.length) await audit(req, 'email_send', { sent, failed: failed.length });
    res.json({ sent, failed, remaining });
  })
);

app.post(
  '/api/admin/email/reset',
  wrap(async (_req, res) => {
    const r = await q(`UPDATE exam_attempts SET result_emailed_at=NULL WHERE result_emailed_at IS NOT NULL`);
    res.json({ ok: true, reset: r.rowCount });
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
