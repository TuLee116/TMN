import { q, tx } from './db.js';
import { round2, sameSet, to10, maxScoreOf, TEST_MODE } from './util.js';

/** Toàn bộ câu hỏi (kể cả đã ẩn) theo id – ngân hàng nhỏ nên nạp một lần */
export async function questionMap() {
  const r = await q(`SELECT id, type, text, options, correct, reference, active, position, topic, difficulty FROM questions`);
  return new Map(r.rows.map((x) => [x.id, x]));
}

export function answerList(v) {
  if (Array.isArray(v)) return v.map(String);
  if (v == null || v === '') return [];
  return [String(v)];
}

export function isAnswered(question, v) {
  if (!question) return false;
  if (question.type === 'essay') return typeof v === 'string' && v.trim() !== '';
  return answerList(v).length > 0;
}

/** Tính điểm một lượt thi. Trắc nghiệm nhiều đáp án phải đúng trọn bộ mới có điểm. */
export function grade(attempt, qmap) {
  const s = attempt.settings_snapshot;
  const answers = attempt.answers || {};
  const essayScores = attempt.essay_scores || {};
  let mcCorrect = 0;
  let mcTotal = 0;
  let essayTotal = 0;
  let essayCount = 0;
  let pending = false;
  for (const id of attempt.question_ids) {
    const qu = qmap.get(id);
    if (!qu) continue;
    if (qu.type === 'essay') {
      essayCount++;
      const v = essayScores[id];
      if (v == null || v === '') pending = true;
      else essayTotal += Number(v);
    } else {
      mcTotal++;
      const a = answerList(answers[id]);
      if (a.length && sameSet(a, qu.correct)) mcCorrect++;
    }
  }
  const mcScore = round2(mcCorrect * s.mcPointsPerQuestion);
  const maxScore = maxScoreOf(s);
  const totalScore = pending ? null : round2(mcScore + essayTotal);
  let result;
  if (attempt.tab_violation) result = 'fail';
  else if (pending) result = 'pending';
  else result = to10(totalScore, maxScore) >= Number(s.passingScore) ? 'pass' : 'fail';
  return {
    mc_correct: mcCorrect,
    mc_total: mcTotal,
    essay_count: essayCount,
    essay_total: pending ? null : round2(essayTotal),
    mc_score: mcScore,
    total_score: totalScore,
    max_score: maxScore,
    result,
    pending,
  };
}

/** Làm sạch đáp án gửi lên: chỉ giữ câu thuộc đề, đúng kiểu */
export function sanitizeAnswers(input, attempt, qmap) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const id of attempt.question_ids) {
    if (!(id in input) && !(String(id) in input)) continue;
    const v = input[id] ?? input[String(id)];
    const qu = qmap.get(id);
    if (!qu) continue;
    if (qu.type === 'essay') {
      out[id] = String(v ?? '').slice(0, 20000);
    } else {
      const letters = 'ABCDEF'.slice(0, qu.options.length);
      let list = [...new Set(answerList(v).map((x) => x.toUpperCase()).filter((x) => x.length === 1 && letters.includes(x)))];
      if (qu.type === 'single') list = list.slice(0, 1);
      out[id] = list.sort();
    }
  }
  return out;
}

/**
 * Nộp bài (idempotent). reason: manual | timeout | tab_switch | webcam | finalized
 * Trả về bản ghi đã cập nhật.
 */
export async function submitAttempt(attemptId, reason, { answers } = {}) {
  const qmap = await questionMap();
  return tx(async (c) => {
    const r = await c.query(`SELECT * FROM exam_attempts WHERE id=$1 FOR UPDATE`, [attemptId]);
    const a = r.rows[0];
    if (!a) return null;
    if (a.submitted_at) return a;
    if (answers) a.answers = { ...a.answers, ...sanitizeAnswers(answers, a, qmap) };
    if (reason === 'tab_switch' && !TEST_MODE) a.tab_violation = true;
    const g = grade(a, qmap);
    const u = await c.query(
      `UPDATE exam_attempts SET answers=$2, submitted_at=now(), submit_reason=$3, tab_violation=$4,
         mc_correct=$5, mc_score=$6, total_score=$7, max_score=$8, result=$9
       WHERE id=$1 RETURNING *`,
      [a.id, a.answers, reason, a.tab_violation, g.mc_correct, g.mc_score, g.total_score, g.max_score, g.result]
    );
    return u.rows[0];
  });
}

/** Chốt các bài đã quá hạn mà chưa nộp */
export async function finalizeOverdue(reason = 'finalized') {
  const r = await q(
    `SELECT id FROM exam_attempts WHERE submitted_at IS NULL AND deadline_at < now() - interval '15 seconds'`
  );
  for (const row of r.rows) await submitAttempt(row.id, reason);
  return r.rows.length;
}

/** Tính lại điểm sau khi chấm tự luận */
export async function regrade(attemptId, essayScores) {
  const qmap = await questionMap();
  return tx(async (c) => {
    const r = await c.query(`SELECT * FROM exam_attempts WHERE id=$1 FOR UPDATE`, [attemptId]);
    const a = r.rows[0];
    if (!a) return null;
    a.essay_scores = { ...a.essay_scores, ...essayScores };
    const g = grade(a, qmap);
    const u = await c.query(
      `UPDATE exam_attempts SET essay_scores=$2, mc_correct=$3, mc_score=$4, total_score=$5, max_score=$6, result=$7
       WHERE id=$1 RETURNING *`,
      [a.id, a.essay_scores, g.mc_correct, g.mc_score, g.total_score, g.max_score, g.result]
    );
    return u.rows[0];
  });
}

/** Tính lại điểm mọi bài đã nộp có chứa câu hỏi (sau khi sửa đáp án đúng) */
export async function regradeQuestion(questionId) {
  const qmap = await questionMap();
  const r = await q(`SELECT * FROM exam_attempts WHERE submitted_at IS NOT NULL AND question_ids @> $1::jsonb`, [JSON.stringify([questionId])]);
  for (const a of r.rows) {
    const g = grade(a, qmap);
    await q(`UPDATE exam_attempts SET mc_correct=$2, mc_score=$3, total_score=$4, max_score=$5, result=$6 WHERE id=$1`, [
      a.id,
      g.mc_correct,
      g.mc_score,
      g.total_score,
      g.max_score,
      g.result,
    ]);
  }
  return r.rows.length;
}

/** Trạng thái tham gia dùng cho bảng theo dõi */
export function participationStatus(a, now = new Date()) {
  if (!a || !a.started_at) return 'not_started';
  if (!a.submitted_at) return new Date(a.deadline_at) < now ? 'overdue' : 'in_progress';
  return a.submit_reason === 'manual' ? 'submitted' : 'auto_submitted';
}

export const PARTICIPATION_LABEL = {
  not_started: 'Chưa bắt đầu',
  in_progress: 'Đang làm',
  overdue: 'Quá hạn · chưa chốt',
  submitted: 'Đã nộp',
  auto_submitted: 'Đã nộp tự động',
};

export const RESULT_LABEL = { pass: 'ĐẠT', fail: 'KHÔNG ĐẠT', pending: 'Chờ chấm tự luận' };
