import { useCallback, useEffect, useState } from 'react';
import { api, download } from '../lib/api.js';
import { STATUS_LABEL, STATUS_TONE } from '../lib/format.js';
import { Badge, Button, Card, Check, Field, Icon, inputCls, Loading, Modal, Notice, Spinner } from '../lib/ui.jsx';

export default function ArchiveTab({ goto }) {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delText, setDelText] = useState('');
  const [arcOpen, setArcOpen] = useState(false);
  const [arc, setArc] = useState({ name: '', clearParticipants: false });
  const [danger, setDanger] = useState(false);

  const load = useCallback(async () => {
    const [s, p] = await Promise.all([api('/admin/settings'), api('/admin/participation')]);
    setInfo({ status: s.status, counts: p.counts, title: s.settings.title });
  }, []);
  useEffect(() => {
    load().catch((e) => setMsg({ tone: 'error', text: e.message }));
  }, [load]);

  if (!info) return <Loading />;
  const c = info.counts;
  const unsubmitted = c.in_progress + c.overdue;
  const totalAttempts = c.in_progress + c.overdue + c.submitted + c.auto_submitted;
  const closed = info.status === 'inactive' || info.status === 'ended';
  const blocked = !!busy || !closed || unsubmitted > 0 || totalAttempts === 0;
  const hint = (
    <>
      {!closed && <p className="mb-3 text-xs text-amber-700">Kỳ thi chưa đóng – tắt “Mở kỳ thi” ở tab Cấu hình trước.</p>}
      {closed && unsubmitted > 0 && <p className="mb-3 text-xs text-amber-700">Còn {unsubmitted} bài chưa nộp – hãy chốt bài trước.</p>}
      {totalAttempts === 0 && <p className="mb-3 text-xs text-slate-500">Chưa có bài làm.</p>}
    </>
  );

  async function run(key, fn) {
    setBusy(key);
    setMsg(null);
    try {
      return await fn();
    } catch (e) {
      setMsg({ tone: 'error', text: e.message });
      return false;
    } finally {
      setBusy('');
    }
  }

  const zip = () =>
    run('zip', async () => {
      const name = await download('/admin/export', 'ho_so_ket_qua.zip');
      setMsg({ tone: 'success', text: `Đã tải ${name}.` });
      return true;
    });

  const reconcile = () =>
    run('reconcile', async () => {
      const r = await api('/admin/reconcile', { method: 'POST' });
      setMsg({ tone: 'success', text: r.finalized ? `Đã chốt ${r.finalized} bài hết hạn.` : 'Không có bài nào quá hạn.' });
      await load();
    });

  const archive = () =>
    run('archive', async () => {
      setArcOpen(false);
      const r = await api('/admin/rounds/archive', { method: 'POST', body: arc });
      setMsg({ tone: 'success', text: `Đã lưu trữ đợt "${r.name}" (${r.attempts} bài) vào Lịch sử đợt thi. Có thể bắt đầu đợt mới.` });
      setArc({ name: '', clearParticipants: false });
      await load();
    });

  async function zipAndClear() {
    setConfirmOpen(false);
    if (!(await zip())) return;
    await run('clear', async () => {
      const r = await api('/admin/clear-results', { method: 'POST', body: { confirm: true } });
      setMsg({ tone: 'success', text: `Đã tải hồ sơ và xóa ${r.deleted} bài làm.` });
      await load();
    });
  }

  const clearOnly = () =>
    run('delete', async () => {
      setDelOpen(false);
      setDelText('');
      const r = await api('/admin/clear-results', { method: 'POST', body: { confirm: true } });
      setMsg({ tone: 'success', text: `Đã xóa ${r.deleted} bài làm (không tải ZIP).` });
      await load();
    });

  return (
    <div className="space-y-6">
      <Card title="Đợt thi hiện tại" actions={<Badge tone={STATUS_TONE[info.status]}>{STATUS_LABEL[info.status]}</Badge>}>
        <div className="grid gap-3 text-sm sm:grid-cols-4">
          <Count label="Tổng bài làm" value={totalAttempts} />
          <Count label="Đã nộp" value={c.submitted + c.auto_submitted} />
          <Count label="Đang làm" value={c.in_progress} />
          <Count label="Quá hạn · chưa chốt" value={c.overdue} warn={c.overdue > 0} />
        </div>
        <Notice tone={msg?.tone} className="mt-4" onClose={() => setMsg(null)}>
          {msg?.text}
        </Notice>
      </Card>

      <div className="grid gap-6 md:grid-cols-3">
        <Card title="1. Chốt bài hết hạn">
          <p className="mb-4 text-sm text-slate-600">Tự nộp các bài đã quá thời gian làm nhưng thí sinh chưa nộp (ví dụ do đóng trình duyệt).</p>
          <Button variant="secondary" onClick={reconcile} disabled={!!busy}>
            {busy === 'reconcile' && <Spinner />}Chốt bài hết hạn ({c.overdue})
          </Button>
        </Card>
        <Card title="2. Tải ZIP hồ sơ">
          <p className="mb-4 text-sm text-slate-600">Excel tổng hợp (sheet “Hồ sơ phúc khảo” có liên kết PDF) và PDF từng bài, đặt tên theo STT + họ tên.</p>
          <Button variant="secondary" onClick={zip} disabled={!!busy || totalAttempts === 0}>
            {busy === 'zip' && <Spinner />}Tải ZIP
          </Button>
        </Card>
        <section className="rounded-xl border-2 border-teal-300 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-3">
            <h2 className="text-base font-semibold text-slate-800">3. Kết thúc đợt & lưu trữ</h2>
          </div>
          <div className="p-5">
            <p className="mb-4 text-sm text-slate-600">
              Chuyển toàn bộ bài làm sang <b>Lịch sử đợt thi</b> (xem lại, tải ZIP bất cứ lúc nào) và làm trống để tổ chức <b>đợt mới</b>. Câu hỏi,
              cấu hình được giữ.
            </p>
            {hint}
            <Button onClick={() => setArcOpen(true)} disabled={blocked}>
              {busy === 'archive' && <Spinner />}Kết thúc đợt & lưu trữ
            </Button>
          </div>
        </section>
      </div>

      <ResetCard onDone={() => load().catch(() => {})} />

      <EmailCard goto={goto} />

      <section className="rounded-xl border border-red-200 bg-white">
        <button
          type="button"
          onClick={() => setDanger((x) => !x)}
          className="flex w-full items-center gap-2 px-5 py-3 text-left text-sm font-semibold text-red-700"
        >
          <Icon name="alert" className="h-4 w-4" /> Vùng nguy hiểm – xóa bài làm không lưu trữ {danger ? '▲' : '▼'}
        </button>
        {danger && (
          <div className="grid gap-6 border-t border-red-100 p-5 md:grid-cols-2">
            <div>
              <h3 className="mb-1 font-semibold text-slate-800">Tải ZIP rồi xóa</h3>
              <p className="mb-3 text-sm text-slate-600">Tải hồ sơ về máy rồi xóa vĩnh viễn bài làm (không lưu vào Lịch sử).</p>
              {hint}
              <Button variant="danger" onClick={() => setConfirmOpen(true)} disabled={blocked}>
                {busy === 'clear' && <Spinner />}Tải ZIP và xóa dữ liệu
              </Button>
            </div>
            <div>
              <h3 className="mb-1 font-semibold text-slate-800">Xóa dữ liệu (không tải ZIP)</h3>
              <p className="mb-3 text-sm text-slate-600">Dùng để dọn bài làm thử. Không lưu hồ sơ, không khôi phục được.</p>
              {hint}
              <Button variant="danger" onClick={() => setDelOpen(true)} disabled={blocked}>
                {busy === 'delete' && <Spinner />}Xóa dữ liệu
              </Button>
            </div>
          </div>
        )}
      </section>

      <Modal
        open={arcOpen}
        onClose={() => setArcOpen(false)}
        title="Kết thúc đợt thi & lưu trữ"
        footer={
          <>
            <Button variant="secondary" onClick={() => setArcOpen(false)}>
              Hủy
            </Button>
            <Button onClick={archive}>Lưu trữ</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Tên đợt thi" hint="Để trống sẽ dùng tiêu đề kỳ thi + ngày lưu">
            <input className={inputCls} value={arc.name} placeholder={info.title} onChange={(e) => setArc((x) => ({ ...x, name: e.target.value }))} />
          </Field>
          <Check
            label="Xóa danh sách email sau khi lưu"
            hint="Chọn nếu đợt sau dành cho nhóm người khác. Không chọn: giữ danh sách để dùng tiếp."
            checked={arc.clearParticipants}
            onChange={(v) => setArc((x) => ({ ...x, clearParticipants: v }))}
          />
          <p className="text-sm text-slate-600">
            {totalAttempts} bài làm sẽ được chuyển vào <b>Lịch sử đợt thi</b>.
          </p>
        </div>
      </Modal>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Xóa toàn bộ bài làm?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Hủy
            </Button>
            <Button variant="danger" onClick={zipAndClear}>
              Tải ZIP rồi xóa
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          Hệ thống sẽ tải tệp ZIP về máy, sau đó <b>xóa vĩnh viễn {totalAttempts} bài làm</b> cùng ảnh giám sát. Thao tác không thể hoàn tác.
        </p>
      </Modal>

      <Modal
        open={delOpen}
        onClose={() => {
          setDelOpen(false);
          setDelText('');
        }}
        title="Xóa toàn bộ bài làm – không tải ZIP?"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setDelOpen(false);
                setDelText('');
              }}
            >
              Hủy
            </Button>
            <Button variant="danger" onClick={clearOnly} disabled={delText.trim().toUpperCase() !== 'XOA'}>
              Xóa vĩnh viễn
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          Hệ thống sẽ <b>xóa vĩnh viễn {totalAttempts} bài làm</b> cùng ảnh giám sát và <b>không lưu hồ sơ</b>. Thao tác không thể hoàn tác.
        </p>
        <label className="mt-4 block text-sm text-slate-700">
          Gõ <b>XOA</b> để xác nhận:
          <input className={`${inputCls} mt-1`} value={delText} onChange={(e) => setDelText(e.target.value)} autoFocus />
        </label>
      </Modal>
    </div>
  );
}

