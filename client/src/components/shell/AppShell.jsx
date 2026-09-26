import { useEffect, useState, lazy, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import '../../styles/shell.css';

const SettingsModal = lazy(() => import('../SettingsModal'));

function readCollapsed() {
  try { return localStorage.getItem('peblo-sidebar-collapsed') === '1'; } catch { return false; }
}

/** Left sidebar + raised content sheet that every main screen sits in. */
export default function AppShell({ children }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try { localStorage.setItem('peblo-sidebar-collapsed', c ? '0' : '1'); } catch { /* ignore */ }
      return !c;
    });
  };

  // Ctrl/Cmd+J opens the AI Hub from anywhere, except inside an open note,
  // where it toggles that note's Ask AI panel instead.
  useEffect(() => {
    const onKey = (e) => {
      if (/^\/notes\/./.test(pathname)) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        navigate('/ai');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, pathname]);

  // Other parts of the app can open Settings with window.dispatchEvent(new Event('peblo:open-settings')).
  useEffect(() => {
    const open = () => setSettingsOpen(true);
    window.addEventListener('peblo:open-settings', open);
    return () => window.removeEventListener('peblo:open-settings', open);
  }, []);

  return (
    <div className="pb-shell">
      <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} onOpenSettings={() => setSettingsOpen(true)} />
      <main className="pb-sheet">{children}</main>
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
