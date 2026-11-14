import { useCallback, useEffect, useState } from 'react';
import { api, download } from '../lib/api.js';
import { LETTERS, TYPE_LABEL } from '../lib/format.js';
import { Badge, Button, Card, Field, inputCls, Loading, Modal, Notice, Spinner, Table } from '../lib/ui.jsx';

export default function QuestionsTab() {
  const [bank, setBank] = useState(null);
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState('replace');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [inputKey, setInputKey] = useState(0);

  const load = useCallback(async () => setBank(await api('/admin/questions')), []);
  useEffect(() => {
    load().catch((e) => setMsg({ tone: 'error', text: e.message }));
  }, [load]);

  const format = file?.name.toLowerCase().endsWith('.docx') ? 'docx' : 'xlsx';

  async function check() {
    setBusy('check');
    setMsg(null);
    try {
      setPreview(await api(`/admin/import?format=${format}&mode=${mode}&dryRun=1`, { method: 'POST', raw: await file.arrayBuffer() }));
    } catch (e) {
      setPreview(null);
      setMsg({ tone: 'error', text: e.message });
    } finally {
      setBusy('');
    }
  }

  async function saveImport() {
    if (mode === 'replace' && bank?.questions.length && !confirm(`Thay thế toàn bộ ${bank.questions.length} câu hỏi hiện có?`)) return;
    setBusy('save');
    setMsg(null);
    try {
      const r = await api(`/admin/import?format=${format}&mode=${mode}`, { method: 'POST', raw: await file.arrayBuffer() });
      setMsg({ tone: 'success', text: `Đã lưu ${r.saved} câu hỏi. Ngân hàng hiện có ${r.total} câu.` });
      setPreview(null);
      setFile(null);
      setInputKey((k) => k + 1);
      await load();
    } catch (e) {
      setMsg({ tone: 'error', text: e.message });
    } finally {
      setBusy('');
    }
  }

  const locked = bank?.locked;
  const active = bank?.questions.filter((q) => q.active) || [];

  return (
    <div className="space-y-6">
      <Card
        title="Nhập câu hỏi"
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => download('/admin/template?format=xlsx', 'mau_cau_hoi.xlsx')}>
              Tải mẫu Excel
            </Button>
            <Button variant="secondary" size="sm" onClick={() => download('/admin/template?format=docx', 'mau_cau_hoi.docx')}>
              Tải mẫu Word
            </Button>
          </>
        }
      >
        {locked && (
          <Notice tone="warn" className="mb-4">
            Đã có thí sinh làm bài nên không nhập lại / thêm / xóa câu được. Vẫn có thể <b>ẩn – hiện</b> câu (áp dụng cho lượt rút đề sau) và
            <b> sửa đáp án đúng</b> (tự chấm lại). Muốn đổi đề hoàn toàn, hãy dọn dữ liệu bài làm ở tab “Hồ sơ kết quả”.
          </Notice>
        )}
        <div className="grid gap-4 md:grid-cols-[1fr_220px_auto] md:items-end">
          <Field label="Tệp Excel (.xlsx) hoặc Word (.docx)">
            <input
              key={inputKey}
              type="file"
              accept=".xlsx,.docx"
              className={`${inputCls} file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-sm`}
              onChange={(e) => {
                setFile(e.target.files[0] || null);
                setPreview(null);
              }}
            />
          </Field>
          <Field label="Chế độ">
            <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="replace">Thay thế toàn bộ</option>
              <option value="append">Thêm vào</option>
            </select>
          </Field>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={!file || busy} onClick={check}>
              {busy === 'check' && <Spinner />}Kiểm tra tệp
            </Button>
            <Button disabled={!preview?.ok || locked || busy} onClick={saveImport}>
              {busy === 'save' && <Spinner />}Lưu vào hệ thống
            </Button>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Cột mẫu Excel: Câu hỏi | A–F | Đáp án đúng (A,C) | Loại (single/multiple/essay) | Điểm (chỉ tham khảo) | Đáp án tham khảo | Chủ đề |
          Độ khó (dễ/trung bình/khó). Điểm từng loại câu đặt trong tab Cấu hình.
        </p>
        <Notice tone={msg?.tone} className="mt-3" onClose={() => setMsg(null)}>
          {msg?.text}
        </Notice>

        {preview && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <b>Kết quả kiểm tra:</b>
              <Badge tone="blue">{preview.summary.total} câu hợp lệ</Badge>
              <Badge>{preview.summary.single} một đáp án</Badge>
              <Badge>{preview.summary.multiple} nhiều đáp án</Badge>
              <Badge>{preview.summary.essay} tự luận</Badge>
              {preview.errors.length > 0 && <Badge tone="red">{preview.errors.length} lỗi</Badge>}
            </div>
            {preview.errors.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <div className="mb-1 font-semibold">Cần sửa trước khi lưu:</div>
                <ul className="list-disc space-y-0.5 pl-5">
                  {preview.errors.map((e, i) => (
                    <li key={i}>
                      {e.row ? `${format === 'docx' ? 'Câu' : 'Dòng'} ${e.row}: ` : ''}
                      {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <QuestionTable rows={preview.questions} rowLabel={format === 'docx' ? 'Câu' : 'Dòng'} />
          </div>
        )}
      </Card>

      {bank ? <Bank bank={bank} reload={load} setMsg={setMsg} /> : <Loading />}
    </div>
  );
}

const DIFF = { easy: 'Dễ', medium: 'Trung bình', hard: 'Khó' };
const DIFF_TONE = { easy: 'green', medium: 'blue', hard: 'red' };
const EMPTY_Q = { type: 'single', text: '', options: ['', '', '', ''], correct: [], reference: '', topic: '', difficulty: '' };

function rateCell(r) {
  const st = r.stats;
  if (!st || st.rate == null) return <span className="text-slate-400">—</span>;
  const v = st.rate;
  const tone = r.type === 'essay' ? 'text-slate-700' : v < 30 ? 'text-red-600' : v > 90 ? 'text-amber-600' : 'text-emerald-700';
  const note = r.type === 'essay' ? 'điểm TB' : v < 30 ? 'quá khó?' : v > 90 ? 'quá dễ?' : '';
  return (
    <div className="whitespace-nowrap text-right">
      <div className={`font-bold tabular-nums ${tone}`}>{v.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%</div>
      <div className="text-[11px] text-slate-400">
        {st.shown} lượt{note && ` · ${note}`}
      </div>
    </div>
  );
}

function Bank({ bank, reload, setMsg }) {
  const [f, setF] = useState({ q: '', type: '', topic: '', diff: '', state: '' });
  const [edit, setEdit] = useState(null); // câu đang sửa / EMPTY_Q khi thêm
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const all = bank.questions;
  const topics = [...new Set(all.map((x) => x.topic).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
  const kw = f.q.trim().toLowerCase();
  const rows = all.filter(
    (x) =>
      (!kw || x.text.toLowerCase().includes(kw)) &&
      (!f.type || (f.type === 'mc' ? x.type !== 'essay' : x.type === 'essay')) &&
      (!f.topic || (f.topic === '-' ? !x.topic : x.topic === f.topic)) &&
      (!f.diff || (f.diff === '-' ? !x.difficulty : x.difficulty === f.diff)) &&
      (!f.state || (f.state === 'on' ? x.active : !x.active))
  );
  const active = all.filter((x) => x.active);
  const count = (fn) => active.filter(fn).length;

  async function remove(q) {
    if (!confirm(`Xóa vĩnh viễn câu hỏi: "${q.text.slice(0, 80)}"?`)) return;
    try {
      await api(`/admin/questions/${q.id}`, { method: 'DELETE' });
      setMsg({ tone: 'success', text: 'Đã xóa câu hỏi.' });
      await reload();
    } catch (e) {
      setMsg({ tone: 'error', text: e.message });
    }
  }

  async function toggle(q) {
    try {
      await api(`/admin/questions/${q.id}`, { method: 'PATCH', body: { active: !q.active } });
      await reload();
    } catch (e) {
      setMsg({ tone: 'error', text: e.message });
    }
  }

  return (
    <Card
      title={`Ngân hàng câu hỏi (${active.length} đang dùng / ${all.length})`}
      actions={
        <Button size="sm" onClick={() => setEdit(EMPTY_Q)} disabled={bank.locked} title={bank.locked ? 'Đã có bài làm – không thêm câu được' : ''}>
          + Thêm câu hỏi
        </Button>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Chip label="Trắc nghiệm" value={count((x) => x.type !== 'essay')} />
        <Chip label="Tự luận" value={count((x) => x.type === 'essay')} />
        <Chip label="Dễ" value={count((x) => x.difficulty === 'easy')} cls="text-emerald-700" />
        <Chip label="Trung bình" value={count((x) => x.difficulty === 'medium')} cls="text-blue-700" />
        <Chip label="Khó" value={count((x) => x.difficulty === 'hard')} cls="text-red-700" />
        <Chip label="Chưa phân loại" value={count((x) => !x.difficulty)} cls="text-slate-500" />
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <input className={`${inputCls} lg:col-span-1`} placeholder="Tìm nội dung câu hỏi…" value={f.q} onChange={set('q')} />
        <select className={inputCls} value={f.type} onChange={set('type')}>
          <option value="">Mọi loại</option>
          <option value="mc">Trắc nghiệm</option>
          <option value="essay">Tự luận</option>
        </select>
        <select className={inputCls} value={f.topic} onChange={set('topic')}>
          <option value="">Mọi chủ đề</option>
          {topics.map((t) => (
            <option key={t}>{t}</option>
          ))}
          <option value="-">(Chưa có chủ đề)</option>
        </select>
        <select className={inputCls} value={f.diff} onChange={set('diff')}>
          <option value="">Mọi độ khó</option>
          <option value="easy">Dễ</option>
          <option value="medium">Trung bình</option>
          <option value="hard">Khó</option>
          <option value="-">(Chưa phân loại)</option>
        </select>
        <select className={inputCls} value={f.state} onChange={set('state')}>
          <option value="">Đang dùng + đã ẩn</option>
          <option value="on">Đang dùng</option>
          <option value="off">Đã ẩn</option>
        </select>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Hiện {rows.length}/{all.length} câu. Cột <b>Tỷ lệ đúng</b> tính từ các bài đã nộp: dưới 30% có thể quá khó hoặc sai đáp án, trên 90% có thể quá dễ.
      </p>

      <QuestionTable rows={rows} showActive locked={bank.locked} onToggle={toggle} onEdit={setEdit} onDelete={remove} />

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Sửa câu hỏi #${edit.id}` : 'Thêm câu hỏi'} wide>
        {edit && (
          <QuestionEditor
            key={edit.id || 'new'}
            initial={edit}
            locked={bank.locked}
            topics={topics}
            onDone={async (text) => {
              setEdit(null);
              setMsg({ tone: 'success', text });
              await reload();
            }}
          />
        )}
      </Modal>
    </Card>
  );
}

function Chip({ label, value, cls = 'text-slate-900' }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-lg font-extrabold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}

function QuestionEditor({ initial, locked, topics, onDone }) {
  const [q, setQ] = useState(() => ({
    ...EMPTY_Q,
    ...initial,
    options: initial.type === 'essay' ? [] : [...(initial.options || [])],
    correct: [...(initial.correct || [])],
    reference: initial.reference || '',
    topic: initial.topic || '',
    difficulty: initial.difficulty || '',
  }));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const isNew = !initial.id;
  const lockBody = locked && !isNew; // đã có bài làm: khóa nội dung, phương án, loại
  const essay = q.type === 'essay';
  const up = (k) => (v) => setQ((x) => ({ ...x, [k]: v }));

  const setType = (t) =>
    setQ((x) => ({
      ...x,
      type: t,
      options: t === 'essay' ? [] : x.options.length ? x.options : ['', '', '', ''],
      correct: t === 'essay' ? [] : t === 'single' ? x.correct.slice(0, 1) : x.correct,
    }));
  const toggleCorrect = (L) =>
    setQ((x) => ({
      ...x,
      correct: x.type === 'single' ? [L] : x.correct.includes(L) ? x.correct.filter((c) => c !== L) : [...x.correct, L].sort(),
    }));
  const setOpt = (i, v) => setQ((x) => ({ ...x, options: x.options.map((o, j) => (j === i ? v : o)) }));
  const removeOpt = (i) =>
    setQ((x) => {
      const L = LETTERS[i];
      const options = x.options.filter((_, j) => j !== i);
      // dồn lại chữ cái đáp án đúng sau khi xóa phương án
      const correct = x.correct
        .filter((c) => c !== L)
        .map((c) => (LETTERS.indexOf(c) > i ? LETTERS[LETTERS.indexOf(c) - 1] : c));
      return { ...x, options, correct };
    });

  async function save() {
    setBusy(true);
    setErr('');
    try {
      const body = { ...q, difficulty: q.difficulty || '' };
      if (isNew) {
        await api('/admin/questions', { method: 'POST', body });
        await onDone('Đã thêm câu hỏi.');
      } else {
        const r = await api(`/admin/questions/${initial.id}`, { method: 'PUT', body });
        await onDone(r.regraded ? `Đã lưu câu hỏi và chấm lại ${r.regraded} bài đã nộp.` : 'Đã lưu câu hỏi.');
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm('Xóa vĩnh viễn câu hỏi này?')) return;
    setBusy(true);
    try {
      await api(`/admin/questions/${initial.id}`, { method: 'DELETE' });
      await onDone('Đã xóa câu hỏi.');
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {lockBody && (
        <Notice tone="warn">
          Đã có bài làm nên chỉ sửa được <b>đáp án đúng</b>, đáp án tham khảo, chủ đề và độ khó. Sửa đáp án đúng sẽ <b>tự chấm lại</b> các bài đã nộp có
          câu này.
        </Notice>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Loại câu">
          <select className={inputCls} value={q.type} disabled={lockBody} onChange={(e) => setType(e.target.value)}>
            <option value="single">Một đáp án</option>
            <option value="multiple">Nhiều đáp án</option>
            <option value="essay">Tự luận</option>
          </select>
        </Field>
        <Field label="Chủ đề">
          <input className={inputCls} list="topic-list" value={q.topic} onChange={(e) => up('topic')(e.target.value)} placeholder="VD: Đo bóc khối lượng" />
          <datalist id="topic-list">
            {topics.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>
        <Field label="Độ khó">
          <select className={inputCls} value={q.difficulty} onChange={(e) => up('difficulty')(e.target.value)}>
            <option value="">(Chưa phân loại)</option>
            <option value="easy">Dễ</option>
            <option value="medium">Trung bình</option>
            <option value="hard">Khó</option>
          </select>
        </Field>
      </div>
      <Field label="Nội dung câu hỏi">
        <textarea rows={3} className={inputCls} value={q.text} disabled={lockBody} onChange={(e) => up('text')(e.target.value)} />
      </Field>

      {!essay && (
        <div>
          <div className="mb-1 text-sm font-medium text-slate-700">
            Phương án <span className="font-normal text-slate-500">– tích chọn {q.type === 'single' ? 'một' : 'các'} đáp án đúng</span>
          </div>
          <div className="space-y-2">
            {q.options.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <label
                  className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-sm font-bold ring-1 ${
                    q.correct.includes(LETTERS[i]) ? 'bg-emerald-600 text-white ring-emerald-600' : 'bg-white text-slate-600 ring-slate-300'
                  }`}
                  title="Đánh dấu đáp án đúng"
                >
                  <input
                    type={q.type === 'single' ? 'radio' : 'checkbox'}
                    className="hidden"
                    checked={q.correct.includes(LETTERS[i])}
                    onChange={() => toggleCorrect(LETTERS[i])}
                  />
                  {LETTERS[i]}
                </label>
                <input className={inputCls} value={o} disabled={lockBody} onChange={(e) => setOpt(i, e.target.value)} />
                {!lockBody && q.options.length > 2 && (
                  <Button size="sm" variant="ghost" onClick={() => removeOpt(i)} title="Xóa phương án">
                    ✕
                  </Button>
                )}
              </div>
            ))}
          </div>
          {!lockBody && q.options.length < 6 && (
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => setQ((x) => ({ ...x, options: [...x.options, ''] }))}>
              + Thêm phương án
            </Button>
          )}
        </div>
      )}

      <Field label={essay ? 'Đáp án tham khảo (giúp giám khảo chấm)' : 'Giải thích / tham khảo (không bắt buộc)'}>
        <textarea rows={essay ? 4 : 2} className={inputCls} value={q.reference} onChange={(e) => up('reference')(e.target.value)} />
      </Field>

      <Notice tone="error">{err}</Notice>
      <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-4">
        <div>
          {!isNew && !locked && (
            <Button variant="ghost" className="!text-red-600 hover:!bg-red-50" onClick={remove} disabled={busy}>
              Xóa câu hỏi
            </Button>
          )}
        </div>
        <Button onClick={save} disabled={busy}>
          {busy && <Spinner />}
          {isNew ? 'Thêm câu hỏi' : 'Lưu thay đổi'}
        </Button>
      </div>
    </div>
  );
}

function QuestionTable({ rows, rowLabel, showActive, locked, onToggle, onEdit, onDelete }) {
  const columns = [
    { key: 'no', label: rowLabel || '#', className: 'tabular-nums text-slate-400', render: (r, i) => (rowLabel ? r.row : i + 1) },
    { key: 'type', label: 'Loại', className: 'whitespace-nowrap', render: (r) => <Badge tone={r.type === 'essay' ? 'amber' : 'blue'}>{TYPE_LABEL[r.type]}</Badge> },
    {
      key: 'text',
      label: 'Câu hỏi',
      render: (r) => (
        <div className="max-w-xl">
          <div className="whitespace-pre-wrap font-medium">{r.text}</div>
          {r.options.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
              {r.options.map((o, j) => (
                <li key={j} className={r.correct.includes(LETTERS[j]) ? 'font-semibold text-emerald-700' : ''}>
                  {LETTERS[j]}. {o}
                  {r.correct.includes(LETTERS[j]) && ' ✓'}
                </li>
              ))}
            </ul>
          )}
          {r.reference && <div className="mt-1 text-xs italic text-slate-500">Tham khảo: {r.reference}</div>}
        </div>
      ),
    },
    {
      key: 'meta',
      label: 'Chủ đề / độ khó',
      render: (r) => (
        <div className="space-y-1">
          {r.topic && <div className="text-xs font-medium text-slate-700">{r.topic}</div>}
          {r.difficulty ? <Badge tone={DIFF_TONE[r.difficulty]}>{DIFF[r.difficulty]}</Badge> : <span className="text-xs text-slate-400">Chưa phân loại</span>}
        </div>
      ),
    },
  ];
  if (showActive) columns.push({ key: 'rate', label: 'Tỷ lệ đúng', className: 'text-right', render: rateCell });
  if (showActive)
    columns.push({
      key: 'active',
      label: '',
      className: 'text-right',
      render: (r) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="secondary" onClick={() => onEdit(r)}>
            Sửa
          </Button>
          {!locked && (
            <Button size="sm" variant="ghost" className="!text-red-600 hover:!bg-red-50" onClick={() => onDelete(r)}>
              Xóa
            </Button>
          )}
          <Button size="sm" variant={r.active ? 'ghost' : 'ghost'} className={r.active ? '!text-emerald-700' : '!text-slate-400'} onClick={() => onToggle(r)} title="Bấm để ẩn / dùng lại">
            {r.active ? '● Đang dùng' : '○ Đã ẩn'}
          </Button>
        </div>
      ),
    });
  return <Table rows={rows} columns={columns} rowKey={(r, i) => r.id ?? `${r.row}-${i}`} empty="Chưa có câu hỏi" />;
}
