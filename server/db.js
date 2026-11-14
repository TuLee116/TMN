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
  // Email kết quả
  emailSubject: 'Kết quả {ky_thi}',
  emailBody: [
    'Chào {ho_ten},',
    '',
    'Cảm ơn anh/chị đã tham gia {ky_thi}.',
    'Kết quả: {ket_qua} – {thang_10}/10 điểm (tổng {tong_diem}/{diem_toi_da}).',
    'Thời gian nộp bài: {ngay_nop}.',
    '',
    'Trân trọng,',
    '{don_vi}',
  ].join('\n'),
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
  shuffleOptions: false, // xáo thứ tự phương án A/B/C/D cho từng thí sinh
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
    ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS result_emailed_at TIMESTAMPTZ;
    ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS option_orders JSONB NOT NULL DEFAULT '{}';

    CREATE TABLE IF NOT EXISTS admin_users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','grader')),
      password_hash TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY,
      at TIMESTAMPTZ NOT NULL DEFAULT now(),
      actor TEXT,
      role TEXT,
      action TEXT NOT NULL,
      detail JSONB,
      ip TEXT
    );
    CREATE INDEX IF NOT EXISTS audit_log_at_idx ON audit_log(at DESC);

    -- Đợt thi đã kết thúc: lưu nguyên bài làm, câu hỏi, cấu hình tại thời điểm lưu trữ
    CREATE TABLE IF NOT EXISTS exam_rounds (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      opened_at TIMESTAMPTZ,
      archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      archived_by TEXT,
      settings JSONB NOT NULL,
      questions JSONB NOT NULL,
      projects JSONB NOT NULL DEFAULT '[]',
      participants INTEGER NOT NULL DEFAULT 0,
      stats JSONB NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS archived_attempts (
      id UUID PRIMARY KEY,
      round_id INTEGER NOT NULL REFERENCES exam_rounds(id) ON DELETE CASCADE,
      data JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS archived_attempts_round_idx ON archived_attempts(round_id);
    CREATE TABLE IF NOT EXISTS archived_events (
      id BIGSERIAL PRIMARY KEY,
      round_id INTEGER NOT NULL REFERENCES exam_rounds(id) ON DELETE CASCADE,
      attempt_id UUID NOT NULL,
      type TEXT NOT NULL,
      detail JSONB,
      snapshot TEXT,
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS archived_events_attempt_idx ON archived_events(attempt_id);
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
