import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, download } from '../lib/api.js';
import { fmtClock, isAnswered, KIND_LABEL, LETTERS } from '../lib/format.js';
import { Button, Modal, Notice, Spinner } from '../lib/ui.jsx';
import WebcamMonitor from './WebcamMonitor.jsx';

const SAVE_LABEL = {
  saving: 'Đang lưu…',
  saved: 'Đã lưu',
  error: 'Lỗi lưu, đáp án đang chờ đồng bộ',
};

function exitFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

export default function ExamView({ attempt, testMode, stream, setStream, onSubmitted, onRefresh }) {
  const questions = attempt.questions;
  const paged = attempt.displayMode !== 'all';
  const draftKey = `tmn-draft-${attempt.id}`;
  const webcam = attempt.webcam;

  const [answers, setAnswers] = useState(() => {
    let draft = {};
    try {
      draft = JSON.parse(localStorage.getItem(draftKey) || '{}');
    } catch {
      /* bỏ qua */
    }
    return { ...attempt.answers, ...draft };
  });
  const [idx, setIdx] = useState(0);
  const [saveState, setSaveState] = useState('saved');
  const offset = useMemo(() => new Date(attempt.serverNow).getTime() - Date.now(), [attempt.serverNow]);
  const deadline = new Date(attempt.deadlineAt).getTime();
  const [now, setNow] = useState(() => Date.now() + offset);
  const [isFs, setIsFs] = useState(() => !!document.fullscreenElement);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');
  const [warnToast, setWarnToast] = useState(null);
  const [warnCount, setWarnCount] = useState(attempt.webcamWarnings || 0);
  const [camError, setCamError] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);

  const answersRef = useRef(answers);
  answersRef.current = answers;
  const dirtyRef = useRef(false);
  const savingRef = useRef(null);
  const submittedRef = useRef(false);
  const firstRender = useRef(true);

  const answeredCount = questions.filter((q) => isAnswered(q, answers[q.id])).length;
  const remaining = deadline - now;

  /* ---------------- Lưu đáp án ---------------- */

  const finishWith = useCallback(
    (a) => {
      submittedRef.current = true;
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* bỏ qua */
      }
      exitFullscreen();
      onSubmitted(a);
    },
    [draftKey, onSubmitted]
  );

  const syncSubmitted = useCallback(async () => {
    const a = await onRefresh().catch(() => null);
    if (a?.status === 'submitted') finishWith(a);
  }, [onRefresh, finishWith]);

  const saveNow = useCallback(async () => {
    if (savingRef.current) await savingRef.current;
    if (submittedRef.current || !dirtyRef.current) return;
    dirtyRef.current = false;
    setSaveState('saving');
    const p = (async () => {
      try {
        await api('/exam/answers', { method: 'PUT', body: { answers: answersRef.current } });
        setSaveState(dirtyRef.current ? 'saving' : 'saved');
      } catch (e) {
        if (e.data?.submitted) return syncSubmitted();
        dirtyRef.current = true;
        setSaveState('error');
      }
    })();
    savingRef.current = p;
    await p;
    savingRef.current = null;
  }, [syncSubmitted]);

  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify(answers));
    } catch {
      /* bỏ qua */
    }
    if (firstRender.current) {
      firstRender.current = false;
      // nháp còn đáp án chưa đồng bộ
      if (JSON.stringify(answers) === JSON.stringify(attempt.answers)) return;
    }
    dirtyRef.current = true;
    setSaveState('saving');
    const t = setTimeout(saveNow, 800);
    return () => clearTimeout(t);
  }, [answers, draftKey, saveNow, attempt.answers]);

  // thử lại khi lỗi mạng
  useEffect(() => {
    if (saveState !== 'error') return;
    const t = setInterval(saveNow, 5000);
    return () => clearInterval(t);
  }, [saveState, saveNow]);

  /* ---------------- Nộp bài ---------------- */

  const submit = useCallback(
    async (reason) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      try {
        const r = await api('/exam/submit', {
          method: 'POST',
          body: { reason, answers: answersRef.current },
          keepalive: reason === 'tab_switch',
        });
        finishWith(r.attempt);
      } catch (e) {
        const a = await onRefresh().catch(() => null);
        if (a?.status === 'submitted') return finishWith(a);
        submittedRef.current = false;
        setSubmitting(false);
        setNotice(e.message);
      }
    },
    [finishWith, onRefresh]
  );

  /* ---------------- Đồng hồ ---------------- */

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(t);
  }, [offset]);

  useEffect(() => {
    if (remaining <= 0) submit('timeout');
  }, [remaining, submit]);

  /* ---------------- Chống gian lận ---------------- */

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'hidden' || submittedRef.current) return;
      if (testMode) setNotice('Chế độ thử: bạn vừa rời khỏi trang. Ở kỳ thi chính thức bài sẽ bị tự nộp và không đạt.');
      else submit('tab_switch');
    };
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('visibilitychange', onVis);
    document.addEventListener('fullscreenchange', onFs);
    const block = (e) => e.preventDefault();
    document.addEventListener('contextmenu', block);
    document.addEventListener('copy', block);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('contextmenu', block);
      document.removeEventListener('copy', block);
    };
  }, [testMode, submit]);

  // Cảnh báo khi đóng/tải lại trang
  useEffect(() => {
    const h = (e) => {
      if (submittedRef.current) return;
      if (dirtyRef.current) {
        fetch('/api/exam/answers', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ answers: answersRef.current }),
          keepalive: true,
          credentials: 'same-origin',
        }).catch(() => {});
      }
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  /* ---------------- Camera ---------------- */

  const requestCamera = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      setStream(s);
      setCamError('');
      return true;
    } catch {
      setCamError('Không bật được camera. Hãy cho phép trình duyệt truy cập camera rồi bấm "Tiếp tục làm bài".');
      api('/exam/event', { method: 'POST', body: { type: 'webcam_denied' } }).catch(() => {});
      return false;
    }
  }, [setStream]);

  // Tải lại trang: thử bật lại camera (thường đã được cấp quyền nên không cần bấm)
  useEffect(() => {
    if (webcam.enabled && !stream) requestCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onWarning = useCallback(
    async ({ kind, value, snapshot }) => {
      if (submittedRef.current) return;
      setWarnToast(KIND_LABEL[kind] || kind);
      setWarnCount((c) => c + 1);
      setTimeout(() => setWarnToast(null), 4000);
      if (webcam.maxWarnings > 0) await saveNow();
      try {
        const r = await api('/exam/event', { method: 'POST', body: { type: 'webcam_warning', detail: { kind, value }, snapshot } });
        if (r.warnings != null) setWarnCount(r.warnings);
        if (r.submitted && r.attempt) finishWith(r.attempt);
      } catch {
        /* bỏ qua */
      }
    },
    [webcam.maxWarnings, saveNow, finishWith]
  );

  const onCamStatus = useCallback((status, message) => {
    if (status === 'error') {
      setCamError(`Lỗi giám sát camera: ${message || 'không khởi động được'}`);
      api('/exam/event', { method: 'POST', body: { type: 'webcam_error', detail: { message } } }).catch(() => {});
    } else if (status === 'ended') {
      setStream(null);
      setCamError('Camera đã bị ngắt. Bấm "Tiếp tục làm bài" để bật lại.');
      api('/exam/event', { method: 'POST', body: { type: 'webcam_error', detail: { message: 'camera ended' } } }).catch(() => {});
    }
  }, [setStream]);

  /* ---------------- Khóa màn hình ---------------- */

  const needFs = !testMode && !isFs;
  const needCam = webcam.enabled && webcam.required && !stream;
  const locked = needFs || needCam;

  async function unlock() {
    if (!document.fullscreenElement) {
      await Promise.race([
        document.documentElement.requestFullscreen?.().catch(() => {}),
        new Promise((r) => setTimeout(r, 2000)),
      ]);
    }
    if (webcam.enabled && !stream) await requestCamera();
  }

  /* ---------------- Điều hướng ---------------- */

  const setAnswer = (qid, v) => setAnswers((a) => ({ ...a, [qid]: v }));

  function goTo(i) {
    if (paged) setIdx(i);
    else document.getElementById(`q-${questions[i].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function reviewPdf() {
    setPdfBusy(true);
    try {
      await saveNow();
      await download('/exam/review-pdf', 'doi_chieu.pdf');
    } catch (e) {
      setNotice(e.message);
    } finally {
      setPdfBusy(false);
    }
  }

  const lowTime = remaining < 5 * 60_000;
  const q = questions[idx];

  return (
    <div className="no-select min-h-screen bg-slate-100 pb-16">
      {testMode && (
        <div className="bg-amber-400 px-4 py-1.5 text-center text-xs font-medium text-amber-950">
          CHẾ ĐỘ THỬ – chuyển tab không tự nộp, được thoát toàn màn hình
        </div>
      )}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-900">{attempt.title}</div>
            <div className="truncate text-xs text-slate-500">
              {attempt.name} · {attempt.email}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Thời gian còn lại</div>
            <div className={`font-mono text-2xl font-bold tabular-nums ${lowTime ? 'text-red-600' : 'text-slate-900'}`}>
              {fmtClock(remaining)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`text-xs ${saveState === 'error' ? 'text-red-600' : saveState === 'saving' ? 'text-slate-500' : 'text-emerald-600'}`}
            >
              {SAVE_LABEL[saveState]}
            </span>
            <Button variant="secondary" size="sm" onClick={reviewPdf} disabled={pdfBusy}>
              {pdfBusy && <Spinner />}Xuất PDF đối chiếu
            </Button>
            <Button size="sm" variant="success" onClick={() => setConfirmOpen(true)} disabled={submitting}>
              Nộp bài
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto mt-4 grid max-w-6xl gap-4 px-4 lg:grid-cols-[1fr_260px]">
        <main className="min-w-0 space-y-4">
          <Notice tone="warn" onClose={() => setNotice('')}>
            {notice}
          </Notice>
          {paged ? (
            <>
              <QuestionBlock q={q} index={idx} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} />
              <div className="flex justify-between">
                <Button variant="secondary" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>
                  ← Câu trước
                </Button>
                {idx < questions.length - 1 ? (
                  <Button onClick={() => setIdx(idx + 1)}>Câu sau →</Button>
                ) : (
                  <Button variant="success" onClick={() => setConfirmOpen(true)}>
                    Nộp bài
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              {questions.map((qq, i) => (
                <QuestionBlock key={qq.id} q={qq} index={i} value={answers[qq.id]} onChange={(v) => setAnswer(qq.id, v)} />
              ))}
              <div className="flex justify-end">
                <Button variant="success" size="lg" onClick={() => setConfirmOpen(true)}>
                  Nộp bài
                </Button>
              </div>
            </>
          )}
        </main>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-semibold">Bảng câu hỏi</span>
              <span className="text-slate-500">
                {answeredCount}/{questions.length} đã trả lời
              </span>
            </div>
            <div className="grid grid-cols-6 gap-1.5 lg:grid-cols-5">
              {questions.map((qq, i) => {
                const done = isAnswered(qq, answers[qq.id]);
                const cur = paged && i === idx;
                return (
                  <button
                    key={qq.id}
                    onClick={() => goTo(i)}
                    title={done ? 'Đã trả lời' : 'Chưa trả lời'}
                    className={`h-9 rounded-md text-sm font-medium tabular-nums transition ${
                      done ? 'bg-blue-600 text-white' : 'border border-slate-300 bg-white text-slate-700 hover:border-blue-400'
                    } ${cur ? 'ring-2 ring-amber-400 ring-offset-1' : ''}`}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex gap-3 text-[11px] text-slate-500">
              <span className="flex items-center gap-1">
                <span className="h-3 w-3 rounded bg-blue-600" /> Đã trả lời
              </span>
              <span className="flex items-center gap-1">
                <span className="h-3 w-3 rounded border border-slate-300" /> Chưa trả lời
              </span>
            </div>
          </div>
          {webcam.enabled && (
            <div className="mt-3 text-xs text-slate-500">
              Cảnh báo camera: <b className={warnCount ? 'text-red-600' : ''}>{warnCount}</b>
              {webcam.maxWarnings > 0 && <> / {webcam.maxWarnings} (vượt ngưỡng sẽ tự nộp bài)</>}
            </div>
          )}
        </aside>
      </div>

      {webcam.enabled && stream && <WebcamMonitor stream={stream} config={webcam} onWarning={onWarning} onStatus={onCamStatus} />}

      {warnToast && (
        <div className="fixed left-1/2 top-20 z-40 -translate-x-1/2 rounded-lg bg-red-600 px-5 py-3 text-sm font-medium text-white shadow-lg">
          Cảnh báo: {warnToast}
        </div>
      )}

      <Modal
        open={confirmOpen}
        onClose={() => !submitting && setConfirmOpen(false)}
        title="Xác nhận nộp bài"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={submitting}>
              Làm tiếp
            </Button>
            <Button variant="success" onClick={() => submit('manual')} disabled={submitting}>
              {submitting && <Spinner />}Nộp bài
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          Bạn đã trả lời <b>{answeredCount}</b>/{questions.length} câu. Sau khi nộp không thể sửa.
        </p>
        {answeredCount < questions.length && (
          <p className="mt-2 text-sm text-amber-700">Còn {questions.length - answeredCount} câu chưa trả lời.</p>
        )}
      </Modal>

      {locked && !submitting && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/90 p-6 text-center text-white">
          <div className="max-w-md space-y-4">
            <h2 className="text-xl font-semibold">{needFs ? 'Cần bật toàn màn hình' : 'Cần bật camera'}</h2>
            <p className="text-sm text-slate-300">
              {needFs && 'Bài kiểm tra phải làm ở chế độ toàn màn hình. '}
              {needCam && 'Kỳ thi yêu cầu giám sát bằng camera. '}
              Thời gian làm bài vẫn đang được tính.
            </p>
            {camError && <p className="text-sm text-amber-300">{camError}</p>}
            <Button size="lg" onClick={unlock}>
              Tiếp tục làm bài
            </Button>
          </div>
        </div>
      )}
      {!locked && camError && webcam.enabled && (
        <div className="fixed bottom-4 left-4 z-40 max-w-sm">
          <Notice tone="warn" onClose={() => setCamError('')}>
            {camError}{' '}
            {!stream && (
              <button className="underline" onClick={requestCamera}>
                Bật lại camera
              </button>
            )}
          </Notice>
        </div>
      )}
    </div>
  );
}

function QuestionBlock({ q, index, value, onChange }) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const toggle = (L) => {
    if (q.type === 'single') onChange([L]);
    else onChange(list.includes(L) ? list.filter((x) => x !== L) : [...list, L].sort());
  };
  return (
    <article id={`q-${q.id}`} className="scroll-mt-28 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-blue-700">Câu {index + 1}</div>
      <div className="whitespace-pre-wrap text-base font-medium text-slate-900">{q.text}</div>
      <div className="mt-1 text-xs italic text-slate-500">
        {q.type === 'single' ? 'Chọn một đáp án' : q.type === 'multiple' ? 'Chọn tất cả đáp án phù hợp' : 'Trả lời tự luận'}
      </div>
      {q.type === 'essay' ? (
        <textarea
          className="mt-3 min-h-48 w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => e.preventDefault()}
          placeholder="Nhập câu trả lời…"
          maxLength={20000}
        />
      ) : (
        <div className="mt-3 space-y-2">
          {q.options.map((opt, j) => {
            const L = LETTERS[j];
            const on = list.includes(L);
            return (
              <button
                key={L}
                type="button"
                onClick={() => toggle(L)}
                className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                  on ? 'border-blue-600 bg-blue-50 text-blue-900' : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border text-[11px] font-bold ${
                    q.type === 'single' ? 'rounded-full' : 'rounded'
                  } ${on ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-400 text-slate-500'}`}
                >
                  {on ? '✓' : L}
                </span>
                <span>
                  <b className="mr-1">{L}.</b>
                  {opt}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </article>
  );
}
