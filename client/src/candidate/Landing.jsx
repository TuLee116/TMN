import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fmtNum, fmtVnLocal, STATUS_LABEL, STATUS_TONE } from '../lib/format.js';
import { Badge, Button, Check, Field, inputCls, Logo, Notice, Spinner } from '../lib/ui.jsx';

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

  return (
    <div className="min-h-screen pb-12">
      {info.testMode && (
        <div className="bg-amber-400 px-4 py-2 text-center text-sm font-medium text-amber-950">
          CHẾ ĐỘ THỬ – chuyển tab không tự nộp bài, được thoát toàn màn hình. Không dùng cho kỳ thi chính thức.
        </div>
      )}
      <div className="mx-auto max-w-3xl px-4 pt-8">
        <header className="flex flex-col items-center gap-3 text-center">
          <Logo className="h-16" />
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">{s.title}</h1>
          <Badge tone={STATUS_TONE[info.status]}>{STATUS_LABEL[info.status]}</Badge>
        </header>

        <section className="mt-6 grid gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2">
          <InfoRow label="Thời gian mở" value={s.openingAt ? fmtVnLocal(s.openingAt) : 'Chưa đặt'} />
          <InfoRow label="Thời gian đóng" value={s.closingAt ? fmtVnLocal(s.closingAt) : 'Chưa đặt'} />
          <InfoRow label="Số câu" value={`${s.multipleChoiceCount + s.essayCount} câu`} />
          <InfoRow label="Thời lượng" value={`${s.durationMinutes} phút`} />
          {s.multipleChoiceCount > 0 && (
            <InfoRow label="Trắc nghiệm" value={`${s.multipleChoiceCount} câu × ${fmtNum(s.mcPointsPerQuestion)} điểm`} />
          )}
          {s.essayCount > 0 && <InfoRow label="Tự luận" value={`${s.essayCount} câu × ${fmtNum(s.essayPointsPerQuestion)} điểm`} />}
          <InfoRow label="Điểm tối đa" value={`${fmtNum(s.maxScore)} điểm`} />
          <InfoRow label="Điều kiện đạt" value={`Đạt từ ${fmtNum(s.passingScore)} / 10`} />
          <p className="text-xs text-slate-500 sm:col-span-2">Thời gian theo giờ Việt Nam (GMT+7).</p>
        </section>

        <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
          <h2 className="mb-2 font-semibold">Nội quy kiểm tra</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Bài kiểm tra tự bật chế độ toàn màn hình khi bắt đầu và phải giữ toàn màn hình trong suốt thời gian làm bài.</li>
            <li>
              <b>Không chuyển tab, chuyển cửa sổ hay thu nhỏ trình duyệt.</b> Nếu trang bị ẩn, hệ thống sẽ <b>tự động nộp bài</b> và
              bài bị tính <b>không đạt</b>.
            </li>
            <li>Mỗi email chỉ được làm một lần. Nếu lỡ tải lại trang, bạn tiếp tục lượt đang làm trên cùng trình duyệt.</li>
            <li>Hết giờ hệ thống tự nộp bài. Đáp án được lưu tự động trong khi làm.</li>
            {s.webcamEnabled && (
              <li>
                Kỳ thi có <b>giám sát bằng camera</b>{s.webcamRequired ? ' (bắt buộc)' : ''}: giữ khuôn mặt trong khung hình, nhìn vào màn
                hình, không có người khác ngồi cùng. Hình ảnh được xử lý trên máy của bạn; chỉ ảnh nhỏ tại thời điểm cảnh báo được gửi
                về hệ thống.
              </li>
            )}
          </ul>
        </section>

        <form onSubmit={start} className="mt-4 space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold">Thông tin người kiểm tra</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Họ và tên">
              <input className={inputCls} value={form.name} onChange={(e) => set('name')(e.target.value)} autoComplete="name" />
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
            <Field label="Chức danh / vị trí">
              <input className={inputCls} value={form.jobTitle} onChange={(e) => set('jobTitle')(e.target.value)} />
            </Field>
            <Field label="Cấp bậc">
              <input className={inputCls} value={form.level} onChange={(e) => set('level')(e.target.value)} />
            </Field>
            {info.projects.length > 0 && (
              <Field label="Địa điểm kiểm tra" className="sm:col-span-2">
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
          </div>
          <Check
            checked={form.agree}
            onChange={set('agree')}
            label="Tôi đã đọc, hiểu rõ và cam kết tuân thủ toàn bộ nội quy"
          />
          <Notice tone="error">{err}</Notice>
          {info.status === 'open' && !info.bankReady && (
            <Notice tone="warn">Ngân hàng câu hỏi chưa sẵn sàng. Vui lòng liên hệ quản trị viên.</Notice>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={!canStart || busy}>
            {busy && <Spinner />}
            {info.status === 'open'
              ? 'BẮT ĐẦU KIỂM TRA'
              : info.status === 'upcoming'
                ? 'CHƯA ĐẾN GIỜ KIỂM TRA'
                : info.status === 'ended'
                  ? 'KỲ THI ĐÃ KẾT THÚC'
                  : 'KỲ THI CHƯA MỞ'}
          </Button>
        </form>
      </div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 pb-2 text-sm sm:block sm:border-0 sm:pb-0">
      <div className="text-slate-500">{label}</div>
      <div className="font-medium text-slate-900">{value}</div>
    </div>
  );
}
