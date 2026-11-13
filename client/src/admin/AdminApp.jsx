import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Button, Field, inputCls, Loading, Logo, Notice, Spinner } from '../lib/ui.jsx';
import SettingsTab from './SettingsTab.jsx';
import ParticipantsTab from './ParticipantsTab.jsx';
import QuestionsTab from './QuestionsTab.jsx';
import GradingTab from './GradingTab.jsx';
import DashboardTab from './DashboardTab.jsx';
import ArchiveTab from './ArchiveTab.jsx';

const TABS = [
  { id: 'settings', label: 'Cấu hình', C: SettingsTab },
  { id: 'participants', label: 'Danh sách email', C: ParticipantsTab },
  { id: 'questions', label: 'Câu hỏi', C: QuestionsTab },
  { id: 'grading', label: 'Chấm tự luận', C: GradingTab },
  { id: 'dashboard', label: 'Quản lý bài làm / Thống kê', C: DashboardTab },
  { id: 'archive', label: 'Hồ sơ kết quả', C: ArchiveTab },
];
const TAB_KEY = 'tmn-admin-tab';

export default function AdminApp() {
  const [me, setMe] = useState(null);
  const [tab, setTab] = useState(() => {
    try {
      return localStorage.getItem(TAB_KEY) || 'settings';
    } catch {
      return 'settings';
    }
  });

  useEffect(() => {
    api('/admin/me')
      .then(setMe)
      .catch(() => setMe({ admin: false }));
    const h = () => setMe((m) => ({ ...(m || {}), admin: false }));
    window.addEventListener('tmn-admin-401', h);
    return () => window.removeEventListener('tmn-admin-401', h);
  }, []);

  useEffect(() => {
    document.title = 'Quản trị – Kiểm tra nội bộ';
  }, []);

  if (!me) return <Loading />;
  if (!me.admin) return <Login onDone={() => setMe({ ...me, admin: true })} />;

  const Current = (TABS.find((t) => t.id === tab) || TABS[0]).C;
  const choose = (id) => {
    setTab(id);
    try {
      localStorage.setItem(TAB_KEY, id);
    } catch {
      /* bỏ qua */
    }
  };

  return (
    <div className="min-h-screen pb-12">
      {me.testMode && (
        <div className="bg-amber-400 px-4 py-1.5 text-center text-xs font-medium text-amber-950">
          Máy chủ đang chạy CHẾ ĐỘ THỬ (TEST_MODE=true)
        </div>
      )}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <Logo className="h-9" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-slate-900">Quản trị kiểm tra nội bộ</div>
            <a href="#/" className="text-xs text-blue-700 hover:underline" target="_blank" rel="noreferrer">
              Mở trang thí sinh ↗
            </a>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await api('/admin/logout', { method: 'POST' }).catch(() => {});
              setMe({ ...me, admin: false });
            }}
          >
            Đăng xuất
          </Button>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => choose(t.id)}
              className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                tab === t.id ? 'border-blue-700 text-blue-700' : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 pt-6">
        <Current />
      </main>
    </div>
  );
}

function Login({ onDone }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form
        className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr('');
          try {
            await api('/admin/login', { method: 'POST', body: { password: pw } });
            onDone();
          } catch (ex) {
            setErr(ex.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="flex justify-center">
          <Logo className="h-12" />
        </div>
        <h1 className="text-center text-lg font-semibold">Đăng nhập quản trị</h1>
        <Field label="Mật khẩu">
          <input className={inputCls} type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        </Field>
        <Notice tone="error">{err}</Notice>
        <Button type="submit" className="w-full" disabled={busy || !pw}>
          {busy && <Spinner />}Đăng nhập
        </Button>
      </form>
    </div>
  );
}
