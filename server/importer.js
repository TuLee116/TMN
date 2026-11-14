import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { normalizeEmail, isCompanyEmail, EMAIL_DOMAIN } from './util.js';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** bỏ dấu, viết thường – dùng so khớp tiêu đề cột */
export function fold(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Giá trị ô ExcelJS -> chuỗi */
export function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('').trim();
    if ('text' in v) return cellText(v.text);
    if ('result' in v) return cellText(v.result);
    if ('hyperlink' in v) return String(v.hyperlink).replace(/^mailto:/i, '').trim();
    return '';
  }
  return String(v).trim();
}

function normType(t) {
  const f = fold(t);
  if (!f) return '';
  if (['single', 'mot dap an', '1 dap an', 'mot', 'don'].includes(f)) return 'single';
  if (['multiple', 'nhieu dap an', 'nhieu'].includes(f)) return 'multiple';
  if (['essay', 'tu luan'].includes(f)) return 'essay';
  return f;
}

/** Độ khó: dễ / trung bình / khó (hoặc easy / medium / hard). Trả về null nếu bỏ trống, false nếu sai. */
export function normDifficulty(v) {
  const f = fold(v);
  if (!f) return null;
  if (['easy', 'de', '1'].includes(f)) return 'easy';
  if (['medium', 'trung binh', 'tb', 'vua', '2'].includes(f)) return 'medium';
  if (['hard', 'kho', '3'].includes(f)) return 'hard';
  return false;
}

function parseCorrect(s) {
  return [...new Set(String(s ?? '').toUpperCase().split(/[\s,;/.]+/).filter((x) => LETTERS.includes(x)))].sort();
}

/** Kiểm tra và chuẩn hoá một câu hỏi thô. Trả về { question, errors[] } */
export function finishQuestion(raw) {
  const errors = [];
  const text = String(raw.text || '').trim();
  if (!text) errors.push('Thiếu nội dung câu hỏi');
  // các phương án phải liên tục A, B, C… không bỏ trống giữa chừng
  const opts = raw.options.map((o) => String(o ?? '').trim());
  while (opts.length && !opts[opts.length - 1]) opts.pop();
  if (opts.some((o) => !o)) errors.push('Có phương án bị bỏ trống giữa chừng');
  const correct = parseCorrect(raw.correct);
  let type = normType(raw.type);
  if (!type) type = opts.length === 0 ? 'essay' : correct.length > 1 ? 'multiple' : 'single';
  if (!['single', 'multiple', 'essay'].includes(type)) errors.push(`Loại câu hỏi "${raw.type}" không hợp lệ (single/multiple/essay)`);
  if (type === 'single' || type === 'multiple') {
    if (opts.length < 2) errors.push('Câu trắc nghiệm cần ít nhất 2 phương án');
    if (!correct.length) errors.push('Thiếu đáp án đúng');
    const bad = correct.filter((l) => LETTERS.indexOf(l) >= opts.length);
    if (bad.length) errors.push(`Đáp án ${bad.join(',')} không có phương án tương ứng`);
    if (type === 'single' && correct.length > 1) errors.push('Câu "single" chỉ được một đáp án đúng');
  }
  const difficulty = normDifficulty(raw.difficulty);
  if (difficulty === false) errors.push(`Độ khó "${raw.difficulty}" không hợp lệ (dễ / trung bình / khó)`);
  return {
    errors,
    question: {
      type,
      text,
      options: type === 'essay' ? [] : opts,
      correct: type === 'essay' ? [] : correct,
      reference: String(raw.reference || '').trim() || null,
      topic: String(raw.topic || '').trim().slice(0, 100) || null,
      difficulty: difficulty || null,
    },
  };
}

