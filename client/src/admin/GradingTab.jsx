import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Badge, Card, FilterTabs, inputCls, Loading } from '../lib/ui.jsx';
import AttemptDetail from './AttemptDetail.jsx';

export default function GradingTab() {
  const [filter, setFilter] = useState('need');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(null);

  const load = useCallback(async () => {
    setData(await api(`/admin/grading?filter=${filter}&q=${encodeURIComponent(q.trim())}`));
  }, [filter, q]);

  useEffect(() => {
    const t = setTimeout(() => load().catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [load]);

  const c = data?.counts || {};
  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      <Card title="Bài cần chấm">
        <FilterTabs
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'need', label: 'Cần chấm', count: c.need },
            { value: 'done', label: 'Đã chấm đủ', count: c.done },
            { value: 'all', label: 'Tất cả', count: c.all },
          ]}
        />
        <input className={`${inputCls} mt-3`} placeholder="Tìm STT, họ tên, email" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="mt-3 max-h-[70vh] space-y-1 overflow-y-auto">
          {!data ? (
            <Loading />
          ) : data.rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">Không có bài nào.</p>
          ) : (
            data.rows.map((r) => (
              <button
                key={r.id}
                onClick={() => setSel(r.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                  sel === r.id ? 'border-blue-600 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">
                    <span className="mr-1 text-slate-400">{r.seq ?? ''}</span>
                    {r.name}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-slate-500">
                    {r.essayGraded}/{r.essayTotal}
                  </span>
                </div>
                <div className="truncate text-xs text-slate-500">{r.email}</div>
                {r.tabViolation && (
                  <Badge tone="red" className="mt-1">
                    Trượt: chuyển tab
                  </Badge>
                )}
              </button>
            ))
          )}
        </div>
      </Card>
      <Card title="Chấm bài">
        {sel ? (
          <AttemptDetail key={sel} id={sel} gradable onSaved={() => load().catch(() => {})} />
        ) : (
          <p className="py-10 text-center text-sm text-slate-500">Chọn một bài ở danh sách bên trái để chấm.</p>
        )}
      </Card>
    </div>
  );
}
