import { useEffect, useState, lazy, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import SoftShell from '../../soft/SoftShell';
import RiverShell from '../../river/RiverShell';
import OrbitShell from '../../orbit/OrbitShell';
import { useAuth } from '../../context/AuthContext';
import '../../styles/shell.css';
import '../../styles/shell-styles.css';

const SettingsModal = lazy(() => import('../SettingsModal'));

/** Left sidebar + raised content sheet that every main screen sits in. */
export default function AppShell({ children }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { uiStyle } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  if (uiStyle === 'river') {
    return <><RiverShell>{children}</RiverShell>{settings}</>;
  }
  if (uiStyle === 'orbit') {
    return <><OrbitShell>{children}</OrbitShell>{settings}</>;
  }
  return <><SoftShell onOpenSettings={openSettings}>{children}</SoftShell>{settings}</>;
}
