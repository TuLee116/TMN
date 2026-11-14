import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, download } from '../lib/api.js';
import { fmtClock, isAnswered, KIND_LABEL, LETTERS } from '../lib/format.js';
import { Button, Icon, Logo, Modal, Notice, Spinner } from '../lib/ui.jsx';
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
  // Câu đánh dấu xem lại – chỉ lưu trên máy thí sinh
  const flagKey = `tmn-flag-${attempt.id}`;
  const [flags, setFlags] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(flagKey) || '[]'));
    } catch {
      return new Set();
    }
  });
  const toggleFlag = (qid) =>
    setFlags((f) => {
      const n = new Set(f);
      n.has(qid) ? n.delete(qid) : n.add(qid);
      try {
        localStorage.setItem(flagKey, JSON.stringify([...n]));
      } catch {
        /* bỏ qua */
      }
      return n;
    });

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
  const pct = questions.length ? Math.round((answeredCount / questions.length) * 100) : 0;
  const unanswered = questions.map((qq, i) => (isAnswered(qq, answers[qq.id]) ? null : i)).filter((x) => x != null);
  const flagged = questions.map((qq, i) => (flags.has(qq.id) ? i : null)).filter((x) => x != null);

  /* Phím tắt (chế độ từng câu): ← → chuyển câu, A–F hoặc 1–6 chọn đáp án, F2 đánh dấu */
  useEffect(() => {
    if (!paged) return;
    const h = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || confirmOpen || e.ctrlKey || e.metaKey || e.altKey) return;
      const cur = questions[idx];
      if (e.key === 'ArrowRight' && idx < questions.length - 1) setIdx(idx + 1);
      else if (e.key === 'ArrowLeft' && idx > 0) setIdx(idx - 1);
      else if (e.key === 'F2') {
        e.preventDefault();
        toggleFlag(cur.id);
      } else if (cur.type !== 'essay') {
        const k = e.key.toUpperCase();
        const j = /^[1-6]$/.test(k) ? Number(k) - 1 : LETTERS.indexOf(k);
        if (j >= 0 && j < cur.options.length) {
          const L = LETTERS[j];
          const list = Array.isArray(answers[cur.id]) ? answers[cur.id] : [];
          setAnswer(cur.id, cur.type === 'single' ? [L] : list.includes(L) ? list.filter((x) => x !== L) : [...list, L].sort());
        }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  return (
    <div className="no-select min-h-screen bg-slate-100 pb-20">
      {testMode && (
        <div className="bg-amber-400 px-4 py-1.5 text-center text-xs font-semibold text-amber-950">
          CHẾ ĐỘ THỬ – chuyển tab không tự nộp, được thoát toàn màn hình
        </div>
      )}

      {/* Thanh trên */}
      <header className="bg-brand sticky top-0 z-30 text-white shadow-lg">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3">
          <span className="hidden rounded-xl bg-white px-2 py-1.5 shadow-sm sm:inline-flex">
            <Logo className="h-9" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-extrabold uppercase tracking-wide sm:text-base">{attempt.title}</div>
            <div className="truncate text-xs text-white/75">
              {attempt.name} · {attempt.email}
            </div>
          </div>
          <div
            className={`flex items-center gap-3 rounded-xl px-4 py-1.5 ring-1 ${
              lowTime ? 'animate-pulse bg-red-600 ring-red-300' : 'bg-white/15 ring-white/25'
            }`}
            title="Thời gian còn lại"
          >
            <Icon name="clock" className="h-5 w-5 opacity-90" />
            <div className="leading-tight">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-white/75">Còn lại</div>
              <div className="font-mono text-2xl font-bold tabular-nums">{fmtClock(remaining)}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium sm:inline-flex ${
                saveState === 'error' ? 'bg-red-500/90' : 'bg-white/15'
              }`}
            >
              {saveState === 'saving' ? <Spinner className="h-3 w-3" /> : <Icon name={saveState === 'error' ? 'alert' : 'check'} className="h-3.5 w-3.5" />}
              {SAVE_LABEL[saveState]}
            </span>
            <button
              type="button"
              onClick={reviewPdf}
              disabled={pdfBusy}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold ring-1 ring-white/40 hover:bg-white/10 disabled:opacity-60"
            >
              {pdfBusy && <Spinner className="h-3 w-3" />}PDF đối chiếu
            </button>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={submitting}
              className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-blue-800 shadow-sm hover:bg-emerald-50 disabled:opacity-60"
            >
              Nộp bài
            </button>
          </div>
        </div>
        <div className="h-1 bg-white/15">
          <div className="h-full bg-emerald-300 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </header>

      <div className="mx-auto mt-6 grid max-w-6xl gap-6 px-4 lg:grid-cols-[1fr_290px]">
        <main className="min-w-0 space-y-4">
          <Notice tone="warn" onClose={() => setNotice('')}>
            {notice}
          </Notice>
          {paged ? (
            <>
              <QuestionBlock
                q={q}
                index={idx}
                total={questions.length}
                value={answers[q.id]}
                onChange={(v) => setAnswer(q.id, v)}
                flagged={flags.has(q.id)}
                onFlag={() => toggleFlag(q.id)}
              />
              <div className="flex items-center justify-between gap-3">
                <Button variant="secondary" size="lg" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>
                  ← Câu trước
                </Button>
                <span className="text-sm tabular-nums text-slate-500">
                  {idx + 1} / {questions.length}
                </span>
                {idx < questions.length - 1 ? (
                  <Button size="lg" onClick={() => setIdx(idx + 1)}>
                    Câu sau →
                  </Button>
                ) : (
                  <Button variant="success" size="lg" onClick={() => setConfirmOpen(true)}>
                    Nộp bài
                  </Button>
                )}
              </div>
              <p className="hidden text-center text-xs text-slate-400 md:block">
                Phím tắt: <Kbd>←</Kbd> <Kbd>→</Kbd> chuyển câu · <Kbd>A</Kbd>–<Kbd>D</Kbd> chọn đáp án · <Kbd>F2</Kbd> đánh dấu xem lại
              </p>
            </>
          ) : (
            <>
              {questions.map((qq, i) => (
                <QuestionBlock
                  key={qq.id}
                  q={qq}
                  index={i}
                  total={questions.length}
                  value={answers[qq.id]}
                  onChange={(v) => setAnswer(qq.id, v)}
                  flagged={flags.has(qq.id)}
                  onFlag={() => toggleFlag(qq.id)}
                />
              ))}
              <div className="flex justify-end">
                <Button variant="success" size="lg" onClick={() => setConfirmOpen(true)}>
                  Nộp bài
                </Button>
              </div>
            </>
          )}
        </main>

        <aside className="space-y-4 lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
            <div className="flex items-end justify-between">
              <span className="font-bold text-slate-800">Bảng câu hỏi</span>
              <span className="text-xs text-slate-500">
                <b className="text-base text-slate-900">{answeredCount}</b>/{questions.length} đã làm
              </span>
            </div>
            <div className="mb-4 mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="bg-brand h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="grid grid-cols-6 gap-2 sm:grid-cols-8 lg:grid-cols-5">
              {questions.map((qq, i) => {
                const done = isAnswered(qq, answers[qq.id]);
                const cur = paged && i === idx;
                const fl = flags.has(qq.id);
                return (
                  <button
                    key={qq.id}
                    onClick={() => goTo(i)}
                    title={`Câu ${i + 1}: ${done ? 'đã trả lời' : 'chưa trả lời'}${fl ? ' · cần xem lại' : ''}`}
                    className={`relative h-10 rounded-lg text-sm font-semibold tabular-nums transition ${
                      done ? 'bg-brand text-white shadow-sm' : 'bg-slate-50 text-slate-600 ring-1 ring-slate-200 hover:ring-blue-400'
                    } ${cur ? 'ring-2 ring-amber-400 ring-offset-2' : ''}`}
                  >
                    {i + 1}
                    {fl && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-white bg-amber-400" />}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="bg-brand h-3 w-3 rounded" /> Đã trả lời
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-slate-50 ring-1 ring-slate-300" /> Chưa trả lời
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full bg-amber-400" /> Xem lại
              </span>
            </div>
            {unanswered.length > 0 && (
              <button
                type="button"
                onClick={() => goTo(unanswered.find((i) => !paged || i > idx) ?? unanswered[0])}
                className="mt-4 w-full rounded-lg bg-amber-50 px-3 py-2 text-left text-xs font-medium text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100"
              >
                Còn {unanswered.length} câu chưa trả lời → đến câu kế tiếp
              </button>
            )}
          </div>

          {webcam.enabled && (
            <div className="flex items-center gap-3 rounded-2xl bg-white px-5 py-3 text-xs shadow-sm ring-1 ring-slate-200/70">
              <span className={`h-2.5 w-2.5 rounded-full ${stream ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <span className="flex-1 text-slate-600">{stream ? 'Đang giám sát camera' : 'Camera chưa bật'}</span>
              <span className={warnCount ? 'font-bold text-red-600' : 'text-slate-500'}>
                {warnCount}
                {webcam.maxWarnings > 0 ? `/${webcam.maxWarnings}` : ''} cảnh báo
              </span>
            </div>
          )}
        </aside>
      </div>

      {webcam.enabled && stream && <WebcamMonitor stream={stream} config={webcam} onWarning={onWarning} onStatus={onCamStatus} />}

      {warnToast && (
        <div className="fixed left-1/2 top-24 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-red-600 px-5 py-3 text-sm font-semibold text-white shadow-xl">
          <Icon name="alert" className="h-4 w-4" /> Cảnh báo: {warnToast}
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
        <div className="grid grid-cols-3 gap-3 text-center">
          <SumBox label="Đã trả lời" value={`${answeredCount}/${questions.length}`} cls="bg-emerald-50 text-emerald-800" />
          <SumBox label="Chưa trả lời" value={unanswered.length} cls={unanswered.length ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-600'} />
          <SumBox label="Thời gian còn" value={fmtClock(remaining)} cls="bg-slate-50 text-slate-800" />
        </div>
        {unanswered.length > 0 && (
          <QuickList
            label="Câu chưa trả lời:"
            items={unanswered}
            onPick={(i) => {
              setConfirmOpen(false);
              goTo(i);
            }}
          />
        )}
        {flagged.length > 0 && (
          <QuickList
            label="Câu đánh dấu xem lại:"
            items={flagged}
            onPick={(i) => {
              setConfirmOpen(false);
              goTo(i);
            }}
          />
        )}
        <p className="mt-4 text-sm text-slate-600">Sau khi nộp sẽ không thể sửa bài.</p>
      </Modal>

      {locked && !submitting && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/90 p-6 text-center text-white backdrop-blur">
          <div className="max-w-md space-y-4 rounded-2xl bg-white/10 p-8 ring-1 ring-white/20">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-400 text-amber-950">
              <Icon name="alert" className="h-7 w-7" />
            </span>
            <h2 className="text-xl font-bold">{needFs ? 'Cần bật toàn màn hình' : 'Cần bật camera'}</h2>
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

function Kbd({ children }) {
  return <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-sans text-[10px] text-slate-600">{children}</kbd>;
}

function SumBox({ label, value, cls }) {
  return (
    <div className={`rounded-xl px-2 py-3 ${cls}`}>
      <div className="text-xl font-extrabold tabular-nums">{value}</div>
      <div className="text-[11px] opacity-80">{label}</div>
    </div>
  );
}

function QuickList({ label, items, onPick }) {
  return (
    <div className="mt-4">
      <div className="mb-2 text-sm font-medium text-slate-700">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((i) => (
          <button
            key={i}
            type="button"
            onClick={() => onPick(i)}
            className="h-8 min-w-8 rounded-lg bg-slate-100 px-2 text-xs font-semibold tabular-nums text-slate-700 hover:bg-blue-100 hover:text-blue-800"
          >
            {i + 1}
          </button>
        ))}
      </div>
    </div>
  );
}

const TYPE_HINT = { single: 'Chọn một đáp án', multiple: 'Chọn tất cả đáp án đúng', essay: 'Tự luận' };

function QuestionBlock({ q, index, total, value, onChange, flagged, onFlag }) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const toggle = (L) => {
    if (q.type === 'single') onChange([L]);
    else onChange(list.includes(L) ? list.filter((x) => x !== L) : [...list, L].sort());
  };
  return (
    <article id={`q-${q.id}`} className="scroll-mt-32 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-6 py-3">
        <span className="bg-brand rounded-lg px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
          Câu {index + 1}
          <span className="font-medium text-white/70"> / {total}</span>
        </span>
        <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200">{TYPE_HINT[q.type]}</span>
        <button
          type="button"
          onClick={onFlag}
          className={`ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            flagged ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-300' : 'text-slate-500 hover:bg-slate-100'
          }`}
        >
          <Icon name="flag" className="h-3.5 w-3.5" />
          {flagged ? 'Đã đánh dấu xem lại' : 'Đánh dấu xem lại'}
        </button>
      </div>
      <div className="p-6">
        <div className="whitespace-pre-wrap text-lg font-semibold leading-relaxed text-slate-900">{q.text}</div>
        {q.type === 'essay' ? (
          <>
            <textarea
              className="mt-5 min-h-56 w-full rounded-xl border border-slate-300 p-4 text-[15px] leading-relaxed focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-100"
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => onChange(e.target.value)}
              onPaste={(e) => e.preventDefault()}
              placeholder="Nhập câu trả lời…"
              maxLength={20000}
            />
            <div className="mt-1 text-right text-xs tabular-nums text-slate-400">{(typeof value === 'string' ? value : '').length.toLocaleString('vi-VN')} ký tự</div>
          </>
        ) : (
          <div className="mt-5 space-y-3">
            {q.options.map((opt, j) => {
              const L = LETTERS[j];
              const on = list.includes(L);
              return (
                <button
                  key={L}
                  type="button"
                  onClick={() => toggle(L)}
                  className={`group flex w-full items-center gap-4 rounded-xl border-2 px-4 py-3.5 text-left text-[15px] transition ${
                    on ? 'border-blue-600 bg-blue-50 shadow-sm' : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50'
                  }`}
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center text-sm font-bold transition ${
                      q.type === 'single' ? 'rounded-full' : 'rounded-lg'
                    } ${on ? 'bg-brand text-white shadow' : 'bg-slate-100 text-slate-600 group-hover:bg-blue-100 group-hover:text-blue-800'}`}
                  >
                    {L}
                  </span>
                  <span className={`flex-1 ${on ? 'font-semibold text-blue-900' : 'text-slate-800'}`}>{opt}</span>
                  {on && (
                    <span className="text-blue-700">
                      <Icon name="check" className="h-5 w-5" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </article>
  );
}
