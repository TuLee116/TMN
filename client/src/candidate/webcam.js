import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// WASM do máy chủ phục vụ từ node_modules; mô hình tải từ kho chính thức của MediaPipe
const WASM_PATH = '/mediapipe/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const CALIBRATION_MS = 3000;
const CALIBRATION_GIVE_UP_MS = 15000;
const TICK_MS = 200;
const MAX_SNAPSHOTS = 20;

export async function createLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numFaces: 2,
  });
  try {
    return await FaceLandmarker.createFromOptions(fileset, opts('GPU'));
  } catch {
    return FaceLandmarker.createFromOptions(fileset, opts('CPU'));
  }
}

function ratio(p, a, b) {
  const d = b.x - a.x;
  if (!p || !a || !b || Math.abs(d) < 1e-6) return 0.5;
  return (p.x - a.x) / d;
}

/**
 * yaw: vị trí mũi (1) giữa hai má (234, 454) – 0,5 là nhìn thẳng.
 * gaze: vị trí con ngươi (468, 473) giữa hai khóe mắt (33–133, 362–263).
 */
export function faceMetrics(lm) {
  const yaw = ratio(lm[1], lm[234], lm[454]);
  const gaze = lm.length >= 478 ? (ratio(lm[468], lm[33], lm[133]) + ratio(lm[473], lm[362], lm[263])) / 2 : 0.5;
  return { yaw, gaze };
}

function median(xs) {
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function capture(video) {
  const w = 160;
  const h = Math.round((w * (video.videoHeight || 120)) / (video.videoWidth || 160));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(video, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.6);
}

/**
 * Chạy vòng giám sát. Trả về { stop }.
 * onPhase('calibrating' | 'monitoring'), onAnomaly(kind|null), onWarning({kind, value, snapshot})
 */
export function startMonitor({ video, landmarker, config, onPhase, onAnomaly, onWarning }) {
  const holdMs = Math.max(500, (Number(config.holdSeconds) || 2) * 1000);
  const yawT = Number(config.yawThreshold) || 0.12;
  const gazeT = Number(config.gazeThreshold) || 0.18;
  const startedAt = performance.now();
  let calibStart = null;
  const samples = [];
  let base = null;
  let lastTs = -1;
  let cur = null;
  let curSince = 0;
  let reported = false;
  let snaps = 0;

  onPhase('calibrating');

  const tick = () => {
    if (video.readyState < 2 || video.paused) return;
    const now = performance.now();
    if (now <= lastTs) return;
    lastTs = now;
    let res;
    try {
      res = landmarker.detectForVideo(video, now);
    } catch {
      return;
    }
    const faces = res?.faceLandmarks || [];
    let kind = null;
    let value;
    let m = null;
    if (faces.length === 0) kind = 'no_face';
    else if (faces.length > 1) kind = 'multi_face';
    else m = faceMetrics(faces[0]);

    // Hiệu chỉnh: 3 giây đầu nhìn thẳng vào màn hình
    if (!base) {
      if (m) {
        if (calibStart == null) calibStart = now;
        samples.push(m);
        if (now - calibStart >= CALIBRATION_MS && samples.length >= 5) {
          base = { yaw: median(samples.map((s) => s.yaw)), gaze: median(samples.map((s) => s.gaze)) };
        }
      } else {
        calibStart = null;
        samples.length = 0;
      }
      if (!base && now - startedAt > CALIBRATION_GIVE_UP_MS) base = { yaw: 0.5, gaze: 0.5 };
      if (base) onPhase('monitoring');
      return;
    }

    if (m) {
      const dy = Math.abs(m.yaw - base.yaw);
      const dg = Math.abs(m.gaze - base.gaze);
      if (dy > yawT) {
        kind = 'yaw';
        value = dy;
      } else if (dg > gazeT) {
        kind = 'gaze';
        value = dg;
      }
    }

    if (kind !== cur) {
      cur = kind;
      curSince = now;
      reported = false;
      onAnomaly(kind);
    } else if (kind && !reported && now - curSince >= holdMs) {
      reported = true;
      let snapshot = null;
      if (snaps < MAX_SNAPSHOTS) {
        try {
          snapshot = capture(video);
          snaps++;
        } catch {
          /* bỏ qua */
        }
      }
      onWarning({ kind, value: value != null ? Math.round(value * 100) / 100 : undefined, snapshot });
    }
  };

  const timer = setInterval(tick, TICK_MS);
  return {
    stop() {
      clearInterval(timer);
      try {
        landmarker.close();
      } catch {
        /* bỏ qua */
      }
    },
  };
}
