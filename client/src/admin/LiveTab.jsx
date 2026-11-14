import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fmtClock, fmtDateTime, fmtNum, RESULT_LABEL, RESULT_TONE } from '../lib/format.js';
import { Badge, Button, Card, Check, Icon, Loading, Modal, Notice, Spinner, Table } from '../lib/ui.jsx';
import AttemptDetail from './AttemptDetail.jsx';

const EVENT_LABEL = {
  webcam_warning: 'Cảnh báo webcam',
  webcam_denied: 'Không cho phép camera',
  webcam_error: 'Lỗi camera',
};

export default function LiveTab() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [auto, setAuto] = useState(true);
  const [offset, setOffset] = useState(0);
  const [loadedAt, setLoadedAt] = useState(0);
  const [sel, setSel] = useState(null);
  const [forceSel, setForceSel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    const r = await api('/admin/live');
    setOffset(new Date(r.serverNow).getTime() - Date.now());
    setLoadedAt(Date.now());
    setD(r);
    setErr('');
  }, []);

  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, [load]);
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => load().catch(() => {}), 10_000);
    return () => clearInterval(t);
  }, [auto, load]);
  useEffect(() => {
    const c = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(c);
  }, []);

  if (!d) return err ? <Notice tone="error">{err}</Notice> : <Loading />;
  const now = Date.now() + offset;
  const ago = Math.round((Date.now() - loadedAt) / 1000);

  async function forceSubmit() {
    setBusy(true);
    try {
      await api('/admin/force-submit', { method: 'POST', body: { id: forceSel.id } });
      setForceSel(null);
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white px-5 py-3 shadow-sm ring-1 ring-slate-200/60">
        <span className="relative flex h-3 w-3">
          {auto && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
          <span className={`relative inline-flex h-3 w-3 rounded-full ${auto ? 'bg-emerald-500' : 'bg-slate-300'}`} />
        </span>
        <span className="text-sm font-semibold text-slate-800">{d.live.length} thí sinh đang làm bài</span>
        <span className="text-xs text-slate-500">Cập nhật {ago < 2 ? 'vừa xong' : `${ago} giây trước`}</span>
        <div className="ml-auto flex items-center gap-3">
          <Check label="Tự cập nhật mỗi 10 giây" checked={auto} onChange={setAuto} />
          <Button size="sm" variant="secondary" onClick={() => load().catch((e) => setErr(e.message))}>
            <Icon name="refresh" className="h-4 w-4" /> Làm mới
          </Button>
        </div>
      </div>
      <Notice tone="error" onClose={() => setErr('')}>
        {err}
      </Notice>

      <Card title="Đang làm bài">
        <Table
          rows={d.live}
          empty="Hiện không có ai đang làm bài"
          columns={[
            {
              key: 'name',
              label: 'Thí sinh',
              render: (r) => (
                <div className="min-w-40">
                  <div className="font-semibold text-slate-900">{r.name}</div>
                  <div className="text-xs text-slate-500">{r.email}</div>
                  {(r.projectName || r.level) && <div className="text-xs text-slate-400">{[r.projectName, r.level].filter(Boolean).join(' · ')}</div>}
                </div>
              ),
            },
            {
              key: 'progress',
              label: 'Tiến độ',
              render: (r) => {
                const pct = r.questionCount ? Math.round((r.answered / r.questionCount) * 100) : 0;
                return (
                  <div className="min-w-36">
                    <div className="mb-1 text-xs tabular-nums text-slate-600">
                      {r.answered}/{r.questionCount} câu · {pct}%
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="bg-brand h-full rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              },
            },
            {
              key: 'remain',
              label: 'Còn lại',
              className: 'whitespace-nowrap',
              render: (r) => {
                const ms = new Date(r.deadlineAt).getTime() - now;
                if (ms <= 0) return <Badge tone="red">Quá hạn</Badge>;
                return <span className={`font-mono font-bold tabular-nums ${ms < 5 * 60_000 ? 'text-red-600' : 'text-slate-900'}`}>{fmtClock(ms)}</span>;
              },
            },
            {
              key: 'warn',
              label: 'Giám sát',
              render: (r) => (
                <div className="space-y-1">
                  <div className={`text-xs ${r.webcamWarnings ? 'font-semibold text-red-600' : 'text-slate-500'}`}>{r.webcamWarnings || 0} cảnh báo webcam</div>
                  {r.lastEvent && (
                    <div className="text-xs text-slate-400">
                      Gần nhất: {EVENT_LABEL[r.lastEvent] || r.lastEvent} lúc {fmtDateTime(r.lastEventAt).split(' ')[0]}
                    </div>
                  )}
                  {r.flags.length > 0 && <Badge tone="red">Nghi vấn</Badge>}
                </div>
              ),
            },
            {
              key: 'act',
              label: '',
              className: 'text-right whitespace-nowrap',
              render: (r) => (
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="secondary" onClick={() => setSel(r.id)}>
                    <Icon name="eye" className="h-4 w-4" /> Xem
                  </Button>
                  <Button size="sm" variant="ghost" className="!text-red-600 hover:!bg-red-50" onClick={() => setForceSel(r)}>
                    Thu bài
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </Card>

      <Card
        title={
          <span className="flex items-center gap-2">
            <span className="text-red-600">
              <Icon name="flag" />
            </span>
            Bài nộp có dấu hiệu nghi vấn
          </span>
        }
      >
        <p className="mb-3 text-xs text-slate-500">Bài rời trang làm bài, bị tự nộp do webcam hoặc có từ 3 cảnh báo webcam trở lên.</p>
        <Table
          rows={d.flagged}
          empty="Chưa có bài nghi vấn"
          onRowClick={(r) => setSel(r.id)}
          columns={[
            {
              key: 'name',
              label: 'Thí sinh',
              render: (r) => (
                <div>
                  <div className="font-semibold text-slate-900">{r.name}</div>
                  <div className="text-xs text-slate-500">{r.email}</div>
                </div>
              ),
            },
            { key: 'submittedAt', label: 'Nộp lúc', className: 'whitespace-nowrap', render: (r) => fmtDateTime(r.submittedAt) },
            {
              key: 'flags',
              label: 'Dấu hiệu',
              render: (r) => (
                <div className="flex flex-wrap gap-1">
                  {r.flags.map((f) => (
                    <Badge key={f} tone="red">
                      {f}
                    </Badge>
                  ))}
                </div>
              ),
            },
            { key: 'score', label: 'Điểm /10', className: 'text-right tabular-nums', render: (r) => fmtNum(r.score10) },
            { key: 'result', label: 'Kết quả', render: (r) => r.result && <Badge tone={RESULT_TONE[r.result]}>{RESULT_LABEL[r.result]}</Badge> },
          ]}
        />
      </Card>

      <Modal open={!!sel} onClose={() => setSel(null)} title="Chi tiết bài làm" wide>
        {sel && <AttemptDetail id={sel} />}
      </Modal>

      <Modal
        open={!!forceSel}
        onClose={() => setForceSel(null)}
        title="Thu bài thí sinh?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setForceSel(null)}>
              Hủy
            </Button>
            <Button variant="danger" onClick={forceSubmit} disabled={busy}>
              {busy && <Spinner />}Thu bài ngay
            </Button>
          </>
        }
      >
        {forceSel && (
          <p className="text-sm text-slate-700">
            Bài của <b>{forceSel.name}</b> ({forceSel.email}) sẽ được nộp ngay với các đáp án đã lưu ({forceSel.answered}/{forceSel.questionCount} câu). Thí sinh
            không thể làm tiếp. Lý do ghi nhận: <i>Quản trị thu bài</i>.
          </p>
        )}
      </Modal>
    </div>
  );
}
