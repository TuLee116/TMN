import { useCallback, useEffect, useState } from 'react';
import { api, download } from '../lib/api.js';
import { STATUS_LABEL, STATUS_TONE } from '../lib/format.js';
import { Badge, Button, Card, inputCls, Loading, Modal, Notice, Spinner } from '../lib/ui.jsx';

export default function ArchiveTab() {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delText, setDelText] = useState('');

  const load = useCallback(async () => {
    const [s, p] = await Promise.all([api('/admin/settings'), api('/admin/participation')]);
    setInfo({ status: s.status, counts: p.counts });
  }, []);
  useEffect(() => {
    load().catch((e) => setMsg({ tone: 'error', text: e.message }));
  }, [load]);

  if (!info) return <Loading />;
  const c = info.counts;
  const unsubmitted = c.in_progress + c.overdue;
  const totalAttempts = c.in_progress + c.overdue + c.submitted + c.auto_submitted;
  const closed = info.status === 'inactive' || info.status === 'ended';

  async function zip() {
    setBusy('zip');
    setMsg(null);
    try {
      const name = await download('/admin/export', 'ho_so_ket_qua.zip');
      setMsg({ tone: 'success', text: `Đã tải ${name}.` });
      return true;
    } catch (e) {
      setMsg({ tone: 'error', text: e.message });
      return false;
    } finally {
      setBusy('');
    }
  }

  async function reconcile() {
    setBusy('reconcile');
    setMsg(null);
    try {
      const r = await api('/admin/reconcile', { method: 'POST' });
      setMsg({ tone: 'success', text: r.finalized ? `Đã chốt ${r.finalized} bài hết hạn.` : 'Không có bài nào quá hạn.' });
      await load();
    } catch (e) {
      setMsg({ tone: 'error', text: e.message });
    } finally {
      setBusy('');
    }
  }

  async function zipAndClear() {
    setConfirmOpen(false);
    if (!(await zip())) return;
    setBusy('clear');
    try {
      const r = await api('/admin/clear-results', { method: 'POST', body: { confirm: true } });
      setMsg({ tone: 'success', text: `Đã tải hồ sơ và xóa ${r.deleted} bài làm. Câu hỏi, cấu hình và danh sách email được giữ nguyên.` });
      await load();
    } catch (e) {
      setMsg({ tone: 'error', text: e.message });
    } finally {
      setBusy('');
    }
  }

  async function clearOnly() {
    setDelOpen(false);
    setDelText('');
    setBusy('delete');
    setMsg(null);
    try {
      const r = await api('/admin/clear-results', { method: 'POST', body: { confirm: true } });
      setMsg({ tone: 'success', text: `Đã xóa ${r.deleted} bài làm (không tải ZIP). Câu hỏi, cấu hình và danh sách email được giữ nguyên.` });
      await load();
    } catch (e) {
      setMsg({ tone: 'error', text: e.message });
    } finally {
      setBusy('');
    }
  }

  const clearBlocked = !!busy || !closed || unsubmitted > 0 || totalAttempts === 0;
  const clearHint = (
    <>
      {!closed && <p className="mb-3 text-xs text-amber-700">Kỳ thi chưa đóng.</p>}
      {closed && unsubmitted > 0 && <p className="mb-3 text-xs text-amber-700">Còn {unsubmitted} bài chưa nộp – hãy chốt bài trước.</p>}
    </>
  );

  return (
    <div className="space-y-6">
      <Card title="Hồ sơ kết quả" actions={<Badge tone={STATUS_TONE[info.status]}>{STATUS_LABEL[info.status]}</Badge>}>
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

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <Card title="Tải ZIP">
          <p className="mb-4 text-sm text-slate-600">
            Gồm tệp Excel tổng hợp (sheet “Hồ sơ phúc khảo” có liên kết tới PDF) và PDF từng bài, đặt tên theo STT + họ tên.
          </p>
          <Button onClick={zip} disabled={!!busy || totalAttempts === 0}>
            {busy === 'zip' && <Spinner />}Tải ZIP
          </Button>
        </Card>
        <Card title="Chốt bài hết hạn">
          <p className="mb-4 text-sm text-slate-600">Tự nộp các bài đã quá thời gian làm nhưng thí sinh chưa nộp (ví dụ do đóng trình duyệt).</p>
          <Button variant="secondary" onClick={reconcile} disabled={!!busy}>
            {busy === 'reconcile' && <Spinner />}Chốt bài hết hạn ({c.overdue})
          </Button>
        </Card>
        <Card title="Tải ZIP và xóa dữ liệu">
          <p className="mb-4 text-sm text-slate-600">
            Chỉ dùng khi kỳ thi đã đóng và không còn bài đang làm. Giữ lại câu hỏi, cấu hình và danh sách email.
          </p>
          {clearHint}
          <Button variant="danger" onClick={() => setConfirmOpen(true)} disabled={clearBlocked}>
            {busy === 'clear' && <Spinner />}Tải ZIP và xóa dữ liệu
          </Button>
        </Card>
        <Card title="Xóa dữ liệu (không tải ZIP)">
          <p className="mb-4 text-sm text-slate-600">
            Xóa ngay toàn bộ bài làm mà <b>không tải hồ sơ</b> – dùng để dọn bài làm thử. Giữ lại câu hỏi, cấu hình và danh sách email.
          </p>
          {clearHint}
          <Button variant="danger" onClick={() => setDelOpen(true)} disabled={clearBlocked}>
            {busy === 'delete' && <Spinner />}Xóa dữ liệu
          </Button>
        </Card>
      </div>

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
          Hãy kiểm tra tệp ZIP đã tải đầy đủ.
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

function Count({ label, value, warn }) {
  return (
    <div className={`rounded-lg px-3 py-2 ${warn ? 'bg-amber-50' : 'bg-slate-50'}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${warn ? 'text-amber-700' : ''}`}>{value}</div>
    </div>
  );
}
