import { useEffect, useState, lazy, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import SoftShell from '../../soft/SoftShell';
import RiverShell from '../../river/RiverShell';
import OrbitShell from '../../orbit/OrbitShell';
import { useAuth } from '../../context/AuthContext';
import { CAPTURE_KEY_EVENT, getWebCaptureKey, toAccelerator } from '../../utils/captureKey';
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

  // Quick-capture key in a browser tab (the desktop app registers it system-wide instead, so it is skipped there).
  // Soft, River and Orbit open their capture card; Studio and Console open the small capture window.
  useEffect(() => {
    if (window.pebloDesktop) return undefined;
    let key = getWebCaptureKey();
    const refresh = () => { key = getWebCaptureKey(); };
    const onKey = (e) => {
      if (e.repeat || toAccelerator(e) !== key) return;
      e.preventDefault();
      if (['soft', 'river', 'orbit'].includes(uiStyle)) window.dispatchEvent(new Event('peblo:capture'));
      else window.open('/quick-capture', 'peblo-capture', 'popup,width=560,height=460');
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener(CAPTURE_KEY_EVENT, refresh);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener(CAPTURE_KEY_EVENT, refresh); };
  }, [uiStyle]);

  // Other parts of the app can open Settings with window.dispatchEvent(new Event('peblo:open-settings')).
  useEffect(() => {
    const open = () => setSettingsOpen(true); // the classic Settings window (River and Orbit use it; Soft's avatar opens the full page)
    window.addEventListener('peblo:open-settings', open);
    return () => window.removeEventListener('peblo:open-settings', open);
  }, []);

  const openSettings = () => { if (uiStyle === 'soft') navigate('/settings/profile'); else setSettingsOpen(true); };
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
