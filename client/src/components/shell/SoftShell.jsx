import { NavLink, Link } from 'react-router-dom';
import { Home, FileText, CheckSquare, Calendar, Sparkles, SlidersHorizontal, Plus, Search, Sun, Moon, MoonStar, Settings } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { openCommandPalette } from './Sidebar';
import useShellData from './useShellData';

const DOCK = [
  { to: '/', end: true, label: 'Home', icon: Home },
  { to: '/notes', label: 'Notes', icon: FileText },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare },
  { to: '/calendar', label: 'Calendar', icon: Calendar },
  { to: '/ai', end: true, label: 'AI Hub', icon: Sparkles },
  { to: '/ai/connections', label: 'Your AI', icon: SlidersHorizontal },
];

/** Option C: friendly header on top and a floating dock at the bottom. */
export default function SoftShell({ children, onOpenSettings }) {
  const { user, theme, setTheme } = useAuth();
  const { modelKind } = useShellData();

  const nextTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'midnight' : 'light';
  const ThemeIcon = theme === 'light' ? Moon : theme === 'dark' ? MoonStar : Sun;
  const initial = (user?.name && user.name !== 'You' ? user.name : 'You').trim().charAt(0).toUpperCase();

  return (
    <div className="pb-shell pb-shell--soft">
      <header className="ss-header">
        <Link to="/" className="ss-brand">
          <span className="ss-pebble" aria-hidden="true" />
          <span>peblo</span>
        </Link>
        <span className="grow" />
        <button type="button" className="ss-search" onClick={openCommandPalette}>
          <Search size={17} />
          <span className="grow">Search notes, tasks, anything</span>
          <kbd>Ctrl K</kbd>
        </button>
        <span className="grow" />
        <span className={`ss-ai ${modelKind}`} title="Where AI runs">
          <span className="dot" />
          {modelKind === 'local' ? 'AI on this computer' : modelKind === 'cloud' ? 'Cloud AI' : modelKind === 'warn' ? 'Ollama is off' : 'No AI yet'}
        </span>
        <button type="button" className="ss-round" aria-label={`Switch to ${nextTheme} theme`} onClick={() => setTheme(nextTheme)}>
          <ThemeIcon size={18} />
        </button>
        <button type="button" className="ss-round" aria-label="Settings" onClick={onOpenSettings}>
          <Settings size={18} />
        </button>
        <span className="ss-avatar" aria-hidden="true">{initial}</span>
      </header>

      <main className="pb-sheet">{children}</main>

      <nav aria-label="Main" className="ss-dock">
        {DOCK.map(({ to, end, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `ss-dock-btn${isActive ? ' active' : ''}`} aria-label={label} title={label}>
            <Icon size={20} />
          </NavLink>
        ))}
        <span className="ss-dock-sep" aria-hidden="true" />
        <Link to="/tasks?add=1" className="ss-capture">
          <Plus size={18} strokeWidth={2.6} />
          Capture
        </Link>
      </nav>
    </div>
  );
}
