import { useEffect, useRef, useState } from 'react';
import { KIND_LABEL } from '../lib/format.js';
import { createLandmarker, startMonitor } from './webcam.js';

const PHASE_LABEL = {
  loading: 'Đang khởi động giám sát…',
  calibrating: 'Hiệu chỉnh: nhìn thẳng vào màn hình',
  monitoring: 'Đang giám sát',
  error: 'Lỗi giám sát',
};

/** Khung camera nhỏ góc màn hình + vòng phát hiện khuôn mặt */
export default function WebcamMonitor({ stream, config, onWarning, onStatus }) {
  const videoRef = useRef(null);
  const [phase, setPhase] = useState('loading');
  const [anomaly, setAnomaly] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const warnRef = useRef(onWarning);
  const statusRef = useRef(onStatus);
  warnRef.current = onWarning;
  statusRef.current = onStatus;

  useEffect(() => {
    let cancelled = false;
    let monitor = null;
    const video = videoRef.current;
    video.srcObject = stream;
    video.play().catch(() => {});

    const track = stream.getVideoTracks()[0];
    const onEnded = () => statusRef.current?.('ended');
    track?.addEventListener('ended', onEnded);

    (async () => {
      try {
        const lm = await createLandmarker();
        if (cancelled) {
          lm.close();
          return;
        }
        monitor = startMonitor({
          video,
          landmarker: lm,
          config,
          onPhase: (p) => {
            setPhase(p);
            statusRef.current?.(p);
          },
          onAnomaly: setAnomaly,
          onWarning: (w) => warnRef.current?.(w),
        });
      } catch (e) {
        if (cancelled) return;
        setPhase('error');
        statusRef.current?.('error', e?.message || String(e));
      }
    })();

    return () => {
      cancelled = true;
      monitor?.stop();
      track?.removeEventListener('ended', onEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  const bad = phase === 'monitoring' && anomaly;
  return (
    <div className={`fixed bottom-4 right-4 z-40 overflow-hidden rounded-xl border-2 bg-black shadow-lg ${bad ? 'border-red-500' : 'border-slate-700'}`}>
      <video
        ref={videoRef}
        muted
        playsInline
        className={`block -scale-x-100 object-cover ${collapsed ? 'h-0 w-40' : 'h-[120px] w-40'}`}
      />
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className={`block w-40 px-2 py-1 text-left text-[11px] leading-tight text-white ${bad ? 'bg-red-600' : phase === 'error' ? 'bg-amber-600' : 'bg-slate-800'}`}
        title={collapsed ? 'Hiện khung camera' : 'Thu nhỏ khung camera'}
      >
        {bad ? KIND_LABEL[anomaly] : PHASE_LABEL[phase]}
      </button>
    </div>
  );
}
