import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';
import { fmtVN, to10, SUBMIT_REASON_LABEL } from './util.js';
import { answerList, RESULT_LABEL } from './attempts.js';

const require = createRequire(import.meta.url);

function fontDir() {
  try {
    return path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
  } catch {
    return path.resolve(process.cwd(), 'node_modules/dejavu-fonts-ttf/ttf');
  }
}
const FONT = path.join(fontDir(), 'DejaVuSans.ttf');
const FONT_BOLD = path.join(fontDir(), 'DejaVuSans-Bold.ttf');
const HAS_FONT = fs.existsSync(FONT);

const LETTERS = 'ABCDEF';
const KIND_LABEL = {
  yaw: 'Quay đầu',
  gaze: 'Liếc mắt',
  no_face: 'Không thấy khuôn mặt',
  multi_face: 'Nhiều khuôn mặt',
};

const fmtNum = (n) => (n == null ? '—' : String(Math.round(Number(n) * 100) / 100).replace('.', ','));

// Logo mặc định khi admin chưa tải logo lên
const DEFAULT_LOGO = [path.resolve(process.cwd(), 'public/logo.png'), path.resolve(process.cwd(), 'dist/logo.png')].find((p) =>
  fs.existsSync(p)
);

function logoBuffer(logo) {
  if (!logo?.data) {
    try {
      return DEFAULT_LOGO ? fs.readFileSync(DEFAULT_LOGO) : null;
    } catch {
      return null;
    }
  }
  if (!/^image\/(png|jpe?g)$/.test(logo.mime)) return null;
  try {
    return Buffer.from(logo.data, 'base64');
  } catch {
    return null;
  }
}

function dataUrlBuffer(s) {
  const m = /^data:image\/jpeg;base64,(.+)$/.exec(s || '');
  return m ? Buffer.from(m[1], 'base64') : null;
}

/**
 * Xuất PDF một bài làm.
 * mode 'review'  – thí sinh tự xuất khi đang làm: chỉ câu hỏi + lựa chọn, không có đáp án đúng.
 * mode 'full'    – hồ sơ phúc khảo: đáp án đúng, điểm, nhật ký webcam.
 */
