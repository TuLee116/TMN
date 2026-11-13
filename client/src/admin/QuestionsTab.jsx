import { useCallback, useEffect, useState } from 'react';
import { api, download } from '../lib/api.js';
import { LETTERS, TYPE_LABEL } from '../lib/format.js';
import { Badge, Button, Card, Field, inputCls, Loading, Notice, Spinner, Table } from '../lib/ui.jsx';

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
            Đã có thí sinh bắt đầu làm bài nên không thể sửa ngân hàng câu hỏi. Muốn đổi đề, hãy tải hồ sơ và xóa dữ liệu bài làm ở tab
            “Hồ sơ kết quả”.
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
          Cột mẫu Excel: Câu hỏi | A | B | C | D | E | F | Đáp án đúng (A,C) | Loại (single/multiple/essay) | Điểm (chỉ tham khảo) | Đáp án
          tham khảo. Điểm từng loại câu đặt trong tab Cấu hình.
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

      <Card title={`Ngân hàng câu hỏi${bank ? ` (${active.length} đang dùng / ${bank.questions.length})` : ''}`}>
        {!bank ? (
          <Loading />
        ) : (
          <QuestionTable
            rows={bank.questions}
            showActive
            locked={locked}
            onToggle={async (q) => {
              try {
                await api(`/admin/questions/${q.id}`, { method: 'PATCH', body: { active: !q.active } });
                await load();
              } catch (e) {
                setMsg({ tone: 'error', text: e.message });
              }
            }}
          />
        )}
      </Card>
    </div>
  );
}

function QuestionTable({ rows, rowLabel, showActive, locked, onToggle }) {
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
    { key: 'correct', label: 'Đáp án', render: (r) => r.correct.join(', ') },
  ];
  if (showActive)
    columns.push({
      key: 'active',
      label: '',
      className: 'text-right',
      render: (r) => (
        <Button size="sm" variant={r.active ? 'secondary' : 'ghost'} disabled={locked} onClick={() => onToggle(r)}>
          {r.active ? 'Đang dùng' : 'Đã ẩn'}
        </Button>
      ),
    });
  return <Table rows={rows} columns={columns} rowKey={(r, i) => r.id ?? `${r.row}-${i}`} empty="Chưa có câu hỏi" />;
}