/** Đọc câu hỏi từ Excel theo mẫu */
export async function parseQuestionsXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { questions: [], errors: [{ row: 0, message: 'Tệp không có trang tính' }] };

  // tìm dòng tiêu đề (dòng đầu có ô "Câu hỏi")
  let headerRow = 1;
  for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) {
    const vals = ws.getRow(r).values.map(cellText).map(fold);
    if (vals.includes('cau hoi')) {
      headerRow = r;
      break;
    }
  }
  const col = { text: 1, A: 2, B: 3, C: 4, D: 5, E: 6, F: 7, correct: 8, type: 9, reference: 11, topic: 12, difficulty: 13 };
  ws.getRow(headerRow).eachCell((cell, c) => {
    const h = fold(cellText(cell.value));
    if (h === 'cau hoi') col.text = c;
    else if (/^[a-f]$/.test(h)) col[h.toUpperCase()] = c;
    else if (h.startsWith('dap an tham khao')) col.reference = c;
    else if (h.startsWith('dap an dung') || h === 'dap an') col.correct = c;
    else if (h.startsWith('loai')) col.type = c;
    else if (h.startsWith('chu de')) col.topic = c;
    else if (h.startsWith('do kho')) col.difficulty = c;
  });

  const questions = [];
  const errors = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (c) => cellText(row.getCell(c).value);
    const raw = {
      text: get(col.text),
      options: LETTERS.map((l) => get(col[l])),
      correct: get(col.correct),
      type: get(col.type),
      reference: get(col.reference),
      topic: get(col.topic),
      difficulty: get(col.difficulty),
    };
    if (!raw.text && raw.options.every((o) => !o) && !raw.correct && !raw.type) continue; // dòng trống
    const { question, errors: e } = finishQuestion(raw);
    if (e.length) errors.push({ row: r, message: e.join('; ') });
    else questions.push({ ...question, row: r });
  }
  if (!questions.length && !errors.length) errors.push({ row: 0, message: 'Không tìm thấy câu hỏi nào trong tệp' });
  return { questions, errors };
}

/**
 * Đọc câu hỏi từ Word. Định dạng:
 *   Câu 1: Nội dung
 *   A. ...   B. ...
 *   Đáp án: A,C
 *   Loại: single | multiple | essay
 *   Đáp án tham khảo: ...
 */
export async function parseQuestionsDocx(buffer) {
  const { value } = await mammoth.extractRawText({ buffer });
  const lines = value.split(/\r?\n/).map((l) => l.trim());
  const blocks = [];
  let cur = null;
  let field = null; // 'text' | 'option' | 'reference'
  for (const line of lines) {
    if (!line) continue;
    let m;
    if ((m = line.match(/^C[âa]u\s*(\d+)\s*[:.)]\s*(.*)$/i))) {
      cur = { no: Number(m[1]), text: m[2], options: [], correct: '', type: '', reference: '', topic: '', difficulty: '' };
      blocks.push(cur);
      field = 'text';
      continue;
    }
    if (!cur) continue;
    const f = fold(line);
    if ((m = line.match(/^([A-F])\s*[.)]\s*(.*)$/)) && field !== 'reference') {
      const idx = LETTERS.indexOf(m[1]);
      while (cur.options.length < idx) cur.options.push('');
      cur.options[idx] = m[2];
      field = 'option';
    } else if (f.startsWith('dap an tham khao')) {
      cur.reference = line.slice(line.indexOf(':') + 1).trim();
      field = 'reference';
    } else if (/^dap an( dung)?\s*:/.test(f)) {
      cur.correct = line.slice(line.indexOf(':') + 1);
      field = null;
    } else if (/^loai( cau hoi)?\s*:/.test(f)) {
      cur.type = line.slice(line.indexOf(':') + 1);
      field = null;
    } else if (/^chu de\s*:/.test(f)) {
      cur.topic = line.slice(line.indexOf(':') + 1).trim();
      field = null;
    } else if (/^do kho\s*:/.test(f)) {
      cur.difficulty = line.slice(line.indexOf(':') + 1).trim();
      field = null;
    } else if (/^diem\s*:/.test(f)) {
      field = null;
    } else if (field === 'text') {
      cur.text += '\n' + line;
    } else if (field === 'reference') {
      cur.reference += '\n' + line;
    } else if (field === 'option' && cur.options.length) {
      cur.options[cur.options.length - 1] += ' ' + line;
    }
  }
  const questions = [];
  const errors = [];
  for (const b of blocks) {
    const { question, errors: e } = finishQuestion(b);
    if (e.length) errors.push({ row: b.no, message: e.join('; ') });
    else questions.push({ ...question, row: b.no });
  }
  if (!blocks.length) errors.push({ row: 0, message: 'Không tìm thấy câu hỏi nào (mỗi câu bắt đầu bằng "Câu 1:", "Câu 2:"…)' });
  return { questions, errors };
}

const SAMPLES = [
  { text: 'Thủ đô của Việt Nam là?', options: ['Hà Nội', 'Huế', 'Đà Nẵng', 'Cần Thơ'], correct: 'A', type: 'single', reference: '', topic: 'Kiến thức chung', difficulty: 'Dễ' },
  { text: 'Chọn các số nguyên tố', options: ['2', '4', '5'], correct: 'A,C', type: 'multiple', reference: '', topic: 'Toán', difficulty: 'Trung bình' },
  {
    text: 'Trình bày một giải pháp bảo vệ môi trường',
    options: [],
    correct: '',
    type: 'essay',
    reference: 'Phân loại rác tại nguồn, giảm sử dụng nhựa dùng một lần…',
    topic: 'Môi trường',
    difficulty: 'Khó',
  },
];

