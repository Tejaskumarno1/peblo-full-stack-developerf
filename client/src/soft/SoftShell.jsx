import { Fragment, useEffect, useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { workspacesAPI } from '../api';
import { Megaphone, Home, FileText, CheckSquare, Calendar, Sparkles, SlidersHorizontal, Plus, Search, Moon, MoonStar, Sun, Bell } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Avatar from '../components/Avatar';
import MeetingReminders from '../river/MeetingReminders';
import { openCommandPalette } from '../components/shell/commandPalette';
import SoftCapture from './SoftCapture';
import OfflineBar from './OfflineBar';
import { firstNameOf } from './softUtils';
import { useNotificationCount } from './useNotifications';
import { MoveToast } from './MoveNote';
import { SpacePill, SpaceAccessGuard, SpacesTip, useCurrentSpace, useSpaceName, useWorkspaces } from './spaces';
import './soft.css';
import './soft2.css';
import './phone.css';

const DOCK = [
  { to: '/', end: true, label: 'Home', icon: Home },
  { to: '/notes', label: 'Notes', icon: FileText },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare },
  { to: '/calendar', label: 'Calendar', icon: Calendar },
  { to: '/ai', end: true, label: 'AI Hub', icon: Sparkles },
  { to: '/ai/connections', label: 'Your AI', icon: SlidersHorizontal },
];


/** Office only: the Announcements button beside the search bar, with a dot when there is a post you have not seen (mockup E01). */
function AnnouncementsButton() {
  const { data: ws } = useWorkspaces();
  const space = useCurrentSpace();
  const here = (ws?.orgs || []).flatMap((o) => o.spaces).find((x) => x.id === space);
  const loc = useLocation();
  const on = here?.kind === 'office';
  const { data } = useQuery({ queryKey: ['announcements', space], enabled: on, queryFn: () => workspacesAPI.announcements(space).then((r) => r.data) });
  if (!on) return null;
  const key = `peblo-ann-seen-${space}`;
  const latest = (data?.posts || []).filter((p) => p.status === 'published').reduce((m, p) => Math.max(m, new Date(p.createdAt).getTime()), 0);
  const viewing = loc.pathname === '/notes' && new URLSearchParams(loc.search).get('view') === 'announcements';
  let seen = 0;
  try { if (viewing && latest) localStorage.setItem(key, String(latest)); seen = Number(localStorage.getItem(key) || 0); } catch { /* ignore */ }
  const fresh = latest > seen && !viewing;
  return (
    <Link to="/notes?view=announcements" className={`soft-ann${viewing ? ' on' : ''}`} data-testid="announcements-btn" aria-label={fresh ? 'Announcements, new' : 'Announcements'}>
      <Megaphone size={16} /><span>Announcements</span>{fresh && <i aria-hidden="true" />}
    </Link>
  );
}

/** Soft Studio frame (mockups: SoftHeader + SoftDock). Pages render in between. */
export default function SoftShell({ children, onOpenSettings }) {
  const { user, theme, setTheme } = useAuth();
  const [captureOpen, setCaptureOpen] = useState(false);
  const space = useCurrentSpace();
  const spaceName = useSpaceName();

  // Pages can open the capture card with window.dispatchEvent(new Event('peblo:capture')).
  useEffect(() => {
    const open = () => setCaptureOpen(true);
    window.addEventListener('peblo:capture', open);
    return () => window.removeEventListener('peblo:capture', open);
  }, []);

  const nextTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'midnight' : 'light';
  const ThemeIcon = theme === 'light' ? Moon : theme === 'dark' ? MoonStar : Sun;
  const unread = useNotificationCount();
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
          <span className="grow">{spaceName ? `Search in ${spaceName}` : 'Search notes, tasks, anything'}</span>
          <kbd>Ctrl K</kbd>
        </button>
        <AnnouncementsButton />
        <span className="grow" />
        <SpacePill />
        <SpaceAccessGuard />
        <SpacesTip />
        <Link to="/notifications" className="soft-round soft-bell" aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'} title="Notifications" data-testid="soft-bell"><Bell size={19} />{unread > 0 && <i aria-hidden="true" />}</Link>
        <button type="button" className="soft-round" aria-label={`Switch to ${nextTheme} theme`} title="Theme" onClick={() => setTheme(nextTheme)}>
          <ThemeIcon size={19} />
        </button>
        <button type="button" className="soft-avatar" aria-label="Settings" title="Settings" onClick={onOpenSettings}><Avatar src={user?.avatar} fallback={initial} /></button>
      </header>

      <OfflineBar />
      <Fragment key={space || 'personal'}>{children}</Fragment>
      <MoveToast />
      <div className="river" style={{ display: 'contents' }}><MeetingReminders /></div>

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
