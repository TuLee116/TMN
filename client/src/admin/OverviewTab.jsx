import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fmtNum, fmtSpan, fmtVnLocal, STATUS_LABEL, STATUS_TONE, vnLocalToDate } from '../lib/format.js';
import { Badge, Button, Icon, Loading, Notice } from '../lib/ui.jsx';

export default function OverviewTab({ goto }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [offset, setOffset] = useState(0); // lệch giờ máy chủ – máy khách
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    const r = await api('/admin/overview');
    setOffset(new Date(r.serverNow).getTime() - Date.now());
    setD(r);
    setErr('');
  }, []);

  useEffect(() => {
    load().catch((e) => setErr(e.message));
    const t = setInterval(() => load().catch(() => {}), 30_000);
    const c = setInterval(() => tick((x) => x + 1), 1000);
    return () => {
      clearInterval(t);
      clearInterval(c);
    };
  }, [load]);

  if (!d) return err ? <Notice tone="error">{err}</Notice> : <Loading />;

  const now = Date.now() + offset;
  const open = vnLocalToDate(d.openingAt);
  const close = vnLocalToDate(d.closingAt);
  let countdown = null;
  if (d.status === 'upcoming' && open) countdown = { label: 'Mở thi sau', value: fmtSpan(open - now) };
  else if (d.status === 'open' && close) countdown = { label: 'Đóng thi sau', value: fmtSpan(close - now) };
  else if (d.status === 'ended') countdown = { label: 'Kỳ thi', value: 'Đã kết thúc' };
  else countdown = { label: 'Kỳ thi', value: 'Chưa kích hoạt' };

  const c = d.counts;
  const pctStarted = d.participants ? Math.min(100, Math.round((c.started / d.participants) * 100)) : 0;
  const pctSubmitted = d.participants ? Math.min(100, Math.round((c.submitted / d.participants) * 100)) : 0;
  const bankOk = d.bank.mc >= d.bank.needMc && d.bank.essay >= d.bank.needEssay;

  return (
    <div className="space-y-6">
      {/* Băng trạng thái */}
      <section className="bg-brand relative overflow-hidden rounded-2xl p-6 text-white shadow-lg">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rotate-45 border-[22px] border-white/10" />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">Kỳ thi hiện tại</div>
            <h2 className="mt-1 text-xl font-extrabold uppercase sm:text-2xl">{d.title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-white/85">
              <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
              <span>
                {d.openingAt ? fmtVnLocal(d.openingAt) : 'Chưa đặt'} → {d.closingAt ? fmtVnLocal(d.closingAt) : 'Chưa đặt'}
              </span>
              <span className="text-white/60">· {d.durationMinutes} phút/bài</span>
            </div>
          </div>
          <div className="shrink-0 rounded-xl bg-white/15 px-5 py-3 text-center ring-1 ring-white/25 backdrop-blur">
            <div className="text-xs uppercase tracking-wide text-white/75">{countdown.label}</div>
            <div className="text-2xl font-extrabold tabular-nums">{countdown.value}</div>
          </div>
        </div>
      </section>

      {/* Số liệu chính */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi icon="users" label="Được phép thi" value={d.participants} sub={`${c.not_started > 0 ? c.not_started : 0} chưa bắt đầu`} onClick={() => goto('participants')} />
        <Kpi icon="live" label="Đang làm bài" value={c.in_progress} sub={c.overdue ? `${c.overdue} quá hạn chưa chốt` : 'Theo dõi trực tiếp'} tone={c.in_progress ? 'teal' : ''} onClick={() => goto('live')} />
        <Kpi icon="check" label="Đã nộp" value={c.submitted} sub={d.participants ? `${pctSubmitted}% danh sách` : ''} onClick={() => goto('dashboard')} />
        <Kpi
          icon="chart"
          label="Tỷ lệ đạt"
          value={d.passRate == null ? '—' : `${fmtNum(d.passRate, 1)}%`}
          sub={d.results.avgScore10 == null ? 'Chưa có điểm' : `Điểm TB ${fmtNum(d.results.avgScore10)}/10`}
          onClick={() => goto('dashboard')}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Tiến độ & kết quả */}
        <section className="space-y-5 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60 lg:col-span-2">
          <h3 className="font-bold text-slate-800">Tiến độ tham gia</h3>
          <Progress label="Đã vào làm bài" value={c.started} total={d.participants} pct={pctStarted} />
          <Progress label="Đã nộp bài" value={c.submitted} total={d.participants} pct={pctSubmitted} />
          <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-4">
            <Mini label="Đạt" value={d.results.pass} cls="text-emerald-700 bg-emerald-50" />
            <Mini label="Không đạt" value={d.results.fail} cls="text-red-700 bg-red-50" />
            <Mini label="Chờ chấm" value={d.results.pending} cls="text-amber-700 bg-amber-50" onClick={() => goto('grading')} />
            <Mini label="Nghi vấn" value={d.results.flagged} cls="text-red-700 bg-red-50" onClick={() => goto('live')} />
          </div>
        </section>

        {/* Sẵn sàng */}
        <section className="space-y-3 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
          <h3 className="font-bold text-slate-800">Mức sẵn sàng</h3>
          <Ready ok={bankOk} text={`Ngân hàng câu hỏi: ${d.bank.mc}/${d.bank.needMc} TN${d.bank.needEssay ? ` · ${d.bank.essay}/${d.bank.needEssay} TL` : ''}`} onClick={() => goto('questions')} />
          <Ready ok={d.participants > 0} text={`Danh sách email: ${d.participants} người`} onClick={() => goto('participants')} />
          <Ready ok={!!(d.openingAt && d.closingAt)} text="Đã đặt thời gian mở / đóng" onClick={() => goto('settings')} />
          <Ready ok={d.status === 'open' || d.status === 'upcoming'} text="Kỳ thi đã bật" onClick={() => goto('settings')} />
          <Ready ok={!d.testMode} text={d.testMode ? 'Đang ở chế độ thử' : 'Chế độ chính thức'} />
        </section>
      </div>

      {/* Việc cần làm */}
      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-bold text-slate-800">Việc cần làm</h3>
          <Button size="sm" variant="ghost" onClick={() => load().catch((e) => setErr(e.message))}>
            <Icon name="refresh" className="h-4 w-4" /> Làm mới
          </Button>
        </div>
        {d.todo.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            <Icon name="check" /> Mọi thứ đã sẵn sàng, không có việc tồn đọng.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {d.todo.map((t, i) => (
              <li key={i} className="flex items-center gap-3 py-2.5 text-sm">
                <span className={t.tone === 'red' ? 'text-red-600' : 'text-amber-600'}>
                  <Icon name="alert" />
                </span>
                <span className="flex-1 text-slate-700">{t.text}</span>
                {t.tab && (
                  <Button size="sm" variant="secondary" onClick={() => goto(t.tab)}>
                    Xử lý →
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Kpi({ icon, label, value, sub, onClick, tone }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex items-start gap-3 rounded-2xl bg-white p-4 text-left shadow-sm ring-1 transition hover:-translate-y-0.5 hover:shadow-md sm:p-5 ${
        tone === 'teal' ? 'ring-teal-300' : 'ring-slate-200/60'
      }`}
    >
      <span className="bg-brand flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm">
        <Icon name={icon} />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <span className="block text-2xl font-extrabold tabular-nums text-slate-900">{value}</span>
        {sub && <span className="block text-xs text-slate-500">{sub}</span>}
      </span>
    </button>
  );
}

function Progress({ label, value, total, pct }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-slate-600">{label}</span>
        <span className="font-semibold tabular-nums text-slate-900">
          {value}
          {total ? ` / ${total}` : ''} <span className="text-slate-400">({pct}%)</span>
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div className="bg-brand h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Mini({ label, value, cls, onClick }) {
  const C = onClick ? 'button' : 'div';
  return (
    <C type={onClick ? 'button' : undefined} onClick={onClick} className={`rounded-xl px-3 py-2 text-left ${cls} ${onClick ? 'hover:brightness-95' : ''}`}>
      <div className="text-xs opacity-80">{label}</div>
      <div className="text-xl font-extrabold tabular-nums">{value}</div>
    </C>
  );
}

function Ready({ ok, text, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50 disabled:hover:bg-transparent"
    >
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
        <Icon name={ok ? 'check' : 'alert'} className="h-3.5 w-3.5" />
      </span>
      <span className={ok ? 'text-slate-700' : 'font-medium text-red-700'}>{text}</span>
    </button>
  );
}
