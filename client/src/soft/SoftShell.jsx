import { useEffect, useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { Home, FileText, CheckSquare, Calendar, Sparkles, SlidersHorizontal, Plus, Search, Moon, MoonStar, Sun } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { openCommandPalette } from '../components/shell/Sidebar';
import SoftCapture from './SoftCapture';
import { firstNameOf } from './softUtils';
import './soft.css';

const DOCK = [
  { to: '/', end: true, label: 'Home', icon: Home },
  { to: '/notes', label: 'Notes', icon: FileText },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare },
  { to: '/calendar', label: 'Calendar', icon: Calendar },
  { to: '/ai', end: true, label: 'AI Hub', icon: Sparkles },
  { to: '/ai/connections', label: 'Your AI', icon: SlidersHorizontal },
];

/** Soft Studio frame (mockups: SoftHeader + SoftDock). Pages render in between. */
export default function SoftShell({ children, onOpenSettings }) {
  const { user, theme, setTheme } = useAuth();
  const [captureOpen, setCaptureOpen] = useState(false);

  // Pages can open the capture card with window.dispatchEvent(new Event('peblo:capture')).
  useEffect(() => {
    const open = () => setCaptureOpen(true);
    window.addEventListener('peblo:capture', open);
    return () => window.removeEventListener('peblo:capture', open);
  }, []);

  const nextTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'midnight' : 'light';
  const ThemeIcon = theme === 'light' ? Moon : theme === 'dark' ? MoonStar : Sun;
  const initial = (firstNameOf(user) || 'You').charAt(0).toUpperCase();

  return (
    <div className="soft">
      <header className="soft-header">
        <Link to="/" className="soft-brand" aria-label="Peblo home">
          <span className="blob" aria-hidden="true" />
          <span className="word">peblo</span>
        </Link>
        <span className="grow" />
        <button type="button" className="soft-search" onClick={openCommandPalette}>
          <Search size={18} />
          <span className="grow">Search notes, tasks, anything</span>
          <kbd>Ctrl K</kbd>
        </button>
        <span className="grow" />
        <button type="button" className="soft-round" aria-label={`Switch to ${nextTheme} theme`} title="Theme" onClick={() => setTheme(nextTheme)}>
          <ThemeIcon size={19} />
        </button>
        <button type="button" className="soft-avatar" aria-label="Settings" title="Settings" onClick={onOpenSettings}>{initial}</button>
      </header>

      {children}

      <nav aria-label="Main" className="soft-dock">
        {DOCK.map(({ to, end, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `soft-dock-btn${isActive ? ' active' : ''}`} aria-label={label} title={label}>
            <Icon size={21} strokeWidth={2.2} />
          </NavLink>
        ))}
        <span className="soft-dock-sep" aria-hidden="true" />
        <button type="button" className="soft-dock-capture" onClick={() => setCaptureOpen(true)}>
          <Plus size={19} strokeWidth={2.6} />
          Capture
        </button>
      </nav>

      {captureOpen && (
        <div className="soft-capture-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setCaptureOpen(false); }}>
          <SoftCapture onClose={() => setCaptureOpen(false)} />
        </div>
      )}
    </div>
  );
}
