import { useEffect, useState, lazy, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import ConsoleShell from './ConsoleShell';
import SoftShell from '../../soft/SoftShell';
import RiverShell from '../../river/RiverShell';
import OrbitShell from '../../orbit/OrbitShell';
import { useAuth } from '../../context/AuthContext';
import '../../styles/shell.css';
import '../../styles/shell-styles.css';

const SettingsModal = lazy(() => import('../SettingsModal'));

function readCollapsed() {
  try { return localStorage.getItem('peblo-sidebar-collapsed') === '1'; } catch { return false; }
}

/** Left sidebar + raised content sheet that every main screen sits in. */
export default function AppShell({ children }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { uiStyle } = useAuth();
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

  const openSettings = () => setSettingsOpen(true);
  const settings = settingsOpen && (
    <Suspense fallback={null}>
      <SettingsModal onClose={() => setSettingsOpen(false)} />
    </Suspense>
  );

  if (uiStyle === 'console') {
    return <><ConsoleShell onOpenSettings={openSettings}>{children}</ConsoleShell>{settings}</>;
  }
  if (uiStyle === 'soft') {
    return <><SoftShell onOpenSettings={openSettings}>{children}</SoftShell>{settings}</>;
  }
  if (uiStyle === 'river') {
    return <><RiverShell>{children}</RiverShell>{settings}</>;
  }
  if (uiStyle === 'orbit') {
    return <><OrbitShell>{children}</OrbitShell>{settings}</>;
  }
  return (
    <div className="pb-shell">
      <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} onOpenSettings={openSettings} />
      <main className="pb-sheet">{children}</main>
      {settings}
    </div>
  );
}
