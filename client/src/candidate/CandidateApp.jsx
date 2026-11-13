import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
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
      setInfo(i);
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

  const reloadInfo = useCallback(async () => setInfo(await api('/exam/info')), []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

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
