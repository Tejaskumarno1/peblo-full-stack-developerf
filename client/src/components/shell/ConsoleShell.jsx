import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Home, FileText, CheckSquare, Calendar, Sparkles, Plus, Plug, Settings, Sun, Moon, MoonStar } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { openCommandPalette } from './Sidebar';
import useShellData from './useShellData';

const NAV = [
  { to: '/', end: true, label: 'Home', icon: Home },
  { to: '/notes', label: 'Notes', icon: FileText },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare },
  { to: '/calendar', label: 'Calendar', icon: Calendar },
  { to: '/ai', end: true, label: 'AI Hub', icon: Sparkles },
];

/** Option B: icon rail, command bar and status bar around the page. */
export default function ConsoleShell({ children, onOpenSettings }) {
  const navigate = useNavigate();
  const { user, theme, setTheme } = useAuth();
  const { notesCount, openTasks, modelLine, modelKind } = useShellData();
  const [command, setCommand] = useState('');

  const nextTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'midnight' : 'light';
  const ThemeIcon = theme === 'light' ? Moon : theme === 'dark' ? MoonStar : Sun;
  const initials = (user?.name && user.name !== 'You' ? user.name : 'You').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  const submit = (e) => {
    e.preventDefault();
    const q = command.trim();
    if (!q) { openCommandPalette(); return; }
    setCommand('');
    navigate(`/ai?q=${encodeURIComponent(q)}`);
  };

  return (
    <div className="pb-shell pb-shell--console">
      <nav aria-label="Main" className="cs-rail">
        <NavLink to="/" end className="cs-logo" aria-label="Peblo home">p</NavLink>
        {NAV.map(({ to, end, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `cs-rail-btn${isActive ? ' active' : ''}`} aria-label={label} title={label}>
            <Icon size={19} />
          </NavLink>
        ))}
        <NavLink to="/tasks?add=1" className="cs-rail-btn cs-capture" aria-label="Quick add a task" title="Quick add (Ctrl Shift Space anywhere)">
          <Plus size={18} />
        </NavLink>
        <span className="grow" />
        <button type="button" className="cs-rail-btn" aria-label={`Switch to ${nextTheme} theme`} title="Theme" onClick={() => setTheme(nextTheme)}>
          <ThemeIcon size={18} />
        </button>
        <NavLink to="/ai/connections" className={({ isActive }) => `cs-rail-btn${isActive ? ' active' : ''}`} aria-label="AI and connections" title="AI and connections">
          <Plug size={18} />
        </NavLink>
        <button type="button" className="cs-rail-btn" aria-label="Settings" title="Settings" onClick={onOpenSettings}>
          <Settings size={18} />
        </button>
      </nav>

      <div className="cs-main">
        <div className="cs-bar">
          <form className="cs-cmd" onSubmit={submit}>
            <span className="cs-prompt" aria-hidden="true">&gt;</span>
            <label htmlFor="cs-cmd-input" className="sr-only">Ask your notes, or press Enter on an empty line for commands</label>
            <input
              id="cs-cmd-input"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="ask your notes anything  ·  enter on empty opens commands"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" className="cs-kbd" onClick={openCommandPalette}>Ctrl K</button>
          </form>
          <NavLink to="/ai/connections" className="cs-pill" title="Where AI runs">
            <span className={`cs-sq ${modelKind}`} />
            {modelLine}
          </NavLink>
          <button type="button" className="cs-avatar" aria-label="Settings" onClick={onOpenSettings}>{initials}</button>
        </div>

        <main className="pb-sheet">{children}</main>

        <div className="cs-status">
          <span className="cs-status-left"><span className="cs-sq local" />saved to your account · {notesCount} notes · {openTasks} open tasks</span>
          <span className="cs-status-keys"><span>ctrl k  commands</span><span>ctrl j  ask</span><span>ctrl shift space  capture</span></span>
        </div>
      </div>
    </div>
  );
}
