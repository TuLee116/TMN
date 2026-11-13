import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fmtDateTime, fmtNum, KIND_LABEL, LETTERS, RESULT_LABEL, RESULT_TONE } from '../lib/format.js';
import { Badge, Button, Loading, Notice, Spinner } from '../lib/ui.jsx';

/** Chi tiết một bài làm; gradable = cho nhập điểm tự luận */
export default function AttemptDetail({ id, gradable = false, onSaved }) {
  const [d, setD] = useState(null);
  const [scores, setScores] = useState({});
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [onlyEssay, setOnlyEssay] = useState(gradable);

  const load = useCallback(async () => {
    const r = await api(`/admin/attempt?id=${id}`);
    setD(r);
    setScores(Object.fromEntries(r.questions.filter((q) => q.type === 'essay').map((q) => [q.id, q.score == null ? '' : String(q.score).replace('.', ',')])));
  }, [id]);

  useEffect(() => {
    setD(null);
    setMsg(null);
    load().catch((e) => setMsg({ tone: 'error', text: e.message }));
  }, [load]);

  if (!d) return msg ? <Notice tone="error">{msg.text}</Notice> : <Loading />;
  const a = d.attempt;
  const essays = d.questions.filter((q) => q.type === 'essay');
  const shown = onlyEssay ? essays : d.questions;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api('/admin/grade-essay-attempt', { method: 'POST', body: { attemptId: a.id, scores } });
      await load();
      setMsg({ tone: 'success', text: `Đã lưu. Tổng điểm: ${fmtNum(r.attempt.totalScore)} – ${RESULT_LABEL[r.attempt.result]}` });
      onSaved?.(r.attempt);
    } catch (e) {
      setMsg({ tone: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">
            <span className="mr-2 text-slate-400">{a.seq ?? ''}</span>
            {a.name}
          </div>
          <div className="text-sm text-slate-600">
            {a.email} · {a.jobTitle} · {a.level} {a.projectName && `· ${a.projectName}`}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Bắt đầu {fmtDateTime(a.startedAt)} · {a.submittedAt ? `Nộp ${fmtDateTime(a.submittedAt)} (${a.submitReasonLabel})` : 'Chưa nộp'}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {a.submittedAt && <Badge tone={RESULT_TONE[a.result]}>{RESULT_LABEL[a.result]}</Badge>}
          {a.tabViolation && <Badge tone="red">Trượt: chuyển tab</Badge>}
          <div className="text-sm">
            Tổng: <b>{fmtNum(a.totalScore)}</b> / {fmtNum(a.maxScore)} · Thang 10: <b>{fmtNum(a.score10)}</b>
          </div>
          <div className="text-xs text-slate-500">
            TN đúng {a.mcCorrect ?? 0} câu ({fmtNum(a.mcScore)} điểm) · Tự luận đã chấm {a.essayGraded}/{a.essayTotal}
          </div>
          <a className="text-xs text-blue-700 hover:underline" href={`/api/admin/attempt-pdf?id=${a.id}`} target="_blank" rel="noreferrer">
            Xem PDF ↗
          </a>
        </div>
      </div>

      {(a.webcamWarnings > 0 || d.events.length > 0) && <Events events={d.events} count={a.webcamWarnings} />}

      {gradable && (
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" className="accent-blue-700" checked={onlyEssay} onChange={(e) => setOnlyEssay(e.target.checked)} />
          Chỉ hiện câu tự luận
        </label>
      )}

      <div className="space-y-3">
        {shown.map((q) => {
          const i = d.questions.indexOf(q);
          return (
            <div key={q.id} className="rounded-lg border border-slate-200 p-4">
              <div className="text-xs font-semibold uppercase text-blue-700">Câu {i + 1}</div>
              <div className="whitespace-pre-wrap font-medium">{q.text}</div>
              {q.type === 'essay' ? (
                <div className="mt-2 space-y-2 text-sm">
                  <div className="whitespace-pre-wrap rounded bg-slate-50 p-3">
                    {typeof q.answer === 'string' && q.answer.trim() ? q.answer : <i className="text-slate-400">(không trả lời)</i>}
                  </div>
                  {q.reference && (
                    <div className="whitespace-pre-wrap rounded border border-emerald-100 bg-emerald-50 p-3 text-emerald-900">
                      <b>Đáp án tham khảo:</b> {q.reference}
                    </div>
                  )}
                  {gradable && a.submittedAt ? (
                    <label className="flex items-center gap-2">
                      Điểm (0–{fmtNum(d.essayMax)}):
                      <input
                        className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right tabular-nums"
                        inputMode="decimal"
                        value={scores[q.id] ?? ''}
                        onChange={(e) => setScores((s) => ({ ...s, [q.id]: e.target.value.replace(/[^\d.,]/g, '') }))}
                      />
                    </label>
                  ) : (
                    <div className="text-blue-700">
                      Điểm: {q.score == null ? 'chưa chấm' : fmtNum(q.score)} / {fmtNum(d.essayMax)}
                    </div>
                  )}
                </div>
              ) : (
                <McAnswer q={q} />
              )}
            </div>
          );
        })}
      </div>

      <Notice tone={msg?.tone}>{msg?.text}</Notice>
      {gradable && a.submittedAt && essays.length > 0 && (
        <div className="flex justify-end">
          <Button onClick={save} disabled={busy}>
            {busy && <Spinner />}Lưu kết quả cả bài
          </Button>
        </div>
      )}
    </div>
  );
}

function McAnswer({ q }) {
  const chosen = Array.isArray(q.answer) ? q.answer : q.answer ? [q.answer] : [];
  const ok = chosen.length && [...chosen].sort().join() === [...q.correct].sort().join();
  return (
    <div className="mt-2 text-sm">
      <ul className="space-y-0.5">
        {q.options.map((o, j) => {
          const L = LETTERS[j];
          const isC = q.correct.includes(L);
          const isA = chosen.includes(L);
          return (
            <li key={L} className={isC ? 'font-semibold text-emerald-700' : isA ? 'text-red-700' : 'text-slate-700'}>
              {isA ? '■' : '□'} {L}. {o} {isC && '✓'}
            </li>
          );
        })}
      </ul>
      <div className={`mt-1 text-xs ${ok ? 'text-emerald-700' : 'text-red-700'}`}>
        {ok ? 'Đúng' : chosen.length ? 'Sai' : 'Không trả lời'} · Đáp án đúng: {q.correct.join(', ')}
      </div>
    </div>
  );
}

function Events({ events, count }) {
  const warns = events.filter((e) => e.type === 'webcam_warning');
  const others = events.filter((e) => e.type !== 'webcam_warning');
  return (
    <div className="rounded-lg border border-red-200 bg-red-50/50 p-3">
      <div className="mb-2 text-sm font-semibold text-red-800">Giám sát webcam: {count} cảnh báo</div>
      <div className="flex flex-wrap gap-3">
        {warns.map((e, i) => (
          <figure key={i} className="w-40 text-xs">
            {e.snapshot ? (
              <img src={e.snapshot} alt="" className="h-28 w-40 rounded border border-red-200 object-cover" />
            ) : (
              <div className="flex h-28 w-40 items-center justify-center rounded border border-dashed border-red-200 text-slate-400">Không có ảnh</div>
            )}
            <figcaption className="mt-1 text-slate-700">
              {KIND_LABEL[e.detail?.kind] || e.detail?.kind}
              <span className="block text-slate-500">{fmtDateTime(e.created_at)}</span>
            </figcaption>
          </figure>
        ))}
      </div>
      {others.length > 0 && (
        <ul className="mt-2 text-xs text-slate-600">
          {others.map((e, i) => (
            <li key={i}>
              {fmtDateTime(e.created_at)} – {e.type === 'webcam_denied' ? 'Không cấp quyền camera' : e.type === 'webcam_error' ? 'Lỗi camera' : e.type}
              {e.detail?.message ? ` (${e.detail.message})` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
