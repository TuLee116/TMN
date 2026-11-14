import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fmtNum, readFileAsDataUrl, STATUS_LABEL, STATUS_TONE } from '../lib/format.js';
import { Badge, Button, Card, Check, Field, Icon, inputCls, Loading, Notice, Spinner, Table } from '../lib/ui.jsx';

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

  const dirty = !!(form && data && JSON.stringify(form) !== JSON.stringify(data.settings));
  useEffect(() => {
    if (!dirty) return;
    const h = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

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
        <SectionNav />
        <Card
          title={<Anchor id="lich-thi">Lịch thi</Anchor>}
          actions={<Badge tone={STATUS_TONE[data.status]}>{STATUS_LABEL[data.status]}</Badge>}
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
          </div>
          <div className="mt-4">
            <Check label="Mở kỳ thi" hint="Tắt là đóng kỳ thi ngay lập tức, kể cả khi đang trong khung giờ" checked={form.active} onChange={set('active')} />
          </div>
        </Card>

        <Card title={<Anchor id="de-diem">Đề và điểm</Anchor>} className="mt-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Check label="Hiện tổng điểm cho thí sinh" hint="Hiện sau khi chấm xong tự luận" checked={form.showScore} onChange={set('showScore')} />
            <Check label="Xáo trộn thứ tự câu hỏi" checked={form.shuffleQuestions} onChange={set('shuffleQuestions')} />
          </div>
          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <Check
              label="Rút câu trắc nghiệm theo tỷ lệ độ khó"
              hint="Mỗi thí sinh nhận cùng cơ cấu Dễ / Trung bình / Khó. Thiếu câu ở mức nào sẽ bù bằng câu khác."
              checked={form.mixEnabled}
              onChange={set('mixEnabled')}
            />
            {form.mixEnabled && (
              <div className="mt-3 grid gap-3 sm:grid-cols-4 sm:items-end">
                {[
                  ['mixEasy', 'Dễ (%)'],
                  ['mixMedium', 'Trung bình (%)'],
                  ['mixHard', 'Khó (%)'],
                ].map(([k, l]) => (
                  <Field key={k} label={l}>
                    <input type="number" min="0" max="100" className={inputCls} value={form[k]} onChange={num(k)} />
                  </Field>
                ))}
                {(() => {
                  const sum = (Number(form.mixEasy) || 0) + (Number(form.mixMedium) || 0) + (Number(form.mixHard) || 0);
                  const n = Number(form.multipleChoiceCount) || 0;
                  const e = Math.round((n * (Number(form.mixEasy) || 0)) / 100);
                  const h = Math.round((n * (Number(form.mixHard) || 0)) / 100);
                  return (
                    <div className={`rounded-lg px-3 py-2 text-sm ${sum === 100 ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
                      Tổng {sum}%{sum === 100 ? ` → ${e} dễ · ${Math.max(0, n - e - h)} TB · ${h} khó` : ' (phải bằng 100%)'}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </Card>

        <Card title={<Anchor id="noi-dung">Nội dung hiển thị cho thí sinh</Anchor>} className="mt-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Tên đơn vị" hint="Dòng chữ nhỏ phía trên tiêu đề">
              <input className={inputCls} value={form.organization || ''} onChange={(e) => set('organization')(e.target.value)} />
            </Field>
            <Field label="Mô tả ngắn" hint="Hiện ngay dưới tiêu đề, ví dụ: Kỳ kiểm tra năng lực QS – Quý IV/2026">
              <input className={inputCls} value={form.subtitle || ''} onChange={(e) => set('subtitle')(e.target.value)} />
            </Field>
            <Field label="Giới thiệu / hướng dẫn" hint="Để trống sẽ ẩn mục này. Dòng trống để tách đoạn. Viết **chữ** để in đậm.">
              <textarea rows={6} className={inputCls} value={form.intro || ''} onChange={(e) => set('intro')(e.target.value)} />
            </Field>
            <Field
              label="Nội quy kiểm tra"
              hint="Mỗi dòng là một ý. Viết **chữ** để in đậm. Dòng về giám sát camera được tự thêm khi bật webcam."
            >
              <textarea rows={6} className={inputCls} value={form.rules || ''} onChange={(e) => set('rules')(e.target.value)} />
            </Field>
            <Field label="Lời nhắn sau khi nộp bài" hint="Hiện ở trang kết quả. Để trống sẽ ẩn." className="md:col-span-2">
              <textarea rows={3} className={inputCls} value={form.finishMessage || ''} onChange={(e) => set('finishMessage')(e.target.value)} />
            </Field>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Bấm <b>Lưu cấu hình</b> rồi bấm <b>Xem trang thí sinh</b> để kiểm tra. Nội dung chỉnh được cả khi kỳ thi đang mở.
          </p>
        </Card>

        <Card title={<Anchor id="email">Email kết quả</Anchor>} className="mt-6">
          <EmailTemplate form={form} set={set} />
        </Card>

        <Card title={<Anchor id="giam-sat">Giám sát webcam</Anchor>} className="mt-6">
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
        <div className="sticky bottom-4 z-20 mt-6">
          <div
            className={`flex flex-wrap items-center gap-3 rounded-2xl px-5 py-3 shadow-xl ring-1 transition ${
              dirty ? 'bg-amber-50 ring-amber-300' : 'bg-white/95 ring-slate-200 backdrop-blur'
            }`}
          >
            <span className={`text-sm font-medium ${dirty ? 'text-amber-800' : 'text-slate-500'}`}>
              {dirty ? '● Có thay đổi chưa lưu' : msg?.tone === 'success' ? '✓ ' + msg.text : 'Không có thay đổi'}
            </span>
            {msg?.tone === 'error' && <span className="text-sm font-medium text-red-700">{msg.text}</span>}
            <div className="ml-auto flex flex-wrap gap-2">
              <a
                href="#/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <Icon name="external" className="h-4 w-4" /> Xem trang thí sinh
              </a>
              {dirty && (
                <Button variant="secondary" onClick={() => setForm(data.settings)} disabled={busy}>
                  Hủy thay đổi
                </Button>
              )}
              <Button type="submit" disabled={busy || !dirty}>
                {busy && <Spinner />}Lưu cấu hình
              </Button>
            </div>
          </div>
        </div>
      </form>

      <div id="cong-trinh" className="grid scroll-mt-6 gap-6 lg:grid-cols-[2fr_1fr]">
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
      <p className="mt-2 text-xs text-slate-500">PNG/JPEG/WEBP/SVG, tối đa 500KB. Hiển thị trên trang thí sinh và trong PDF (PNG/JPEG). Chưa tải lên thì dùng logo Tân Minh Nhân mặc định.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 bg-brand rounded-lg px-4 py-2 text-sm font-medium text-white hover:brightness-110">
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
            Về logo mặc định
          </Button>
        )}
      </div>
      <Notice tone="error" className="mt-3">
        {err}
      </Notice>
    </Card>
  );
}

const SECTIONS = [
  ['lich-thi', 'Lịch thi'],
  ['de-diem', 'Đề và điểm'],
  ['noi-dung', 'Nội dung'],
  ['email', 'Email kết quả'],
  ['giam-sat', 'Giám sát webcam'],
  ['cong-trinh', 'Công trình & logo'],
];

function SectionNav() {
  return (
    <nav className="sticky top-0 z-20 -mx-2 mb-4 flex gap-2 overflow-x-auto rounded-2xl bg-slate-100/85 px-2 py-2 backdrop-blur lg:top-2">
      {SECTIONS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="shrink-0 rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-blue-800 shadow-sm ring-1 ring-slate-200 hover:ring-blue-300"
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

function Anchor({ id, children }) {
  return (
    <span id={id} className="scroll-mt-24">
      {children}
    </span>
  );
}

const VARS = [
  ['{ho_ten}', 'Họ tên'],
  ['{ky_thi}', 'Tiêu đề kỳ thi'],
  ['{ket_qua}', 'ĐẠT / KHÔNG ĐẠT'],
  ['{thang_10}', 'Điểm thang 10'],
  ['{tong_diem}', 'Tổng điểm'],
  ['{diem_toi_da}', 'Điểm tối đa'],
  ['{ngay_nop}', 'Thời gian nộp'],
  ['{don_vi}', 'Tên đơn vị'],
  ['{email}', 'Email'],
];

function EmailTemplate({ form, set }) {
  const [pv, setPv] = useState(null);
  const [err, setErr] = useState('');
  async function preview() {
    setErr('');
    try {
      setPv(await api('/admin/email/preview', { method: 'POST', body: { subject: form.emailSubject, body: form.emailBody } }));
    } catch (e) {
      setErr(e.message);
    }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <div className="space-y-4">
        <Field label="Tiêu đề email">
          <input className={inputCls} value={form.emailSubject || ''} onChange={(e) => set('emailSubject')(e.target.value)} />
        </Field>
        <Field label="Nội dung email">
          <textarea rows={9} className={inputCls} value={form.emailBody || ''} onChange={(e) => set('emailBody')(e.target.value)} />
        </Field>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={preview}>
            Xem trước
          </Button>
          <span className="text-xs text-slate-500">Gửi email ở tab Hồ sơ kết quả. Chỉ gửi bài đã có kết quả (đã chấm xong tự luận).</span>
        </div>
        <Notice tone="error">{err}</Notice>
        {pv && (
          <div className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-2 text-sm">
              <span className="text-slate-500">Tiêu đề:</span> <b>{pv.subject}</b>
              {pv.sample && <span className="ml-2 text-xs text-slate-400">(dữ liệu mẫu)</span>}
            </div>
            <pre className="whitespace-pre-wrap px-4 py-3 font-sans text-sm text-slate-800">{pv.body}</pre>
          </div>
        )}
      </div>
      <div className="rounded-xl bg-slate-50 p-4 text-sm">
        <div className="mb-2 font-semibold text-slate-700">Trường tự điền</div>
        <ul className="space-y-1">
          {VARS.map(([k, l]) => (
            <li key={k} className="flex justify-between gap-2">
              <code className="rounded bg-white px-1.5 text-xs text-blue-800 ring-1 ring-slate-200">{k}</code>
              <span className="text-xs text-slate-500">{l}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
