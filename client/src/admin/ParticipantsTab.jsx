import { useCallback, useEffect, useState } from 'react';
import { api, download } from '../lib/api.js';
import { fmtDateTime } from '../lib/format.js';
import { Badge, Button, Card, FilterTabs, inputCls, Loading, Notice, Spinner, Table } from '../lib/ui.jsx';

const STATUS_TONE = { not_started: 'slate', in_progress: 'blue', overdue: 'amber', submitted: 'green', auto_submitted: 'red' };

export default function ParticipantsTab() {
  const [list, setList] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState('');
  const [text, setText] = useState('');
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(async () => setList(await api('/admin/participants')), []);
  useEffect(() => {
    load().catch((e) => setMsg({ tone: 'error', text: e.message }));
  }, [load]);

  const done = async () => {
    await load();
    setRefresh((r) => r + 1);
  };

  async function importFile(file) {
    if (!file) return;
    if (file.size > 256 * 1024) return setMsg({ tone: 'error', text: 'Tệp vượt quá 256KB.' });
    if (list?.count && !confirm(`Nhập tệp sẽ THAY TOÀN BỘ ${list.count} email hiện có. Tiếp tục?`)) return;
    setBusy('import');
    setMsg(null);
    try {
      const r = await api('/admin/participants/import', { method: 'POST', raw: await file.arrayBuffer() });
      const extra = [];
      if (r.invalid.length) extra.push(`${r.invalid.length} dòng sai email (dòng ${r.invalid.map((x) => x.row).join(', ')})`);
      if (r.duplicates.length) extra.push(`${r.duplicates.length} email trùng bị bỏ qua`);
      setMsg({ tone: extra.length ? 'warn' : 'success', text: `Đã nhập ${r.count} email.${extra.length ? ' ' + extra.join('; ') + '.' : ''}` });
      await done();
    } catch (e) {
      const inv = e.data?.invalid?.length ? ` (${e.data.invalid.length} dòng không hợp lệ)` : '';
      setMsg({ tone: 'error', text: e.message + inv });
    } finally {
      setBusy('');
    }
  }

  async function addPasted() {
    setBusy('paste');
    setMsg(null);
    try {
      const r = await api('/admin/participants', { method: 'POST', body: { text } });
      const parts = [`Đã thêm ${r.added.length} email`];
      if (r.duplicates.length) parts.push(`${r.duplicates.length} trùng: ${r.duplicates.join(', ')}`);
      if (r.invalid.length) parts.push(`${r.invalid.length} sai miền/không hợp lệ: ${r.invalid.join(', ')}`);
      setMsg({ tone: r.duplicates.length || r.invalid.length ? 'warn' : 'success', text: parts.join('. ') + '.' });
      if (r.added.length) setText('');
      await done();
    } catch (e) {
      setMsg({ tone: 'error', text: e.message });
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="space-y-6">
      <Card
        title={`Danh sách email được duyệt${list ? ` (${list.count}/${list.max})` : ''}`}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => download('/admin/participant-template', 'mau_danh_sach_email.xlsx')}>
              Tải mẫu Excel
            </Button>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800">
              {busy === 'import' && <Spinner />}Nhập Excel (thay toàn bộ)
              <input
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => {
                  importFile(e.target.files[0]);
                  e.target.value = '';
                }}
              />
            </label>
            <Button
              variant="danger"
              size="sm"
              disabled={!list?.count}
              onClick={async () => {
                if (!confirm('Xóa toàn bộ danh sách email? (Bài làm đã có không bị ảnh hưởng)')) return;
                await api('/admin/participants', { method: 'DELETE' });
                setMsg({ tone: 'success', text: 'Đã xóa danh sách.' });
                await done();
              }}
            >
              Xóa danh sách
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-slate-600">
          Mẫu Excel gồm các cột <b>Số thứ tự | Họ và tên | Email công ty</b>, tệp tối đa 256KB. Email phải có đuôi{' '}
          <b>@{list?.emailDomain}</b>.
        </p>
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <textarea
            className={`${inputCls} min-h-20`}
            placeholder="Hoặc dán email để bổ sung (mỗi dòng một email, hoặc cách nhau bằng dấu phẩy)"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button onClick={addPasted} disabled={!text.trim() || busy === 'paste'} className="md:self-start">
            {busy === 'paste' && <Spinner />}Bổ sung
          </Button>
        </div>
        <Notice tone={msg?.tone} className="mt-3" onClose={() => setMsg(null)}>
          {msg?.text}
        </Notice>
      </Card>

      <Participation refreshKey={refresh} />
    </div>
  );
}

function Participation({ refreshKey }) {
  const [filter, setFilter] = useState('all');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api(`/admin/participation?filter=${filter}`));
    } finally {
      setLoading(false);
    }
  }, [filter]);
  useEffect(() => {
    load().catch(() => {});
  }, [load, refreshKey]);

  const c = data?.counts || {};
  const term = q.trim().toLowerCase();
  const rows = (data?.rows || []).filter(
    (r) => !term || String(r.seq ?? '') === term || (r.name || '').toLowerCase().includes(term) || r.email.includes(term)
  );

  return (
    <Card
      title="Theo dõi tham gia"
      actions={
        <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
          {loading && <Spinner />}Làm mới
        </Button>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <FilterTabs
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Tất cả', count: c.all },
            { value: 'not_started', label: 'Chưa bắt đầu', count: c.not_started },
            { value: 'in_progress', label: 'Đang làm', count: c.in_progress },
            { value: 'overdue', label: 'Quá hạn · chưa chốt', count: c.overdue },
            { value: 'submitted', label: 'Đã nộp', count: c.submitted },
            { value: 'auto_submitted', label: 'Đã nộp tự động', count: c.auto_submitted },
          ]}
        />
        <input className={`${inputCls} max-w-xs`} placeholder="Tìm STT, họ tên, email" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!data ? (
        <Loading />
      ) : (
        <Table
          rows={rows}
          rowKey={(r) => r.email}
          columns={[
            {
              key: 'name',
              label: 'STT / Họ tên',
              render: (r) => (
                <div>
                  <span className="mr-2 tabular-nums text-slate-400">{r.seq ?? '—'}</span>
                  {r.name || <span className="text-slate-400">(chưa có tên)</span>}
                  {!r.listed && <Badge tone="amber" className="ml-2">Ngoài danh sách</Badge>}
                </div>
              ),
            },
            { key: 'email', label: 'Email' },
            { key: 'status', label: 'Trạng thái', render: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.statusLabel}</Badge> },
            { key: 'started_at', label: 'Bắt đầu', className: 'whitespace-nowrap', render: (r) => fmtDateTime(r.started_at) },
            { key: 'submitted_at', label: 'Nộp', className: 'whitespace-nowrap', render: (r) => fmtDateTime(r.submitted_at) },
            { key: 'reasonLabel', label: 'Lý do' },
          ]}
        />
      )}
    </Card>
  );
}
