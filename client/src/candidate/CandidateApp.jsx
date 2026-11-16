import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { connect } from '../lib/live.js';
import { Loading, Notice, Button } from '../lib/ui.jsx';
import Landing from './Landing.jsx';
import ExamView from './ExamView.jsx';
import ResultView from './ResultView.jsx';

export default function CandidateApp() {
  const [info, setInfo] = useState(null);
  const [attempt, setAttempt] = useState(undefined);
  const [error, setError] = useState('');
  const streamRef = useRef(null);
  const [stream, setStreamState] = useState(null);

  const setStream = useCallback((s) => {
    if (streamRef.current && streamRef.current !== s) streamRef.current.getTracks().forEach((t) => t.stop());
    streamRef.current = s;
    setStreamState(s);
  }, []);

  const load = useCallback(async () => {
    try {
      const [i, s] = await Promise.all([api('/exam/info'), api('/exam/state')]);
      setInfo({ ...i, receivedAt: Date.now() });
      setAttempt(s.attempt);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const refreshState = useCallback(async () => {
    const s = await api('/exam/state');
    setAttempt(s.attempt);
    return s.attempt;
  }, []);

  const reloadInfo = useCallback(async () => setInfo({ ...(await api('/exam/info')), receivedAt: Date.now() }), []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  // Thời gian thực: máy chủ báo thay đổi cấu hình / bài làm (thu bài, chấm xong, cho thi lại…)
  const attemptId = attempt?.id || null;
  useEffect(() => {
    if (attempt === undefined) return;
    return connect(
      '/api/exam/stream',
      (ev) => {
        if (ev.type === 'settings') reloadInfo().catch(() => {});
        else if (ev.type === 'attempt') refreshState().catch(() => {});
      },
      () => load()
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, attempt === undefined]);

  // Bài bị kết thúc từ phía quản trị (thu bài / cho thi lại): thoát toàn màn hình, tắt camera
  const prevStatus = useRef(null);
  useEffect(() => {
    const st = attempt?.status || null;
    if (prevStatus.current === 'in_progress' && st !== 'in_progress') {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      setStream(null);
    }
    prevStatus.current = st;
  }, [attempt?.status, setStream]);

  if (error && !info)
    return (
      <div className="mx-auto max-w-xl p-6">
        <Notice tone="error">{error}</Notice>
        <Button className="mt-4" onClick={load}>
          Thử lại
        </Button>
      </div>
    );
  if (!info || attempt === undefined) return <Loading />;

  if (attempt?.status === 'in_progress')
    return (
      <ExamView
        key={attempt.id}
        attempt={attempt}
        testMode={info.testMode}
        stream={stream}
        setStream={setStream}
        onSubmitted={(a) => {
          setStream(null);
          setAttempt(a);
        }}
        onRefresh={refreshState}
      />
    );

  if (attempt?.status === 'submitted')
    return (
      <ResultView
        attempt={attempt}
        testMode={info.testMode}
        finishMessage={info.settings?.finishMessage}
        organization={info.settings?.organization}
        onRefresh={refreshState}
        onReset={async () => {
          await api('/exam/reset', { method: 'POST' });
          await load();
        }}
      />
    );

  return (
    <Landing
      info={info}
      onReloadInfo={reloadInfo}
      onStarted={async (s) => {
        setStream(s);
        await refreshState();
      }}
    />
  );
}
