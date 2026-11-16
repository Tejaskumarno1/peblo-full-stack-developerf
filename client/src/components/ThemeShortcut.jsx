import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

// T20 / FT20: Ctrl+Alt+D (also Ctrl+Option+D on a Mac; Cmd+Option+D is the system's Dock shortcut) flips between Light and Dark. Nothing else listens to Ctrl+Alt+<letter>
// (FocusMode uses Ctrl+Shift+F and Alt+Q, Orbit uses plain Alt+<key>); AltGr, which some keyboards send as Ctrl+Alt, is ignored.
export default function ThemeShortcut() {
  const { setTheme } = useAuth();
  useEffect(() => {
    const k = (e) => {
      if (!e.altKey || !e.ctrlKey || e.metaKey || e.shiftKey || (e.code !== 'KeyD' && (e.key || '').toLowerCase() !== 'd')) return;
      if (e.getModifierState?.('AltGraph')) return;
      e.preventDefault();
      const dark = document.documentElement.classList.contains('theme-dark'); // what is on screen now (also when the theme is "system")
      setTheme(dark ? 'light' : 'dark');
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [setTheme]);
  return null;
}