export function renderAttemptPdf({ attempt, qmap, mode = 'full', projectName = '', events = [], logo = null, title = '' }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: title || 'Bài kiểm tra' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (HAS_FONT) {
      doc.registerFont('R', FONT);
      doc.registerFont('B', fs.existsSync(FONT_BOLD) ? FONT_BOLD : FONT);
    }
    const R = HAS_FONT ? 'R' : 'Helvetica';
    const B = HAS_FONT ? 'B' : 'Helvetica-Bold';
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    const lb = logoBuffer(logo);
    if (lb) {
      try {
        doc.image(lb, doc.page.margins.left, doc.y, { fit: [120, 48] });
        doc.moveDown(3.2);
      } catch {
        /* logo hỏng thì bỏ qua */
      }
    }

    const s = attempt.settings_snapshot || {};
    doc.font(B).fontSize(15).text(title || s.title || 'Bài kiểm tra', { align: 'center' });
    doc.font(R).fontSize(9).fillColor('#555')
      .text(mode === 'review' ? 'Bản đối chiếu bài làm (xuất khi đang làm bài)' : 'Hồ sơ bài làm', { align: 'center' });
    doc.fillColor('black').moveDown();

    const info = [
      ['Số thứ tự', attempt.seq ?? ''],
      ['Họ và tên', attempt.name],
      ['Email', attempt.email],
      ['Chức danh / vị trí', attempt.job_title || ''],
      ['Cấp bậc', attempt.level || ''],
      ['Địa điểm kiểm tra', projectName || ''],
      ['Bắt đầu', fmtVN(attempt.started_at)],
      ['Nộp bài', attempt.submitted_at ? fmtVN(attempt.submitted_at) : 'Chưa nộp'],
    ];
    if (attempt.submitted_at) info.push(['Lý do nộp', SUBMIT_REASON_LABEL[attempt.submit_reason] || attempt.submit_reason || '']);
    if (mode === 'full' && attempt.submitted_at) {
      const score10 = to10(attempt.total_score, attempt.max_score);
      info.push(['Trắc nghiệm đúng', `${attempt.mc_correct ?? 0} câu – ${fmtNum(attempt.mc_score)} điểm`]);
      info.push(['Tổng điểm', `${fmtNum(attempt.total_score)} / ${fmtNum(attempt.max_score)} (thang 10: ${fmtNum(score10)})`]);
      info.push(['Kết quả', `${RESULT_LABEL[attempt.result] || ''}${attempt.tab_violation ? ' – Trượt: chuyển tab' : ''}`]);
      info.push(['Cảnh báo webcam', String(attempt.webcam_warnings || 0)]);
    }
    doc.fontSize(10);
    for (const [k, v] of info) {
      doc.font(B).text(`${k}: `, { continued: true }).font(R).text(String(v ?? ''));
    }
    doc.moveDown();

    attempt.question_ids.forEach((id, i) => {
      const qu = qmap.get(id);
      if (!qu) return;
      if (doc.y > doc.page.height - 140) doc.addPage();
      const ans = attempt.answers?.[id];
      doc.font(B).fontSize(11).text(`Câu ${i + 1}. `, { continued: true }).font(R).text(qu.text, { width });
      if (qu.type === 'essay') {
        doc.moveDown(0.2).font(B).fontSize(9).fillColor('#555').text('Trả lời:');
        doc.font(R).fontSize(10).fillColor('black').text(typeof ans === 'string' && ans.trim() ? ans : '(không trả lời)', {
          width,
          indent: 10,
        });
        if (mode === 'full') {
          if (qu.reference) {
            doc.font(B).fontSize(9).fillColor('#555').text('Đáp án tham khảo:');
            doc.font(R).fillColor('#333').text(qu.reference, { width, indent: 10 });
          }
          const sc = attempt.essay_scores?.[id];
          doc.font(B).fontSize(9).fillColor('#1d4ed8')
            .text(`Điểm: ${sc == null ? 'chưa chấm' : fmtNum(sc)} / ${fmtNum(s.essayPointsPerQuestion)}`);
        }
      } else {
        const chosen = answerList(ans);
        qu.options.forEach((opt, j) => {
          const L = LETTERS[j];
          const isChosen = chosen.includes(L);
          const isCorrect = mode === 'full' && qu.correct.includes(L);
          let mark = isChosen ? '■' : '□';
          let color = 'black';
          if (mode === 'full') {
            if (isCorrect) color = '#15803d';
            else if (isChosen) color = '#b91c1c';
          }
          doc.font(isChosen ? B : R).fontSize(10).fillColor(color)
            .text(`${mark} ${L}. ${opt}${isCorrect ? '  ✓' : ''}`, { width, indent: 10 });
        });
        if (mode === 'full') {
          const ok = chosen.length && [...chosen].sort().join() === [...qu.correct].sort().join();
          doc.font(R).fontSize(9).fillColor(ok ? '#15803d' : '#b91c1c')
            .text(`Đáp án đúng: ${qu.correct.join(', ')} – ${ok ? 'Đúng' : chosen.length ? 'Sai' : 'Không trả lời'}`);
        }
      }
      doc.fillColor('black').moveDown(0.8);
    });

    if (mode === 'full' && events.length) {
      doc.addPage();
      doc.font(B).fontSize(13).text('Nhật ký giám sát webcam');
      doc.moveDown(0.5);
      for (const ev of events) {
        if (doc.y > doc.page.height - 150) doc.addPage();
        const kind = KIND_LABEL[ev.detail?.kind] || ev.detail?.kind || ev.type;
        doc.font(R).fontSize(10).text(`${fmtVN(ev.created_at)} – ${kind}${ev.detail?.message ? ` (${ev.detail.message})` : ''}`);
        const img = dataUrlBuffer(ev.snapshot);
        if (img) {
          try {
            doc.image(img, { fit: [160, 120] });
          } catch {
            /* ảnh hỏng */
          }
        }
        doc.moveDown(0.5);
      }
    }
    doc.end();
  });
}
