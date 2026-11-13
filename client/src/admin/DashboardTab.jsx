import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fmtDateTime, fmtNum, RESULT_LABEL, RESULT_TONE } from '../lib/format.js';
import { Badge, Button, Card, Field, inputCls, Loading, Modal, Spinner, Stat, Table } from '../lib/ui.jsx';
import AttemptDetail from './AttemptDetail.jsx';

export default function DashboardTab() {
  const [f, setF] = useState({ projectId: '', level: '', min: '', max: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '')).toString();
      setData(await api(`/admin/dashboard${qs ? '?' + qs : ''}`));
    } finally {
      setLoading(false);
    }
  }, [f]);
  useEffect(() => {
    const t = setTimeout(() => load().catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [load]);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  if (!data) return <Loading />;
  const s = data.stats;
  const maxBucket = Math.max(1, ...data.buckets.map((b) => b.count));

  return (
    <div className="space-y-6">
      <Card
        title="Bộ lọc"
        actions={
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            {loading && <Spinner />}Làm mới
          </Button>
        }
      >
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Công trình">
            <select className={inputCls} value={f.projectId} onChange={set('projectId')}>
              <option value="">Tất cả</option>
              {data.filters.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cấp bậc">
            <select className={inputCls} value={f.level} onChange={set('level')}>
              <option value="">Tất cả</option>
              {data.filters.levels.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </Field>
          <Field label="Điểm từ (thang 10)">
            <input type="number" step="0.1" min="0" max="10" className={inputCls} value={f.min} onChange={set('min')} />
          </Field>
          <Field label="Điểm đến (thang 10)">
            <input type="number" step="0.1" min="0" max="10" className={inputCls} value={f.max} onChange={set('max')} />
          </Field>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Đã nộp" value={s.submitted} sub={s.inProgress ? `${s.inProgress} bài chưa nộp` : undefined} />
        <Stat label="Đạt" value={s.pass} tone="green" sub={s.submitted ? `${fmtNum((s.pass / s.submitted) * 100, 1)}%` : undefined} />
        <Stat label="Không đạt" value={s.fail} tone="red" />
        <Stat label="Chờ chấm TL" value={s.pending} tone="amber" />
        <Stat label="Điểm TB (thang 10)" value={fmtNum(s.avgScore10)} tone="blue" />
        <Stat label="Vi phạm / tổng nộp" value={`${s.violations}/${s.submitted}`} sub={`${s.webcamWarnings} cảnh báo webcam`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Phân bố điểm (thang 10)">
          <div className="space-y-2">
            {data.buckets.map((b) => (
              <div key={b.label} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 text-slate-600">{b.label}</span>
                <div className="h-5 flex-1 rounded bg-slate-100">
                  <div className="h-5 rounded bg-blue-600" style={{ width: `${(b.count / maxBucket) * 100}%` }} />
                </div>
                <span className="w-8 text-right tabular-nums">{b.count}</span>
              </div>
            ))}
          </div>
        </Card>
        <RateCard title="Tỷ lệ đạt theo công trình" rows={data.byProject} />
        <RateCard title="Tỷ lệ đạt theo cấp bậc" rows={data.byLevel} />
      </div>

      <Card title={`Danh sách bài làm (${data.rows.length})`}>
        <Table
          rows={data.rows}
          onRowClick={(r) => setSel(r.id)}
          columns={[
            {
              key: 'name',
              label: 'STT / Họ tên',
              render: (r) => (
                <div>
                  <span className="mr-2 tabular-nums text-slate-400">{r.seq ?? '—'}</span>
                  {r.name}
                  <div className="text-xs text-slate-500">{r.email}</div>
                </div>
              ),
            },
            { key: 'projectName', label: 'Công trình' },
            { key: 'level', label: 'Cấp bậc' },
            { key: 'submittedAt', label: 'Nộp', className: 'whitespace-nowrap', render: (r) => (r.submittedAt ? fmtDateTime(r.submittedAt) : <Badge tone="blue">Đang làm</Badge>) },
            { key: 'submitReasonLabel', label: 'Lý do' },
            { key: 'score10', label: 'Thang 10', className: 'text-right tabular-nums', render: (r) => fmtNum(r.score10) },
            {
              key: 'result',
              label: 'Kết quả',
              render: (r) =>
                r.submittedAt ? (
                  <div className="flex flex-col items-start gap-1">
                    <Badge tone={RESULT_TONE[r.result]}>{RESULT_LABEL[r.result]}</Badge>
                    {r.tabViolation && <Badge tone="red">Chuyển tab</Badge>}
                  </div>
                ) : null,
            },
            {
              key: 'webcamWarnings',
              label: 'Webcam',
              className: 'text-right tabular-nums',
              render: (r) => (r.webcamWarnings ? <span className="text-red-600">{r.webcamWarnings}</span> : '0'),
            },
          ]}
        />
      </Card>

      <Modal open={!!sel} onClose={() => setSel(null)} title="Chi tiết bài làm" wide>
        {sel && <AttemptDetail id={sel} />}
      </Modal>
    </div>
  );
}

function RateCard({ title, rows }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Chưa có dữ liệu.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.name} className="text-sm">
              <div className="flex justify-between gap-2">
                <span className="truncate">{r.name}</span>
                <span className="shrink-0 tabular-nums text-slate-600">
                  {r.pass}/{r.pass + r.fail} · <b>{r.passRate == null ? '—' : `${fmtNum(r.passRate, 1)}%`}</b>
                </span>
              </div>
              <div className="mt-1 h-2 rounded bg-slate-100">
                <div className="h-2 rounded bg-emerald-500" style={{ width: `${r.passRate || 0}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
