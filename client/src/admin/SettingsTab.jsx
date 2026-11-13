import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fmtNum, readFileAsDataUrl, STATUS_LABEL, STATUS_TONE } from '../lib/format.js';
import { Badge, Button, Card, Check, Field, inputCls, Loading, Notice, Spinner, Table } from '../lib/ui.jsx';

export default function SettingsTab() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const d = await api('/admin/settings');
    setData(d);
    setForm(d.settings);
  }, []);
  useEffect(() => {
    load().catch((e) => setMsg({ tone: 'error', text: e.message }));
  }, [load]);

  if (!form) return msg ? <Notice tone="error">{msg.text}</Notice> : <Loading />;

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const num = (k) => (e) => set(k)(e.target.value === '' ? '' : Number(e.target.value));
  const maxScore =
    (Number(form.multipleChoiceCount) || 0) * (Number(form.mcPointsPerQuestion) || 0) +
    (Number(form.essayCount) || 0) * (Number(form.essayPointsPerQuestion) || 0);

  async function save(e) {
    e?.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const d = await api('/admin/settings', { method: 'PUT', body: form });
      setData((x) => ({ ...x, ...d }));
      setForm(d.settings);
      setMsg({ tone: 'success', text: 'Đã lưu cấu hình.' });
    } catch (ex) {
      setMsg({ tone: 'error', text: ex.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={save}>
        <Card
          title="Cấu hình kỳ thi"
          actions={
            <>
              <Badge tone={STATUS_TONE[data.status]}>{STATUS_LABEL[data.status]}</Badge>
              <Button type="submit" disabled={busy}>
                {busy && <Spinner />}Lưu cấu hình
              </Button>
            </>
          }
        >
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Field label="Tiêu đề bài kiểm tra" className="md:col-span-2 lg:col-span-3">
              <input className={inputCls} value={form.title} onChange={(e) => set('title')(e.target.value)} />
            </Field>
            <Field label="Thời gian mở (giờ VN)">
              <input type="datetime-local" className={inputCls} value={form.openingAt || ''} onChange={(e) => set('openingAt')(e.target.value)} />
            </Field>
            <Field label="Thời gian đóng (giờ VN)">
              <input type="datetime-local" className={inputCls} value={form.closingAt || ''} onChange={(e) => set('closingAt')(e.target.value)} />
            </Field>
            <Field label="Thời lượng (phút)">
              <input type="number" min="1" className={inputCls} value={form.durationMinutes} onChange={num('durationMinutes')} />
            </Field>
            <Field label="Số câu trắc nghiệm">
              <input type="number" min="0" className={inputCls} value={form.multipleChoiceCount} onChange={num('multipleChoiceCount')} />
            </Field>
            <Field label="Điểm mỗi câu trắc nghiệm">
              <input type="number" min="0" step="0.01" className={inputCls} value={form.mcPointsPerQuestion} onChange={num('mcPointsPerQuestion')} />
            </Field>
            <Field label="Điểm đạt (thang 10)">
              <input type="number" min="0" max="10" step="0.01" className={inputCls} value={form.passingScore} onChange={num('passingScore')} />
            </Field>
            <Field label="Số câu tự luận">
              <input type="number" min="0" className={inputCls} value={form.essayCount} onChange={num('essayCount')} />
            </Field>
            <Field label="Điểm tối đa mỗi câu tự luận">
              <input type="number" min="0" step="0.01" className={inputCls} value={form.essayPointsPerQuestion} onChange={num('essayPointsPerQuestion')} />
            </Field>
            <Field label="Cách hiển thị câu hỏi">
              <select className={inputCls} value={form.displayMode} onChange={(e) => set('displayMode')(e.target.value)}>
                <option value="paged">Từng câu (Câu trước / Câu sau)</option>
                <option value="all">Tất cả câu trên một trang</option>
              </select>
            </Field>
          </div>
          <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
            Tối đa <b>{fmtNum(maxScore)}</b> điểm cho đề này. Điểm được quy về thang 10 để xét đạt.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <Check label="Mở kỳ thi" hint="Tắt là đóng kỳ thi ngay lập tức" checked={form.active} onChange={set('active')} />
            <Check label="Hiện tổng điểm cho thí sinh" hint="Hiện sau khi chấm xong tự luận" checked={form.showScore} onChange={set('showScore')} />
            <Check label="Xáo trộn thứ tự câu hỏi" checked={form.shuffleQuestions} onChange={set('shuffleQuestions')} />
          </div>
        </Card>

        <Card title="Giám sát webcam" className="mt-6">
          <div className="grid gap-3 md:grid-cols-2">
            <Check
              label="Bật giám sát webcam"
              hint="Phát hiện khuôn mặt chạy trên trình duyệt của thí sinh, không gửi video"
              checked={form.webcamEnabled}
              onChange={set('webcamEnabled')}
            />
            <Check
              label="Bắt buộc có camera"
              hint="Không cho làm bài khi chưa bật camera"
              checked={form.webcamRequired}
              onChange={set('webcamRequired')}
              disabled={!form.webcamEnabled}
            />
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-4">
            <Field label="Giữ lệch liên tục (giây)" hint="Lệch ≥ số giây này mới cảnh báo">
              <input type="number" step="0.5" min="0.5" className={inputCls} value={form.webcamHoldSeconds} onChange={num('webcamHoldSeconds')} disabled={!form.webcamEnabled} />
            </Field>
            <Field label="Ngưỡng quay đầu" hint="Mặc định 0,12 – nhỏ hơn là nhạy hơn">
              <input type="number" step="0.01" min="0.02" className={inputCls} value={form.webcamYawThreshold} onChange={num('webcamYawThreshold')} disabled={!form.webcamEnabled} />
            </Field>
            <Field label="Ngưỡng liếc mắt" hint="Mặc định 0,18">
              <input type="number" step="0.01" min="0.02" className={inputCls} value={form.webcamGazeThreshold} onChange={num('webcamGazeThreshold')} disabled={!form.webcamEnabled} />
            </Field>
            <Field label="Số cảnh báo tối đa" hint="0 = chỉ ghi nhận; vượt ngưỡng sẽ tự nộp bài">
              <input type="number" min="0" className={inputCls} value={form.webcamMaxWarnings} onChange={num('webcamMaxWarnings')} disabled={!form.webcamEnabled} />
            </Field>
          </div>
        </Card>
        <Notice tone={msg?.tone} className="mt-4" onClose={() => setMsg(null)}>
          {msg?.text}
        </Notice>
        <div className="mt-4 flex justify-end">
          <Button type="submit" disabled={busy}>
            {busy && <Spinner />}Lưu cấu hình
          </Button>
        </div>
      </form>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Projects />
        <LogoCard hasLogo={data.hasLogo} onChange={(hasLogo) => setData((d) => ({ ...d, hasLogo }))} />
      </div>
    </div>
  );
}

function Projects() {
  const [rows, setRows] = useState(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const load = useCallback(async () => setRows((await api('/admin/projects')).projects), []);
  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, [load]);

  const run = async (fn) => {
    setErr('');
    try {
      await fn();
      await load();
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <Card title="Danh sách công trình (địa điểm kiểm tra)">
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          run(async () => {
            await api('/admin/projects', { method: 'POST', body: { name } });
            setName('');
          });
        }}
      >
        <input className={inputCls} placeholder="Tên công trình mới" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit">Thêm</Button>
      </form>
      <Notice tone="error" className="mb-3">
        {err}
      </Notice>
      {!rows ? (
        <Loading />
      ) : (
        <Table
          rows={rows}
          empty="Chưa có công trình"
          columns={[
            { key: 'name', label: 'Công trình' },
            { key: 'attempts', label: 'Bài thi', className: 'text-right tabular-nums' },
            {
              key: 'active',
              label: 'Trạng thái',
              render: (r) => <Badge tone={r.active ? 'green' : 'slate'}>{r.active ? 'Đang dùng' : 'Đã ẩn'}</Badge>,
            },
            {
              key: 'act',
              label: '',
              className: 'text-right whitespace-nowrap',
              render: (r) => (
                <div className="flex justify-end gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => run(() => api(`/admin/projects/${r.id}`, { method: 'PATCH', body: { active: !r.active } }))}
                  >
                    {r.active ? 'Ẩn' : 'Kích hoạt'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-600"
                    disabled={r.attempts > 0}
                    title={r.attempts > 0 ? 'Đã có bài thi – chỉ có thể ẩn' : 'Xóa công trình'}
                    onClick={() => confirm(`Xóa công trình "${r.name}"?`) && run(() => api(`/admin/projects/${r.id}`, { method: 'DELETE' }))}
                  >
                    Xóa
                  </Button>
                </div>
              ),
            },
          ]}
        />
      )}
    </Card>
  );
}

function LogoCard({ hasLogo, onChange }) {
  const [ver, setVer] = useState(0);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function upload(file) {
    if (!file) return;
    setErr('');
    if (file.size > 500 * 1024) return setErr('Logo tối đa 500KB.');
    setBusy(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      await api('/admin/logo', { method: 'PUT', body: { dataUrl } });
      onChange(true);
      setVer((v) => v + 1);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Logo">
      <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50">
        <img
          key={ver}
          src={`/api/logo?v=${ver}`}
          alt="Logo"
          className="max-h-24 max-w-full object-contain"
          onError={(e) => (e.currentTarget.style.display = 'none')}
        />
      </div>
      <p className="mt-2 text-xs text-slate-500">PNG/JPEG/WEBP/SVG, tối đa 500KB. Hiển thị trên trang thí sinh và trong PDF (PNG/JPEG).</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800">
          {busy && <Spinner />}Tải logo lên
          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => upload(e.target.files[0])} />
        </label>
        {hasLogo && (
          <Button
            variant="secondary"
            onClick={async () => {
              await api('/admin/logo', { method: 'PUT', body: { dataUrl: '' } });
              onChange(false);
              setVer((v) => v + 1);
            }}
          >
            Gỡ logo
          </Button>
        )}
      </div>
      <Notice tone="error" className="mt-3">
        {err}
      </Notice>
    </Card>
  );
}
