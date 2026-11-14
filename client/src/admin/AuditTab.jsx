import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fmtDateTime } from '../lib/format.js';
import { Badge, Button, Card, Icon, inputCls, Loading, Notice, Spinner, Table } from '../lib/ui.jsx';

const DANGER = new Set(['clear_results', 'round_delete', 'user_delete', 'question_delete', 'participants_delete', 'login_failed', 'force_submit']);
const PAGE = 100;

/** Diễn giải chi tiết nhật ký thành câu ngắn */
function describe(r) {
  const d = r.detail || {};
  switch (r.action) {
    case 'settings_save':
      return `${d.title || ''}${d.active === false ? ' · đã tắt kỳ thi' : d.active ? ' · kỳ thi đang bật' : ''}`;
    case 'grade_essay':
      return `${d.name || ''} (${d.email || ''})`;
    case 'force_submit':
      return `${d.name || ''} (${d.email || ''})`;
    case 'questions_import':
      return `${d.saved} câu · ${d.mode === 'append' ? 'thêm vào' : 'thay thế toàn bộ'}`;
    case 'question_edit':
    case 'question_add':
      return `#${d.id} ${d.text || ''}${d.regraded ? ` · chấm lại ${d.regraded} bài` : ''}`;
    case 'question_toggle':
      return `#${d.id} → ${d.active ? 'dùng' : 'ẩn'}`;
    case 'participants_import':
      return `${d.count} email`;
    case 'round_archive':
      return `${d.name} · ${d.attempts} bài${d.clearParticipants ? ' · đã xóa danh sách email' : ''}`;
    case 'round_export':
    case 'round_delete':
      return d.name || '';
    case 'clear_results':
      return `${d.deleted} bài`;
    case 'user_add':
    case 'user_update':
    case 'user_delete':
      return `${d.username || ''}${d.role ? ` · ${d.role === 'admin' ? 'Quản trị' : 'Giám khảo'}` : ''}${d.active === false ? ' · khóa' : ''}${d.passwordChanged ? ' · đổi mật khẩu' : ''}`;
    case 'email_send':
      return `Gửi ${d.sent}, lỗi ${d.failed}`;
    case 'email_test':
      return d.to || '';
    case 'reconcile':
      return `${d.finalized} bài`;
    case 'login_failed':
      return `Tên đăng nhập: ${d.username || ''}`;
    default:
      return d && Object.keys(d).length ? JSON.stringify(d) : '';
  }
}

export default function AuditTab() {
  const [d, setD] = useState(null);
  const [rows, setRows] = useState([]);
  const [f, setF] = useState({ action: '', actor: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);

  const qs = useCallback(
    (before) => {
      const p = new URLSearchParams({ limit: String(PAGE) });
      if (f.action) p.set('action', f.action);
      if (f.actor) p.set('actor', f.actor);
      if (before) p.set('before', String(before));
      return `/admin/audit?${p}`;
    },
    [f]
  );

  const load = useCallback(async () => {
    const r = await api(qs());
    setD(r);
    setRows(r.rows);
    setMore(r.rows.length === PAGE);
  }, [qs]);

  useEffect(() => {
    load().catch((e) => setErr(e.message));
  }, [load]);

  async function loadMore() {
    setBusy(true);
    try {
      const r = await api(qs(rows[rows.length - 1]?.id));
      setRows((x) => [...x, ...r.rows]);
      setMore(r.rows.length === PAGE);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!d) return err ? <Notice tone="error">{err}</Notice> : <Loading />;

  return (
    <Card
      title="Nhật ký thao tác"
      actions={
        <Button size="sm" variant="secondary" onClick={() => load().catch((e) => setErr(e.message))}>
          <Icon name="refresh" className="h-4 w-4" /> Làm mới
        </Button>
      }
    >
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:w-2/3">
        <select className={inputCls} value={f.action} onChange={(e) => setF((x) => ({ ...x, action: e.target.value }))}>
          <option value="">Mọi thao tác</option>
          {Object.entries(d.actions).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select className={inputCls} value={f.actor} onChange={(e) => setF((x) => ({ ...x, actor: e.target.value }))}>
          <option value="">Mọi người dùng</option>
          {d.actors.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </div>
      <Notice tone="error" className="mb-3">
        {err}
      </Notice>
      <Table
        rows={rows}
        empty="Chưa có nhật ký"
        columns={[
          { key: 'at', label: 'Thời gian', className: 'whitespace-nowrap tabular-nums text-slate-600', render: (r) => fmtDateTime(r.at) },
          {
            key: 'actor',
            label: 'Người thực hiện',
            render: (r) => (
              <div>
                <div className="font-mono text-xs font-semibold text-slate-800">{r.actor || '—'}</div>
                {r.role && <div className="text-[11px] text-slate-400">{r.role === 'admin' ? 'Quản trị' : 'Giám khảo'}</div>}
              </div>
            ),
          },
          { key: 'label', label: 'Thao tác', render: (r) => <Badge tone={DANGER.has(r.action) ? 'red' : 'blue'}>{r.label}</Badge> },
          { key: 'detail', label: 'Chi tiết', render: (r) => <span className="text-xs text-slate-600">{describe(r)}</span> },
          { key: 'ip', label: 'IP', className: 'text-xs text-slate-400', render: (r) => r.ip },
        ]}
      />
      {more && (
        <div className="mt-4 text-center">
          <Button variant="secondary" onClick={loadMore} disabled={busy}>
            {busy && <Spinner />}Xem thêm
          </Button>
        </div>
      )}
    </Card>
  );
}
