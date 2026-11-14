import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import CandidateApp from './candidate/CandidateApp.jsx';
import { Loading } from './lib/ui.jsx';

// Phần quản trị tách riêng – thí sinh không phải tải
const AdminApp = lazy(() => import('./admin/AdminApp.jsx'));

function useHashRoute() {
  const read = () => (window.location.hash.replace(/^#/, '') || '/').split('?')[0];
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const h = () => setRoute(read());
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  return route;
}

function App() {
  const route = useHashRoute();
  return route.startsWith('/admin') ? (
    <Suspense fallback={<Loading />}>
      <AdminApp />
    </Suspense>
  ) : (
    <CandidateApp />
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
