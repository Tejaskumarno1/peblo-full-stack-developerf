import { useEffect, useRef, useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import RiverCapture from './RiverCapture';
import { initialsOf } from './riverUtils';
import './river.css';

const NAV = [
  { to: '/', end: true, label: 'River' },
  { to: '/notes', label: 'Notes' },
  { to: '/ai', end: true, label: 'Ask Peblo' },
];

/** Closes a pop-over when you click outside it or press Escape. */
export function useDismiss(open, onClose) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open, onClose]);
  return ref;
}

/**
 * The top bar every River screen shares: brand, the three places, then whatever the
 * screen puts in the middle (the date, a back link), then its own tools.
 */
export function RiverHeader({ children, tools }) {
  const { user, theme, setTheme } = useAuth();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const ref = useDismiss(menu, () => setMenu(false));
  const nextTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'midnight' : 'light';

  return (
    <header className="r-head">
      <Link to="/" className="r-brand" aria-label="Peblo, back to the river">peblo</Link>
      {children}
      <nav aria-label="Main" className="r-nav">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>{n.label}</NavLink>
        ))}
      </nav>
      <span className="grow" />
      {tools}
      <button type="button" className="r-icon-btn" aria-label="Capture a task, meeting or note" title="Capture" onClick={() => window.dispatchEvent(new Event('peblo:capture'))}>
        <Plus size={20} strokeWidth={2.4} />
      </button>
      <div className="r-menu-wrap" ref={ref}>
        <button type="button" className="r-avatar" aria-label="Your menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>{initialsOf(user?.name)}</button>
        {menu && (
          <div className="r-pop right" role="menu" style={{ width: 220 }}>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); navigate('/ai/connections'); }}>Your AI and privacy</button>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); setTheme(nextTheme); }}>Switch to {nextTheme} theme</button>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); window.dispatchEvent(new Event('peblo:open-settings')); }}>Settings</button>
          </div>
        )}
      </div>
    </header>
  );
}

/** River frame: the page, plus the capture card that any screen can open. */
export default function RiverShell({ children }) {
  const [capture, setCapture] = useState(null);

  useEffect(() => {
    const open = (e) => setCapture(e?.detail || {});
    window.addEventListener('peblo:capture', open);
    return () => window.removeEventListener('peblo:capture', open);
  }, []);

  return (
    <div className="river">
      {children}
      {capture && (
        <div className="r-capture-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setCapture(null); }}>
          <RiverCapture preset={capture} onClose={() => setCapture(null)} />
        </div>
      )}
    </div>
  );
}
