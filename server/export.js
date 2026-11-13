import ExcelJS from 'exceljs';
import { ZipArchive } from 'archiver';
import { q, getLogo, getSettings } from './db.js';
import { fmtVN, to10, SUBMIT_REASON_LABEL } from './util.js';
import { questionMap, RESULT_LABEL, participationStatus, PARTICIPATION_LABEL } from './attempts.js';
import { renderAttemptPdf } from './pdf.js';
import { fold } from './importer.js';

export function pdfFileName(a) {
  const seq = a.seq != null ? String(a.seq).padStart(3, '0') : 'xxx';
  const name = fold(a.name).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'thi_sinh';
  return `${seq}_${name}.pdf`;
}

export async function loadEvents(attemptIds) {
  if (!attemptIds.length) return new Map();
  const r = await q(
    `SELECT attempt_id, type, detail, snapshot, created_at FROM exam_events WHERE attempt_id = ANY($1::uuid[]) ORDER BY created_at`,
    [attemptIds]
  );
  const m = new Map();
  for (const e of r.rows) {
    if (!m.has(e.attempt_id)) m.set(e.attempt_id, []);
    m.get(e.attempt_id).push(e);
  }
  return m;
}

/** Ghi ZIP (Excel tổng hợp + PDF từng bài) ra stream res */
export async function writeResultsZip(res) {
  const [settings, logo, qmap, projects, attemptsR] = await Promise.all([
    getSettings(),
    getLogo(),
    questionMap(),
    q(`SELECT id, name FROM projects`),
    q(`SELECT * FROM exam_attempts ORDER BY seq NULLS LAST, started_at`),
  ]);
  const projectName = new Map(projects.rows.map((p) => [p.id, p.name]));
  const attempts = attemptsR.rows;
  const events = await loadEvents(attempts.map((a) => a.id));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Tổng hợp');
  ws.columns = [
    { header: 'STT', key: 'seq', width: 7 },
    { header: 'Họ và tên', key: 'name', width: 26 },
    { header: 'Email', key: 'email', width: 32 },
    { header: 'Chức danh / vị trí', key: 'job', width: 22 },
    { header: 'Cấp bậc', key: 'level', width: 14 },
    { header: 'Địa điểm kiểm tra', key: 'project', width: 22 },
    { header: 'Bắt đầu', key: 'start', width: 17 },
    { header: 'Nộp bài', key: 'submit', width: 17 },
    { header: 'Trạng thái', key: 'status', width: 18 },
    { header: 'Lý do nộp', key: 'reason', width: 24 },
    { header: 'TN đúng', key: 'mcCorrect', width: 9 },
    { header: 'Điểm TN', key: 'mcScore', width: 9 },
    { header: 'Điểm TL', key: 'essay', width: 9 },
    { header: 'Tổng điểm', key: 'total', width: 10 },
    { header: 'Tối đa', key: 'max', width: 8 },
    { header: 'Thang 10', key: 'score10', width: 9 },
    { header: 'Kết quả', key: 'result', width: 16 },
    { header: 'Vi phạm chuyển tab', key: 'tab', width: 11 },
    { header: 'Cảnh báo webcam', key: 'webcam', width: 11 },
  ];
  const ws2 = wb.addWorksheet('Hồ sơ phúc khảo');
  ws2.columns = [
    { header: 'STT', width: 7 },
    { header: 'Họ và tên', width: 26 },
    { header: 'Email', width: 32 },
    { header: 'Kết quả', width: 16 },
    { header: 'Bài làm (PDF)', width: 40 },
  ];

  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on('warning', (e) => console.warn('zip warning', e));
  const done = new Promise((resolve, reject) => {
    archive.on('error', reject);
    res.on('close', resolve);
    archive.on('end', resolve);
  });
  archive.pipe(res);

  const usedNames = new Set();
  for (const a of attempts) {
    const essaySum = Object.values(a.essay_scores || {}).reduce((t, v) => t + Number(v || 0), 0);
    const st = participationStatus(a);
    ws.addRow({
      seq: a.seq,
      name: a.name,
      email: a.email,
      job: a.job_title,
      level: a.level,
      project: projectName.get(a.project_id) || '',
      start: fmtVN(a.started_at),
      submit: fmtVN(a.submitted_at),
      status: PARTICIPATION_LABEL[st],
      reason: SUBMIT_REASON_LABEL[a.submit_reason] || '',
      mcCorrect: a.mc_correct,
      mcScore: a.mc_score,
      essay: a.submitted_at ? essaySum : null,
      total: a.total_score,
      max: a.max_score,
      score10: to10(a.total_score, a.max_score),
      result: a.submitted_at ? RESULT_LABEL[a.result] || '' : '',
      tab: a.tab_violation ? 'Có' : '',
      webcam: a.webcam_warnings || 0,
    });
    if (!a.submitted_at) continue;
    let file = pdfFileName(a);
    for (let k = 2; usedNames.has(file); k++) file = pdfFileName(a).replace(/\.pdf$/, `_${k}.pdf`);
    usedNames.add(file);
    const pdf = await renderAttemptPdf({
      attempt: a,
      qmap,
      mode: 'full',
      projectName: projectName.get(a.project_id),
      events: events.get(a.id) || [],
      logo,
      title: settings.title,
    });
    archive.append(pdf, { name: `pdf/${file}` });
    const row = ws2.addRow([a.seq, a.name, a.email, RESULT_LABEL[a.result] || '', '']);
    row.getCell(5).value = { text: file, hyperlink: `pdf/${file}` };
    row.getCell(5).font = { color: { argb: 'FF1D4ED8' }, underline: true };
  }
  for (const w of [ws, ws2]) {
    w.getRow(1).font = { bold: true };
    w.views = [{ state: 'frozen', ySplit: 1 }];
  }
  archive.append(Buffer.from(await wb.xlsx.writeBuffer()), { name: 'tong_hop_ket_qua.xlsx' });
  await archive.finalize();
  await done;
}
