import { useMemo } from 'react';
import { normalizeRouting, describeModel } from '../../utils/aiRouting';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Home, Inbox, FileText, CheckSquare, Calendar, Sparkles, Search, PanelLeft,
  Settings, Lock, Sun, Moon, MoonStar,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { notesAPI, todosAPI, hubAPI } from '../../api';

const ROUTING_LABEL = { ollama: 'Local only', ask: 'Ask before cloud', auto: 'Best available', openai: 'OpenAI first', gemini: 'Gemini first' };
const DOTS = ['var(--pb-solid)', 'var(--pb-warn)', 'var(--pb-local)', 'var(--pb-cloud)'];

export function openCommandPalette() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
}

export default function Sidebar({ collapsed, onToggleCollapsed, onOpenSettings }) {
  const { user, theme, setTheme } = useAuth();
  const navigate = useNavigate();

  const { data: notes = [] } = useQuery({
    queryKey: ['notes', 'sidebar'],
    queryFn: () => notesAPI.getAll({ sort: 'updated' }).then((r) => r.data.notes || []),
    staleTime: 30 * 1000,
  });
  const { data: today } = useQuery({
    queryKey: ['todos', 'today', 'sidebar'],
    queryFn: () => todosAPI.getToday().then((r) => r.data),
    staleTime: 30 * 1000,
  });
  const { data: models } = useQuery({
    queryKey: ['hub-models'],
    queryFn: () => hubAPI.models().then((r) => r.data),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  const inboxCount = notes.filter((n) => (n.tags || []).includes('inbox')).length;
  const openTasks = (today?.todayTasks?.length || 0) + (today?.overdueTasks?.length || 0);
  const recent = notes.slice(0, 3);

  const tags = useMemo(() => {
    const counts = new Map();
    for (const n of notes) for (const t of n.tags || []) if (t !== 'private') counts.set(t, (counts.get(t) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [notes]);

  const routing = normalizeRouting(models?.routing);
  const { name: modelLine, kind: modelKind } = describeModel(models);

  const nextTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'midnight' : 'light';
  const ThemeIcon = theme === 'light' ? Moon : theme === 'dark' ? MoonStar : Sun;
  const initial = (user?.name || 'You').trim().charAt(0).toUpperCase();

  const link = ({ isActive }) => `pb-nav-link${isActive ? ' active' : ''}`;
  // Inbox is /notes?tag=inbox: highlight it there, and keep plain "Notes" for every other notes view.
  const loc = useLocation();
  const onInbox = loc.pathname.startsWith('/notes') && new URLSearchParams(loc.search).get('tag') === 'inbox';
  const notesLink = ({ isActive }) => `pb-nav-link${isActive && !onInbox ? ' active' : ''}`;

  return (
    <nav aria-label="Main" className={`pb-sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="pb-brand">
        <div className="pb-logo" aria-hidden="true">p</div>
        {!collapsed && (
          <div className="pb-brand-text">
            <strong>Peblo</strong>
            <span>{user?.name && user.name !== 'You' ? `${user.name.split(' ')[0]}'s workspace` : 'Your workspace'}</span>
          </div>
        )}
        {!collapsed && (
          <button type="button" className="pb-icon-btn" aria-label="Collapse sidebar" onClick={onToggleCollapsed}>
            <PanelLeft size={16} />
          </button>
        )}
      </div>

      {collapsed ? (
        <button type="button" className="pb-icon-btn" aria-label="Expand sidebar" onClick={onToggleCollapsed}>
          <PanelLeft size={16} />
        </button>
      ) : (
        <button type="button" className="pb-search-btn" onClick={openCommandPalette}>
          <Search size={15} />
          <span className="grow">Search or ask…</span>
          <span className="pb-kbd">Ctrl K</span>
        </button>
      )}

      <div className="pb-nav">
        <NavLink to="/" end className={link} title="Home">
          <Home size={16} />{!collapsed && <span className="grow">Home</span>}
        </NavLink>
        <NavLink to="/notes?tag=inbox" className={() => `pb-nav-link${onInbox ? ' active' : ''}`} title="Inbox">
          <Inbox size={16} />
          {!collapsed && <span className="grow">Inbox</span>}
          {!collapsed && inboxCount > 0 && <span className="pb-count">{inboxCount}</span>}
        </NavLink>
        <NavLink to="/notes" className={notesLink} title="Notes">
          <FileText size={16} />{!collapsed && <span className="grow">Notes</span>}
        </NavLink>
        <NavLink to="/tasks" className={link} title="Tasks">
          <CheckSquare size={16} />
          {!collapsed && <span className="grow">Tasks</span>}
          {!collapsed && openTasks > 0 && <span className="pb-muted" style={{ fontSize: 11 }}>{openTasks}</span>}
        </NavLink>
        <NavLink to="/calendar" className={link} title="Calendar">
          <Calendar size={16} />{!collapsed && <span className="grow">Calendar</span>}
        </NavLink>
        <NavLink to="/ai" className={link} title="AI Hub">
          <Sparkles size={16} />
          {!collapsed && <span className="grow">AI Hub</span>}
          {!collapsed && <span className="pb-kbd" style={{ background: 'transparent', padding: 0 }}>Ctrl J</span>}
        </NavLink>
      </div>

      {!collapsed && recent.length > 0 && (
        <div className="pb-nav">
          <div className="pb-section-label">Recent</div>
          {recent.map((n, i) => (
            <Link key={n.id} to={`/notes/${n.id}`} className="pb-recent-link">
              <span className="dot" style={{ background: DOTS[i % DOTS.length] }} />
              <span className="title">{n.title || 'Untitled'}</span>
            </Link>
          ))}
        </div>
      )}

      {!collapsed && tags.length > 0 && (
        <div className="pb-nav">
          <div className="pb-section-label">Tags</div>
          <div className="pb-tags">
            {tags.map(([name, count]) => (
              <button key={name} type="button" className="pb-tag" onClick={() => navigate(`/notes?tag=${encodeURIComponent(name)}`)}>
                #{name} <span className="n">{count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ flex: 1 }} />

      {!collapsed && (
        <Link to="/ai/connections" className="pb-trust" title="AI and privacy settings">
          <span className="pb-trust-title">
            <Lock size={14} color="var(--pb-local)" strokeWidth={2.2} />
            Saved to your account
          </span>
          <span className="pb-trust-row">
            <span className={`pb-dot ${modelKind}`} />
            <span className="grow">{modelLine}</span>
            {modelKind === 'local' && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--pb-local)' }}>Local</span>}
            {modelKind === 'cloud' && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--pb-cloud)' }}>Cloud</span>}
          </span>
          <span className="pb-trust-row">
            <span className="pb-dot accent" />
            <span className="grow">{ROUTING_LABEL[routing] || 'Best available'}</span>
          </span>
        </Link>
      )}

      <div className="pb-user" style={collapsed ? { flexDirection: 'column', padding: 0 } : undefined}>
        <div className="pb-avatar" aria-hidden="true">{initial}</div>
        {!collapsed && <span style={{ flex: 1, fontSize: 12.5, color: 'var(--pb-fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.name || 'You'}</span>}
        <button type="button" className="pb-icon-btn" aria-label={`Switch to ${nextTheme} theme`} title={`Switch to ${nextTheme} theme`} onClick={() => setTheme(nextTheme)}>
          <ThemeIcon size={16} />
        </button>
        <button type="button" className="pb-icon-btn" aria-label="Settings" onClick={onOpenSettings}>
          <Settings size={16} />
        </button>
      </div>
    </nav>
  );
}
