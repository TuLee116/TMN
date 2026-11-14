import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fmtDateTime } from '../lib/format.js';
import { Badge, Button, Card, Field, inputCls, Loading, Modal, Notice, Spinner, Table } from '../lib/ui.jsx';

const ROLE = { admin: 'Quản trị', grader: 'Giám khảo' };
const EMPTY = { username: '', name: '', role: 'grader', password: '' };

export default function UsersTab() {
  const [d, setD] = useState(null);
  const [msg, setMsg] = useState(null);
  const [edit, setEdit] = useState(null); // EMPTY khi thêm, user khi sửa

  const load = useCallback(async () => setD(await api('/admin/users')), []);
  useEffect(() => {
    load().catch((e) => setMsg({ tone: 'error', text: e.message }));
  }, [load]);

  async function patch(u, body, text) {
    try {
      await api(`/admin/users/${u.id}`, { method: 'PATCH', body });
      setMsg({ tone: 'success', text });
      await load();
    } catch (e) {
      setMsg({ tone: 'error', text: e.message });
    }
  }

  async function remove(u) {
    if (!confirm(`Xóa tài khoản "${u.username}"?`)) return;
    try {
      await api(`/admin/users/${u.id}`, { method: 'DELETE' });
      setMsg({ tone: 'success', text: `Đã xóa tài khoản ${u.username}.` });
      await load();
    } catch (e) {
      setMsg({ tone: 'error', text: e.message });
    }
  }

  if (!d) return msg ? <Notice tone="error">{msg.text}</Notice> : <Loading />;

  return (
    <div className="space-y-6">
      <Card
        title="Tài khoản"
        actions={
          <Button size="sm" onClick={() => setEdit(EMPTY)}>
            + Thêm tài khoản
          </Button>
        }
      >
        <div className="mb-4 grid gap-3 text-sm md:grid-cols-2">
          <div className="rounded-xl bg-blue-50 px-4 py-3 text-blue-900">
            <b>Quản trị</b>: toàn quyền – cấu hình, câu hỏi, danh sách email, kết quả, tài khoản.
          </div>
          <div className="rounded-xl bg-teal-50 px-4 py-3 text-teal-900">
            <b>Giám khảo</b>: chỉ vào được tab <i>Chấm tự luận</i> để xem bài và chấm điểm.
          </div>
        </div>
        <Notice tone={msg?.tone} className="mb-4" onClose={() => setMsg(null)}>
          {msg?.text}
        </Notice>
        <Table
          rows={[{ id: 0, username: 'admin', name: 'Quản trị chính', role: 'admin', active: true, builtin: true }, ...d.users]}
          columns={[
            {
              key: 'name',
              label: 'Tài khoản',
              render: (u) => (
                <div>
                  <div className="font-semibold text-slate-900">{u.name}</div>
                  <div className="font-mono text-xs text-slate-500">{u.username}</div>
                </div>
              ),
            },
            { key: 'role', label: 'Vai trò', render: (u) => <Badge tone={u.role === 'admin' ? 'blue' : 'green'}>{ROLE[u.role]}</Badge> },
            {
              key: 'active',
              label: 'Trạng thái',
              render: (u) => (u.builtin ? <Badge>Mật khẩu ADMIN_PASSWORD</Badge> : <Badge tone={u.active ? 'green' : 'slate'}>{u.active ? 'Đang dùng' : 'Đã khóa'}</Badge>),
            },
            { key: 'last', label: 'Đăng nhập gần nhất', className: 'whitespace-nowrap text-xs text-slate-500', render: (u) => (u.last_login_at ? fmtDateTime(u.last_login_at) : '—') },
            {
              key: 'act',
              label: '',
              className: 'text-right whitespace-nowrap',
              render: (u) =>
                u.builtin ? (
                  <span className="text-xs text-slate-400">Đổi mật khẩu trong biến môi trường Railway</span>
                ) : (
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="secondary" onClick={() => setEdit(u)}>
                      Sửa
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => patch(u, { active: !u.active }, u.active ? `Đã khóa ${u.username}.` : `Đã mở khóa ${u.username}.`)}
                    >
                      {u.active ? 'Khóa' : 'Mở khóa'}
                    </Button>
                    <Button size="sm" variant="ghost" className="!text-red-600 hover:!bg-red-50" onClick={() => remove(u)}>
                      Xóa
                    </Button>
                  </div>
                ),
            },
          ]}
        />
      </Card>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Sửa tài khoản ${edit.username}` : 'Thêm tài khoản'}>
        {edit && (
          <UserForm
            key={edit.id || 'new'}
            initial={edit}
            onDone={async (text) => {
              setEdit(null);
              setMsg({ tone: 'success', text });
              await load();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function UserForm({ initial, onDone }) {
  const isNew = !initial.id;
  const [f, setF] = useState({ ...EMPTY, ...initial, password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      if (isNew) {
        await api('/admin/users', { method: 'POST', body: f });
        await onDone(`Đã tạo tài khoản ${f.username.trim().toLowerCase()}.`);
      } else {
        await api(`/admin/users/${initial.id}`, { method: 'PATCH', body: { name: f.name, role: f.role, password: f.password } });
        await onDone(`Đã cập nhật ${initial.username}${f.password ? ' (đã đổi mật khẩu)' : ''}.`);
      }
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <Field label="Tên đăng nhập" hint="3–32 ký tự: chữ thường không dấu, số, dấu chấm, gạch dưới, gạch ngang">
        <input className={inputCls} value={f.username} onChange={set('username')} disabled={!isNew} autoComplete="off" />
      </Field>
      <Field label="Họ và tên">
        <input className={inputCls} value={f.name} onChange={set('name')} />
      </Field>
      <Field label="Vai trò">
        <select className={inputCls} value={f.role} onChange={set('role')}>
          <option value="grader">Giám khảo – chỉ chấm tự luận</option>
          <option value="admin">Quản trị – toàn quyền</option>
        </select>
      </Field>
      <Field label={isNew ? 'Mật khẩu' : 'Mật khẩu mới'} hint={isNew ? 'Tối thiểu 8 ký tự' : 'Để trống nếu không đổi. Tối thiểu 8 ký tự.'}>
        <input className={inputCls} type="password" value={f.password} onChange={set('password')} autoComplete="new-password" />
      </Field>
      <Notice tone="error">{err}</Notice>
      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>
          {busy && <Spinner />}
          {isNew ? 'Tạo tài khoản' : 'Lưu'}
        </Button>
      </div>
    </form>
  );
}
