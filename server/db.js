import pg from 'pg';

const { Pool, types } = pg;

// NUMERIC -> number (mặc định pg trả chuỗi)
types.setTypeParser(1700, (v) => (v == null ? null : parseFloat(v)));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Thiếu biến môi trường DATABASE_URL (chuỗi kết nối Postgres).');
  process.exit(1);
}

const useSsl = /sslmode=require/.test(connectionString) || process.env.PGSSL === 'true';

export const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.PG_POOL_MAX || 10),
});

export const q = (text, params) => pool.query(text, params);

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export const DEFAULT_SETTINGS = {
  title: 'Bài kiểm tra nội bộ',
  // Nội dung hiển thị cho thí sinh (admin chỉnh được)
  organization: 'Tân Minh Nhân Corporation',
  subtitle: '',
  intro: '',
  rules: [
    'Bài kiểm tra tự bật chế độ toàn màn hình khi bắt đầu và phải giữ toàn màn hình trong suốt thời gian làm bài.',
    '**Không chuyển tab, chuyển cửa sổ hay thu nhỏ trình duyệt.** Nếu trang bị ẩn, hệ thống sẽ **tự động nộp bài** và bài bị tính **không đạt**.',
    'Mỗi email chỉ được làm một lần. Nếu lỡ tải lại trang, bạn tiếp tục lượt đang làm trên cùng trình duyệt.',
    'Hết giờ hệ thống tự nộp bài. Đáp án được lưu tự động trong khi làm.',
  ].join('\n'),
  finishMessage: '',
  openingAt: '',
  closingAt: '',
  durationMinutes: 30,
  multipleChoiceCount: 10,
  essayCount: 0,
  mcPointsPerQuestion: 1,
  essayPointsPerQuestion: 1,
  passingScore: 5,
  showScore: true,
  displayMode: 'paged',
  active: false,
  shuffleQuestions: true,
  // Rút đề trắc nghiệm theo tỷ lệ độ khó (%)
  mixEnabled: false,
  mixEasy: 40,
  mixMedium: 40,
  mixHard: 20,
  // Giám sát webcam
  webcamEnabled: false,
  webcamRequired: true,
  webcamHoldSeconds: 2,
  webcamYawThreshold: 0.12,
  webcamGazeThreshold: 0.18,
  webcamMaxWarnings: 0,
};

export async function initSchema() {
  await q(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS participants (
      email TEXT PRIMARY KEY,
      seq INTEGER,
      name TEXT
    );

    CREATE TABLE IF NOT EXISTS questions (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('single','multiple','essay')),
      text TEXT NOT NULL,
      options JSONB NOT NULL DEFAULT '[]',
      correct JSONB NOT NULL DEFAULT '[]',
      reference TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS exam_attempts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      token TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      seq INTEGER,
      name TEXT NOT NULL,
      job_title TEXT,
      level TEXT,
      project_id UUID REFERENCES projects(id),
      question_ids JSONB NOT NULL,
      answers JSONB NOT NULL DEFAULT '{}',
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deadline_at TIMESTAMPTZ NOT NULL,
      submitted_at TIMESTAMPTZ,
      submit_reason TEXT,
      mc_correct INTEGER,
      mc_score NUMERIC,
      essay_scores JSONB NOT NULL DEFAULT '{}',
      total_score NUMERIC,
      max_score NUMERIC,
      result TEXT,
      tab_violation BOOLEAN NOT NULL DEFAULT FALSE,
      webcam_warnings INTEGER NOT NULL DEFAULT 0,
      settings_snapshot JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS exam_events (
      id SERIAL PRIMARY KEY,
      attempt_id UUID NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      detail JSONB,
      snapshot TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS exam_events_attempt_idx ON exam_events(attempt_id);
    ALTER TABLE questions ADD COLUMN IF NOT EXISTS topic TEXT;
    ALTER TABLE questions ADD COLUMN IF NOT EXISTS difficulty TEXT;
  `);
}

export async function getSettings() {
  const r = await q(`SELECT value FROM app_settings WHERE key='exam'`);
  return { ...DEFAULT_SETTINGS, ...(r.rows[0]?.value || {}) };
}

export async function saveSettings(value) {
  await q(
    `INSERT INTO app_settings(key,value) VALUES('exam',$1)
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
    [value]
  );
}

export async function getLogo() {
  const r = await q(`SELECT value FROM app_settings WHERE key='logo'`);
  return r.rows[0]?.value || null;
}

export async function saveLogo(value) {
  if (!value) {
    await q(`DELETE FROM app_settings WHERE key='logo'`);
    return;
  }
  await q(
    `INSERT INTO app_settings(key,value) VALUES('logo',$1)
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
    [value]
  );
}
