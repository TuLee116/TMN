import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fmtNum, fmtVnLocal, STATUS_LABEL } from '../lib/format.js';
import { Bold, Button, Check, Field, inputCls, LogoChip, Notice, Paragraphs, ruleLines, Spinner } from '../lib/ui.jsx';

const FORM_KEY = 'tmn-start-form';

export default function Landing({ info, onStarted, onReloadInfo }) {
  const s = info.settings;
  const [form, setForm] = useState(() => {
    try {
      return { name: '', email: '', jobTitle: '', level: '', projectId: '', agree: false, ...JSON.parse(sessionStorage.getItem(FORM_KEY) || '{}'), agree: false };
    } catch {
      return { name: '', email: '', jobTitle: '', level: '', projectId: '', agree: false };
    }
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Cập nhật trạng thái kỳ thi định kỳ để nút bắt đầu tự mở khi đến giờ
  useEffect(() => {
    const t = setInterval(() => onReloadInfo().catch(() => {}), 30_000);
    return () => clearInterval(t);
  }, [onReloadInfo]);

  const set = (k) => (v) =>
    setForm((f) => {
      const next = { ...f, [k]: v };
      try {
        const { agree: _a, ...rest } = next;
        sessionStorage.setItem(FORM_KEY, JSON.stringify(rest));
      } catch {
        /* bỏ qua */
      }
      return next;
    });

  const canStart = info.status === 'open' && info.bankReady;

  async function start(e) {
    e.preventDefault();
    setErr('');
    const email = form.email.trim().toLowerCase();
    if (!form.name.trim()) return setErr('Vui lòng nhập họ và tên.');
    if (!email.endsWith('@' + info.emailDomain)) return setErr(`Email phải có đuôi @${info.emailDomain}.`);
    if (!form.jobTitle.trim()) return setErr('Vui lòng nhập chức danh / vị trí.');
    if (!form.level.trim()) return setErr('Vui lòng nhập cấp bậc.');
    if (info.projects.length && !form.projectId) return setErr('Vui lòng chọn địa điểm kiểm tra.');
    if (!form.agree) return setErr('Bạn cần xác nhận cam kết tuân thủ nội quy.');

    setBusy(true);
    // Phải gọi toàn màn hình ngay trong thao tác bấm
    // (có trình duyệt không bao giờ trả lời yêu cầu toàn màn hình → chờ tối đa 2 giây)
    const fsPromise = document.fullscreenElement
      ? Promise.resolve()
      : Promise.race([
          document.documentElement.requestFullscreen?.().catch(() => {}) ?? Promise.resolve(),
          new Promise((r) => setTimeout(r, 2000)),
        ]);

    let stream = null;
    if (s.webcamEnabled) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
          audio: false,
        });
      } catch {
        if (s.webcamRequired) {
          setBusy(false);
          document.exitFullscreen?.().catch(() => {});
          return setErr('Kỳ thi yêu cầu bật camera. Hãy cho phép trình duyệt truy cập camera (biểu tượng camera trên thanh địa chỉ) rồi bấm lại.');
        }
      }
    }
    await fsPromise;
    try {
      await api('/exam/start', { method: 'POST', body: { ...form, email } });
      await onStarted(stream);
    } catch (ex) {
      stream?.getTracks().forEach((t) => t.stop());
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      setErr(ex.message);
      setBusy(false);
    }
  }

  const rules = ruleLines(s.rules);
  if (s.webcamEnabled)
    rules.push(
      `Kỳ thi có **giám sát bằng camera**${s.webcamRequired ? ' (bắt buộc)' : ''}: giữ khuôn mặt trong khung hình, nhìn vào màn hình, không có người khác ngồi cùng. Hình ảnh được xử lý trên máy của bạn; chỉ ảnh nhỏ tại thời điểm cảnh báo được gửi về hệ thống.`
    );

  const total = s.multipleChoiceCount + s.essayCount;
  const parts = [
    s.multipleChoiceCount > 0 && `${s.multipleChoiceCount} trắc nghiệm × ${fmtNum(s.mcPointsPerQuestion)}đ`,
    s.essayCount > 0 && `${s.essayCount} tự luận × ${fmtNum(s.essayPointsPerQuestion)}đ`,
  ].filter(Boolean);
  const btnLabel =
    info.status === 'open'
      ? 'BẮT ĐẦU KIỂM TRA'
      : info.status === 'upcoming'
        ? 'CHƯA ĐẾN GIỜ KIỂM TRA'
        : info.status === 'ended'
          ? 'KỲ THI ĐÃ KẾT THÚC'
          : 'KỲ THI CHƯA MỞ';

  return (
    <div className="flex min-h-screen flex-col">
      {info.testMode && (
        <div className="bg-amber-400 px-4 py-2 text-center text-sm font-medium text-amber-950">
          CHẾ ĐỘ THỬ – chuyển tab không tự nộp bài, được thoát toàn màn hình. Không dùng cho kỳ thi chính thức.
        </div>
      )}

      {/* Banner */}
      <header className="bg-brand relative overflow-hidden px-4 pb-28 pt-10 text-white">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rotate-45 border-[28px] border-white/10" />
        <div className="pointer-events-none absolute -bottom-36 -left-24 h-80 w-80 rotate-45 border-[20px] border-white/5" />
        <div className="relative mx-auto flex max-w-4xl flex-col items-center gap-3 text-center">
          <LogoChip className="h-16 sm:h-20" />
          {s.organization && (
            <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-white/75 sm:text-xs">{s.organization}</div>
          )}
          <h1 className="text-2xl font-extrabold uppercase leading-tight tracking-wide sm:text-4xl">{s.title}</h1>
          {s.subtitle && <p className="max-w-2xl text-sm text-white/85 sm:text-base">{s.subtitle}</p>}
          <span className="mt-1 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold ring-1 ring-white/30 backdrop-blur">
            <span className={`h-2 w-2 rounded-full ${DOT[info.status] || 'bg-slate-300'}`} />
            {STATUS_LABEL[info.status]}
          </span>
        </div>
      </header>

      <main className="relative mx-auto -mt-20 w-full max-w-6xl flex-1 px-4 pb-12">
        {/* Tổng quan */}
        <section className="overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-200/60">
          <div className="grid grid-cols-2 divide-slate-100 lg:grid-cols-4 lg:divide-x">
            <Stat icon={ICON.clock} label="Thời lượng" value={`${s.durationMinutes} phút`} />
            <Stat icon={ICON.list} label="Số câu hỏi" value={`${total} câu`} sub={parts.join(' · ')} />
            <Stat icon={ICON.target} label="Điều kiện đạt" value={`≥ ${fmtNum(s.passingScore)} / 10`} />
            <Stat icon={ICON.award} label="Điểm tối đa" value={`${fmtNum(s.maxScore)} điểm`} />
          </div>
          <div className="flex flex-col gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-slate-500">Thời gian làm bài:</span>
              <span className="font-semibold text-slate-900">{s.openingAt ? fmtVnLocal(s.openingAt) : 'Chưa đặt'}</span>
              <span className="text-slate-400">→</span>
              <span className="font-semibold text-slate-900">{s.closingAt ? fmtVnLocal(s.closingAt) : 'Chưa đặt'}</span>
            </div>
            <span className="text-xs text-slate-500">Giờ Việt Nam (GMT+7)</span>
          </div>
        </section>

        <div className="mt-6 grid items-start gap-6 lg:grid-cols-5">
          {/* Cột trái: giới thiệu + nội quy */}
          <div className="space-y-6 lg:col-span-3">
            {s.intro && (
              <section className="rounded-2xl bg-white p-6 text-sm leading-relaxed text-slate-700 shadow-sm ring-1 ring-slate-200/60">
                <SectionTitle icon={ICON.info}>Giới thiệu</SectionTitle>
                <Paragraphs text={s.intro} />
              </section>
            )}
            {rules.length > 0 && (
              <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
                <SectionTitle icon={ICON.shield}>Nội quy kiểm tra</SectionTitle>
                <ol className="space-y-3">
                  {rules.map((r, i) => (
                    <li key={i} className="flex gap-3 text-sm leading-relaxed text-slate-700">
                      <span className="bg-brand mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">
                        {i + 1}
                      </span>
                      <span>
                        <Bold text={r} />
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>

          {/* Cột phải: form đăng ký */}
          <form
            onSubmit={start}
            className="space-y-4 rounded-2xl bg-white p-6 shadow-lg ring-1 ring-slate-200/60 lg:sticky lg:top-6 lg:col-span-2"
          >
            <div>
              <SectionTitle icon={ICON.user} className="mb-1">
                Thông tin người kiểm tra
              </SectionTitle>
              <p className="text-xs text-slate-500">Điền đúng thông tin. Mỗi email chỉ được làm bài một lần.</p>
            </div>
            <Field label="Họ và tên">
              <input className={inputCls} value={form.name} onChange={(e) => set('name')(e.target.value)} autoComplete="name" placeholder="Nguyễn Văn A" />
            </Field>
            <Field label="Email công ty" hint={`Đuôi @${info.emailDomain}, có trong danh sách được duyệt`}>
              <input
                className={inputCls}
                type="email"
                value={form.email}
                onChange={(e) => set('email')(e.target.value)}
                placeholder={`ten@${info.emailDomain}`}
                autoComplete="email"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Chức danh / vị trí">
                <input className={inputCls} value={form.jobTitle} onChange={(e) => set('jobTitle')(e.target.value)} />
              </Field>
              <Field label="Cấp bậc">
                <input className={inputCls} value={form.level} onChange={(e) => set('level')(e.target.value)} />
              </Field>
            </div>
            {info.projects.length > 0 && (
              <Field label="Địa điểm kiểm tra">
                <select className={inputCls} value={form.projectId} onChange={(e) => set('projectId')(e.target.value)}>
                  <option value="">— Chọn công trình —</option>
                  {info.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
              <Check checked={form.agree} onChange={set('agree')} label="Tôi đã đọc, hiểu rõ và cam kết tuân thủ toàn bộ nội quy" />
            </div>
            <Notice tone="error">{err}</Notice>
            {info.status === 'open' && !info.bankReady && (
              <Notice tone="warn">Ngân hàng câu hỏi chưa sẵn sàng. Vui lòng liên hệ quản trị viên.</Notice>
            )}
            <Button type="submit" size="lg" className="w-full tracking-wide" disabled={!canStart || busy}>
              {busy && <Spinner />}
              {btnLabel}
            </Button>
            {s.webcamEnabled && (
              <p className="text-center text-xs text-slate-500">Trình duyệt sẽ hỏi quyền dùng camera – hãy chọn “Cho phép”.</p>
            )}
          </form>
        </div>
      </main>

      <footer className="border-t border-slate-200/70 py-4 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} {s.organization || 'Tân Minh Nhân Corporation'}
      </footer>
    </div>
  );
}

const DOT = { open: 'bg-emerald-400', upcoming: 'bg-amber-300', ended: 'bg-red-400', inactive: 'bg-slate-300' };

const ICON = {
  clock: 'M12 6v6l4 2m6-2a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-4a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm0-4a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  award: 'M12 15a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm-3.5-1.1L7 23l5-3 5 3-1.5-9.1',
  info: 'M12 16v-4m0-4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Zm-3-10 2 2 4-4',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m12-14a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
};

function Icon({ d, className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={d} />
    </svg>
  );
}

function Stat({ icon, label, value, sub }) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-100 p-4 sm:p-5 lg:border-b-0">
      <span className="bg-brand flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-sm sm:h-11 sm:w-11">
        <Icon d={icon} />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 sm:text-xs">{label}</div>
        <div className="text-lg font-bold text-slate-900">{value}</div>
        {sub && <div className="text-xs leading-snug text-slate-500">{sub}</div>}
      </div>
    </div>
  );
}

function SectionTitle({ icon, children, className = 'mb-4' }) {
  return (
    <h2 className={`flex items-center gap-2 text-base font-bold text-blue-800 ${className}`}>
      <span className="text-[#0f9d94]">
        <Icon d={icon} />
      </span>
      {children}
    </h2>
  );
}
