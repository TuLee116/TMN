import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Button, Field, Icon, inputCls, Loading, Logo, LogoChip, Notice, Spinner } from '../lib/ui.jsx';
import SettingsTab from './SettingsTab.jsx';
import ParticipantsTab from './ParticipantsTab.jsx';
import QuestionsTab from './QuestionsTab.jsx';
import GradingTab from './GradingTab.jsx';
import DashboardTab from './DashboardTab.jsx';
import ArchiveTab from './ArchiveTab.jsx';
import OverviewTab from './OverviewTab.jsx';
import LiveTab from './LiveTab.jsx';

const TABS = [
  { id: 'overview', label: 'Tổng quan', icon: 'home', C: OverviewTab, desc: 'Tình hình kỳ thi và việc cần làm' },
  { id: 'live', label: 'Đang thi', icon: 'live', C: LiveTab, desc: 'Theo dõi trực tiếp thí sinh đang làm bài' },
  { id: 'settings', label: 'Cấu hình', icon: 'settings', C: SettingsTab, desc: 'Lịch thi, đề và điểm, nội dung, giám sát' },
  { id: 'participants', label: 'Danh sách email', icon: 'users', C: ParticipantsTab, desc: 'Email được phép thi và theo dõi tham gia' },
  { id: 'questions', label: 'Câu hỏi', icon: 'book', C: QuestionsTab, desc: 'Ngân hàng câu hỏi' },
  { id: 'grading', label: 'Chấm tự luận', icon: 'pen', C: GradingTab, desc: 'Chấm điểm các câu tự luận' },
  { id: 'dashboard', label: 'Bài làm & thống kê', icon: 'chart', C: DashboardTab, desc: 'Kết quả, bộ lọc và biểu đồ' },
  { id: 'archive', label: 'Hồ sơ kết quả', icon: 'archive', C: ArchiveTab, desc: 'Xuất ZIP, chốt bài, dọn dữ liệu' },
];
const TAB_KEY = 'tmn-admin-tab';

function tabFromHash() {
  const m = window.location.hash.match(/^#\/admin\/([a-z]+)/);
  return m && TABS.some((t) => t.id === m[1]) ? m[1] : null;
}

export default function AdminApp() {
  const [me, setMe] = useState(null);
  const [tab, setTab] = useState(() => {
    try {
      return tabFromHash() || localStorage.getItem(TAB_KEY) || 'overview';
    } catch {
      return 'overview';
    }
  });

  useEffect(() => {
    api('/admin/me')
      .then(setMe)
      .catch(() => setMe({ admin: false }));
    const h = () => setMe((m) => ({ ...(m || {}), admin: false }));
    window.addEventListener('tmn-admin-401', h);
    const hc = () => {
      const t = tabFromHash();
      if (t) setTab(t);
    };
    window.addEventListener('hashchange', hc);
    return () => {
      window.removeEventListener('tmn-admin-401', h);
      window.removeEventListener('hashchange', hc);
    };
  }, []);

  useEffect(() => {
    document.title = 'Quản trị – Kiểm tra nội bộ';
  }, []);

  if (!me) return <Loading />;
  if (!me.admin) return <Login onDone={() => setMe({ ...me, admin: true })} />;

  const cur = TABS.find((t) => t.id === tab) || TABS[0];
  const Current = cur.C;
  const choose = (id) => {
    setTab(id);
    try {
      localStorage.setItem(TAB_KEY, id);
      history.replaceState(null, '', `#/admin/${id}`);
    } catch {
      /* bỏ qua */
    }
    window.scrollTo({ top: 0 });
  };
  const logout = async () => {
    await api('/admin/logout', { method: 'POST' }).catch(() => {});
    setMe({ ...me, admin: false });
  };

  return (
    <div className="min-h-screen lg:pl-64">
      {/* Thanh bên – màn hình rộng */}
      <aside className="bg-brand fixed inset-y-0 left-0 z-40 hidden w-64 flex-col text-white shadow-xl lg:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          <LogoChip className="h-9" />
          <div className="text-sm font-bold leading-tight">
            Quản trị
            <br />
            kiểm tra nội bộ
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => choose(t.id)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                tab === t.id ? 'bg-white text-blue-800 shadow-md' : 'text-white/85 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon name={t.icon} />
              {t.label}
            </button>
          ))}
        </nav>
        <div className="space-y-1 border-t border-white/15 px-3 py-3">
          <a
            href="#/"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-white/85 hover:bg-white/10 hover:text-white"
          >
            <Icon name="external" /> Mở trang thí sinh
          </a>
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium text-white/85 hover:bg-white/10 hover:text-white"
          >
            <Icon name="logout" /> Đăng xuất
          </button>
        </div>
      </aside>

      {/* Thanh trên – điện thoại / máy tính bảng */}
      <header className="bg-brand sticky top-0 z-30 text-white shadow-md lg:hidden">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <LogoChip className="h-8" />
          <div className="flex-1 text-sm font-bold">Quản trị kiểm tra</div>
          <a href="#/" target="_blank" rel="noreferrer" className="rounded-lg p-2 hover:bg-white/15" title="Mở trang thí sinh">
            <Icon name="external" />
          </a>
          <button onClick={logout} className="rounded-lg p-2 hover:bg-white/15" title="Đăng xuất">
            <Icon name="logout" />
          </button>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => choose(t.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                tab === t.id ? 'bg-white text-blue-800' : 'text-white/85 hover:bg-white/10'
              }`}
            >
              <Icon name={t.icon} className="h-4 w-4" />
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {me.testMode && (
        <div className="bg-amber-400 px-4 py-1.5 text-center text-xs font-semibold text-amber-950">
          Máy chủ đang chạy CHẾ ĐỘ THỬ (TEST_MODE=true) – tắt trước khi thi chính thức
        </div>
      )}

      <div className="mx-auto max-w-7xl px-4 pb-12 pt-6 sm:px-6">
        <div className="mb-5">
          <h1 className="text-brand w-fit text-2xl font-extrabold">{cur.label}</h1>
          <p className="text-sm text-slate-500">{cur.desc}</p>
        </div>
        <Current goto={choose} />
      </div>
    </div>
  );
}

function Login({ onDone }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="bg-brand flex min-h-screen items-center justify-center p-4">
      <form
        className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-7 shadow-2xl"
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
          <Logo className="h-20" />
        </div>
        <h1 className="text-brand text-center text-xl font-bold">Đăng nhập quản trị</h1>
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
