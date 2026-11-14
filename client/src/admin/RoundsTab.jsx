import { useCallback, useEffect, useState } from 'react';
import { api, download } from '../lib/api.js';
import { fmtDateTime, fmtNum, RESULT_LABEL, RESULT_TONE } from '../lib/format.js';
import { Badge, Button, Card, Icon, inputCls, Loading, Modal, Notice, Spinner, Table } from '../lib/ui.jsx';
import AttemptDetail from './AttemptDetail.jsx';

export default function RoundsTab({ goto }) {
  const [rounds, setRounds] = useState(null);
  const [msg, setMsg] = useState(null);
  const [open, setOpen] = useState(null); // id đợt đang xem
  const [del, setDel] = useState(null);
  const [delText, setDelText] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => setRounds((await api('/admin/rounds')).rounds), []);
  useEffect(() => {
    load().catch((e) => setMsg({ tone: 'error', text: e.message }));
  }, [load]);

  async function zip(r) {
    setBusy(`zip${r.id}`);
    try {
      await download(`/admin/rounds/${r.id}/export`, `ho_so_dot_${r.id}.zip`);
    } catch (e) {
      setMsg({ tone: 'error', text: e.message });
    } finally {
      setBusy('');
    }
  }

  async function remove() {
    setBusy('del');
    try {
      await api(`/admin/rounds/${del.id}`, { method: 'DELETE', body: { confirm: true } });
      setMsg({ tone: 'success', text: `Đã xóa đợt "${del.name}".` });
      setDel(null);
      setDelText('');
      await load();
    } catch (e) {
      setMsg({ tone: 'error', text: e.message });
    } finally {
      setBusy('');
    }
  }

  if (!rounds) return msg ? <Notice tone="error">{msg.text}</Notice> : <Loading />;

  return (
    <div className="space-y-6">
      <Notice tone={msg?.tone} onClose={() => setMsg(null)}>
        {msg?.text}
      </Notice>
      {rounds.length === 0 ? (
        <Card>
          <div className="py-8 text-center text-sm text-slate-500">
            Chưa có đợt thi nào được lưu trữ.
            <br />
            Khi một đợt thi kết thúc, vào tab <b>Hồ sơ kết quả</b> → <b>Kết thúc đợt & lưu trữ</b> để lưu kết quả và bắt đầu đợt mới.
            <div className="mt-4">
              <Button variant="secondary" onClick={() => goto('archive')}>
                Đến Hồ sơ kết quả
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rounds.map((r) => {
            const st = r.stats || {};
            return (
              <section key={r.id} className="flex flex-col rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
                <div className="bg-brand h-1.5 rounded-t-2xl" />
                <div className="flex-1 space-y-3 p-5">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Đợt #{r.id}</div>
                    <h3 className="font-bold text-slate-900">{r.name}</h3>
                    <div className="text-xs text-slate-500">
                      {r.opened_at ? fmtDateTime(r.opened_at) : '—'} → lưu {fmtDateTime(r.archived_at)} · bởi {r.archived_by || '—'}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <Mini label="Bài nộp" value={st.submitted ?? 0} />
                    <Mini label="Đạt" value={st.pass ?? 0} cls="text-emerald-700" />
                    <Mini label="Tỷ lệ đạt" value={st.passRate == null ? '—' : `${fmtNum(st.passRate, 1)}%`} />
                    <Mini label="Điểm TB" value={fmtNum(st.avgScore10)} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 border-t border-slate-100 px-5 py-3">
                  <Button size="sm" onClick={() => setOpen(r.id)}>
                    <Icon name="eye" className="h-4 w-4" /> Xem kết quả
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => zip(r)} disabled={!!busy}>
                    {busy === `zip${r.id}` && <Spinner />}Tải ZIP
                  </Button>
                  <Button size="sm" variant="ghost" className="ml-auto !text-red-600 hover:!bg-red-50" onClick={() => setDel(r)}>
                    Xóa
                  </Button>
                </div>
              </section>
            );
          })}
        </div>
      )}

      <Modal open={!!open} onClose={() => setOpen(null)} title="Kết quả đợt thi" wide>
        {open && <RoundDetail id={open} />}
      </Modal>

      <Modal
        open={!!del}
        onClose={() => {
          setDel(null);
          setDelText('');
        }}
        title="Xóa vĩnh viễn đợt thi?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDel(null)}>
              Hủy
            </Button>
            <Button variant="danger" onClick={remove} disabled={busy === 'del' || delText.trim().toUpperCase() !== 'XOA'}>
              {busy === 'del' && <Spinner />}Xóa vĩnh viễn
            </Button>
          </>
        }
      >
        {del && (
          <>
            <p className="text-sm text-slate-700">
              Toàn bộ bài làm, ảnh giám sát của đợt <b>{del.name}</b> sẽ bị xóa và không khôi phục được. Nên <b>tải ZIP</b> trước.
            </p>
            <label className="mt-4 block text-sm text-slate-700">
              Gõ <b>XOA</b> để xác nhận:
              <input className={`${inputCls} mt-1`} value={delText} onChange={(e) => setDelText(e.target.value)} />
            </label>
          </>
        )}
      </Modal>
    </div>
  );
}

function Mini({ label, value, cls = 'text-slate-900' }) {
  return (
    <div className="rounded-lg bg-slate-50 px-1 py-2">
      <div className={`text-base font-extrabold tabular-nums ${cls}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

function RoundDetail({ id }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(null);
  const [kw, setKw] = useState('');
  useEffect(() => {
    api(`/admin/rounds/${id}`)
      .then(setD)
      .catch((e) => setErr(e.message));
  }, [id]);
  if (!d) return err ? <Notice tone="error">{err}</Notice> : <Loading />;
  if (sel)
    return (
      <div>
        <Button size="sm" variant="secondary" className="mb-4" onClick={() => setSel(null)}>
          ← Quay lại danh sách
        </Button>
        <AttemptDetail id={sel} round={id} />
      </div>
    );
  const k = kw.trim().toLowerCase();
  const rows = d.rows.filter((r) => !k || r.name.toLowerCase().includes(k) || r.email.toLowerCase().includes(k));
  return (
    <div className="space-y-4">
      <div>
        <div className="font-bold text-slate-900">{d.round.name}</div>
        <div className="text-xs text-slate-500">
          Tiêu đề: {d.round.title} · {d.round.participants} email được phép · {d.rows.length} bài làm
        </div>
      </div>
      <input className={inputCls} placeholder="Tìm theo tên hoặc email…" value={kw} onChange={(e) => setKw(e.target.value)} />
      <Table
        rows={rows}
        onRowClick={(r) => setSel(r.id)}
        empty="Không có bài làm"
        columns={[
          { key: 'seq', label: 'STT', className: 'tabular-nums text-slate-400' },
          {
            key: 'name',
            label: 'Thí sinh',
            render: (r) => (
              <div>
                <div className="font-semibold">{r.name}</div>
                <div className="text-xs text-slate-500">{r.email}</div>
              </div>
            ),
          },
          { key: 'projectName', label: 'Công trình' },
          { key: 'level', label: 'Cấp bậc' },
          { key: 'score10', label: 'Điểm /10', className: 'text-right tabular-nums', render: (r) => fmtNum(r.score10) },
          { key: 'result', label: 'Kết quả', render: (r) => r.result && <Badge tone={RESULT_TONE[r.result]}>{RESULT_LABEL[r.result]}</Badge> },
          {
            key: 'flags',
            label: '',
            render: (r) => r.flags?.length > 0 && <Badge tone="red">Nghi vấn</Badge>,
          },
        ]}
      />
    </div>
  );
}