const ST_TONE = { in_progress: 'blue', overdue: 'amber', submitted: 'green', auto_submitted: 'green' };

function ResetCard({ onDone }) {
  const [rows, setRows] = useState(null);
  const [kw, setKw] = useState('');
  const [sel, setSel] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    const r = await api('/admin/participation');
    setRows(r.rows.filter((x) => x.attempt_id));
  }, []);
  useEffect(() => {
    load().catch((e) => setMsg({ tone: 'error', text: e.message }));
  }, [load]);

  async function reset() {
    setBusy(true);
    try {
      await api('/admin/attempts/reset', { method: 'POST', body: { id: sel.attempt_id, reason } });
      setMsg({ tone: 'success', text: `Đã làm mới lượt thi của ${sel.name || sel.email}. Thí sinh có thể vào làm bài lại (lượt cũ lưu trong Nhật ký).` });
      setSel(null);
      setReason('');
      await load();
      onDone?.();
    } catch (e) {
      setMsg({ tone: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  const k = kw.trim().toLowerCase();
  const shown = (rows || []).filter((r) => !k || String(r.seq ?? '') === k || (r.name || '').toLowerCase().includes(k) || r.email.includes(k));

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Icon name="refresh" /> Cho thi lại (làm mới lượt thi)
        </span>
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        Dùng khi thí sinh gặp sự cố (mất mạng, mất điện, hỏng máy…). Lượt cũ bị xóa để thí sinh làm bài mới với đề mới; điểm, kết quả và đáp án lượt cũ
        được lưu trong <b>Nhật ký</b> kèm lý do.
      </p>
      <input className={`${inputCls} mb-3 max-w-md`} placeholder="Tìm STT, họ tên hoặc email…" value={kw} onChange={(e) => setKw(e.target.value)} />
      <Notice tone={msg?.tone} className="mb-3" onClose={() => setMsg(null)}>
        {msg?.text}
      </Notice>
      {!rows ? (
        <Loading />
      ) : shown.length === 0 ? (
        <div className="rounded-lg bg-slate-50 py-6 text-center text-sm text-slate-500">{rows.length ? 'Không tìm thấy thí sinh.' : 'Chưa có lượt thi nào.'}</div>
      ) : (
        <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg ring-1 ring-slate-200">
          {shown.map((r) => (
            <div key={r.email} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className="w-8 tabular-nums text-slate-400">{r.seq ?? '—'}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-slate-900">{r.name || '(chưa có tên)'}</div>
                <div className="truncate text-xs text-slate-500">{r.email}</div>
              </div>
              <Badge tone={ST_TONE[r.status] || 'slate'}>{r.statusLabel}</Badge>
              <Button size="sm" variant="secondary" onClick={() => setSel(r)}>
                Cho thi lại
              </Button>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={!!sel}
        onClose={() => !busy && setSel(null)}
        title="Cho thí sinh thi lại?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSel(null)} disabled={busy}>
              Hủy
            </Button>
            <Button variant="danger" onClick={reset} disabled={busy || !reason.trim()}>
              {busy && <Spinner />}Làm mới lượt thi
            </Button>
          </>
        }
      >
        {sel && (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              Lượt thi của <b>{sel.name || sel.email}</b> ({sel.email}) – trạng thái <b>{sel.statusLabel}</b> – sẽ bị xóa. Thí sinh vào lại trang thi để làm
              bài mới.
            </p>
            {sel.status === 'in_progress' && (
              <Notice tone="warn">Thí sinh đang làm bài: bài đang làm sẽ bị hủy ngay và phải bắt đầu lại từ đầu.</Notice>
            )}
            <Field label="Lý do (bắt buộc, lưu vào nhật ký)">
              <textarea rows={3} className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: Mất điện tại công trình lúc 9:15" />
            </Field>
          </div>
        )}
      </Modal>
    </Card>
  );
}

function EmailCard({ goto }) {
  const [st, setSt] = useState(null);
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [progress, setProgress] = useState(null);

  const load = useCallback(async () => setSt(await api('/admin/email/status')), []);
  useEffect(() => {
    load().catch((e) => setMsg({ tone: 'error', text: e.message }));
  }, [load]);

  async function test() {
    setBusy('test');
    setMsg(null);
    try {
      await api('/admin/email/test', { method: 'POST', body: { to } });
      setMsg({ tone: 'success', text: `Đã gửi email thử tới ${to}.` });
    } catch (e) {
      setMsg({ tone: 'error', text: e.message });
    } finally {
      setBusy('');
    }
  }

  async function sendAll() {
    if (!confirm(`Gửi email kết quả cho ${st.unsent} thí sinh chưa nhận?`)) return;
    setBusy('send');
    setMsg(null);
    const skip = [];
    const failed = [];
    let sent = 0;
    try {
      for (;;) {
        const r = await api('/admin/email/send', { method: 'POST', body: { skip } });
        sent += r.sent;
        failed.push(...r.failed);
        skip.push(...r.failed.map((f) => f.id));
        setProgress({ sent, failed: failed.length, remaining: r.remaining });
        if (!r.remaining || (!r.sent && !r.failed.length)) break;
      }
      setMsg({
        tone: failed.length ? 'warn' : 'success',
        text: `Đã gửi ${sent} email.${
          failed.length ? ` Lỗi ${failed.length}: ${failed.slice(0, 3).map((f) => `${f.email} (${f.error})`).join('; ')}` : ''
        }`,
      });
    } catch (e) {
      setMsg({ tone: 'error', text: e.message });
    } finally {
      setBusy('');
      setProgress(null);
      await load().catch(() => {});
    }
  }

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Icon name="mail" /> Gửi email kết quả cho thí sinh
        </span>
      }
      actions={
        <Button size="sm" variant="secondary" onClick={() => goto?.('settings')}>
          Sửa mẫu email
        </Button>
      }
    >
      {!st ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          {!st.configured ? (
            <Notice tone="warn">
              Máy chủ chưa cấu hình gửi email. Trên Railway thêm biến <b>RESEND_API_KEY</b> (khuyên dùng – resend.com) và <b>MAIL_FROM</b> (vd:{' '}
              <i>Tân Minh Nhân &lt;thongbao@ten-mien-cong-ty.vn&gt;</i>). Hoặc dùng SMTP: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM (gói Hobby
              của Railway chặn cổng SMTP).
            </Notice>
          ) : (
            <div className="text-sm text-slate-600">
              Đang gửi qua <b>{st.provider}</b> từ <b>{st.from}</b>.
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-4">
            <Count label="Có kết quả" value={st.eligible} />
            <Count label="Đã gửi" value={st.sent} />
            <Count label="Chưa gửi" value={st.unsent} warn={st.unsent > 0} />
            <Count label="Chờ chấm tự luận" value={st.waitingGrade} />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Gửi thử tới" className="min-w-64 flex-1">
              <input className={inputCls} type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="email nhận thử" />
            </Field>
            <Button variant="secondary" onClick={test} disabled={!st.configured || !to || !!busy}>
              {busy === 'test' && <Spinner />}Gửi thử
            </Button>
            <Button onClick={sendAll} disabled={!st.configured || !st.unsent || !!busy}>
              {busy === 'send' && <Spinner />}Gửi cho {st.unsent} thí sinh chưa nhận
            </Button>
          </div>
          {progress && (
            <div className="text-sm text-slate-600">
              Đã gửi {progress.sent}, lỗi {progress.failed}, còn {progress.remaining}…
            </div>
          )}
          <Notice tone={msg?.tone} onClose={() => setMsg(null)}>
            {msg?.text}
          </Notice>
        </div>
      )}
    </Card>
  );
}

function Count({ label, value, warn }) {
  return (
    <div className={`rounded-lg px-3 py-2 ${warn ? 'bg-amber-50' : 'bg-slate-50'}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${warn ? 'text-amber-700' : ''}`}>{value}</div>
    </div>
  );
}