export async function questionTemplateXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Câu hỏi');
  ws.columns = [
    { header: 'Câu hỏi', width: 50 },
    ...LETTERS.map((l) => ({ header: l, width: 18 })),
    { header: 'Đáp án đúng (A,C)', width: 18 },
    { header: 'Loại (single/multiple/essay)', width: 26 },
    { header: 'Điểm (đặt trong cấu hình – chỉ để tham khảo)', width: 22 },
    { header: 'Đáp án tham khảo', width: 50 },
    { header: 'Chủ đề', width: 22 },
    { header: 'Độ khó (dễ/trung bình/khó)', width: 24 },
  ];
  for (const s of SAMPLES) {
    const opts = LETTERS.map((_, i) => s.options[i] || '');
    ws.addRow([s.text, ...opts, s.correct, s.type, '', s.reference, s.topic, s.difficulty]);
  }
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function questionTemplateDocx() {
  const p = (text, opts = {}) => new Paragraph({ children: [new TextRun({ text, ...opts })] });
  const children = [
    new Paragraph({ text: 'Mẫu nhập câu hỏi', heading: HeadingLevel.HEADING_1 }),
    p('Mỗi câu bắt đầu bằng "Câu <số>:". Phương án viết "A.", "B."… (tối đa F). Dòng "Đáp án:" ghi chữ cái đáp án đúng, nhiều đáp án cách nhau dấu phẩy. Dòng "Loại:" là single, multiple hoặc essay. Câu tự luận có thể thêm "Đáp án tham khảo:". Có thể thêm "Chủ đề:" và "Độ khó:" (dễ / trung bình / khó). Điểm từng loại câu đặt trong phần Cấu hình.', { italics: true }),
    p(''),
  ];
  SAMPLES.forEach((s, i) => {
    children.push(p(`Câu ${i + 1}: ${s.text}`, { bold: true }));
    s.options.forEach((o, j) => children.push(p(`${LETTERS[j]}. ${o}`)));
    if (s.correct) children.push(p(`Đáp án: ${s.correct}`));
    children.push(p(`Loại: ${s.type}`));
    if (s.reference) children.push(p(`Đáp án tham khảo: ${s.reference}`));
    children.push(p(`Chủ đề: ${s.topic}`));
    children.push(p(`Độ khó: ${s.difficulty}`));
    children.push(p(''));
  });
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

/** Danh sách email từ Excel: Số thứ tự | Họ và tên | Email công ty */
export async function parseParticipantsXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  const out = [];
  const invalid = [];
  const duplicates = [];
  if (!ws) return { participants: out, invalid: [{ row: 0, value: '', message: 'Tệp không có trang tính' }], duplicates };

  let headerRow = 0;
  const col = { seq: 1, name: 2, email: 3 };
  for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) {
    let found = false;
    ws.getRow(r).eachCell((cell, c) => {
      const h = fold(cellText(cell.value));
      if (h.includes('email')) {
        col.email = c;
        found = true;
      } else if (h.includes('ho va ten') || h === 'ho ten' || h === 'ten') col.name = c;
      else if (h.includes('so thu tu') || h === 'stt') col.seq = c;
    });
    if (found) {
      headerRow = r;
      break;
    }
  }
  const seen = new Set();
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const raw = cellText(row.getCell(col.email).value);
    const name = cellText(row.getCell(col.name).value);
    const seqRaw = cellText(row.getCell(col.seq).value);
    if (!raw && !name) continue;
    const email = normalizeEmail(raw);
    if (!isCompanyEmail(email)) {
      invalid.push({ row: r, value: raw, message: `Email không hợp lệ hoặc không thuộc miền @${EMAIL_DOMAIN}` });
      continue;
    }
    if (seen.has(email)) {
      duplicates.push({ row: r, value: email });
      continue;
    }
    seen.add(email);
    const seq = Number.parseInt(seqRaw, 10);
    out.push({ email, name: name || null, seq: Number.isFinite(seq) ? seq : null });
  }
  // STT trống thì đánh tiếp theo thứ tự dòng
  let next = Math.max(0, ...out.map((p) => p.seq || 0));
  for (const p of out) if (p.seq == null) p.seq = ++next;
  return { participants: out, invalid, duplicates };
}

export async function participantTemplateXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Danh sách');
  ws.columns = [
    { header: 'Số thứ tự', width: 12 },
    { header: 'Họ và tên', width: 32 },
    { header: 'Email công ty', width: 40 },
  ];
  ws.addRow([1, 'Nguyễn Văn A', `nguyenvana@${EMAIL_DOMAIN}`]);
  ws.addRow([2, 'Trần Thị B', `tranthib@${EMAIL_DOMAIN}`]);
  ws.getRow(1).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
