import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Calendar, CheckSquare, FileText, AtSign, Bell, Check } from 'lucide-react';
import api from '../api/client';
import { todosAPI } from '../api';
import { useAuth } from '../context/AuthContext';
import { Switch, Seg } from './settings/ui';
import { buildNotifications, applyFilter, FILTERS, readDerived, saveDerived, whenLabel, groupOf } from './notifUtils';
import './notifications.css';

const ICON = { meeting: Calendar, task: CheckSquare, mention: AtSign, note: FileText };
const TONE = { meeting: 'butter', task: 'peach', mention: 'lilac', note: 'sky' };

/** Soft Studio · Notification centre (mockup: NotifCentre). One list: mentions, meetings and tasks that need you. */
export default function SoftNotifications() {
  const navigate = useNavigate();
  const { settings, updateSettings } = useAuth();
  const [filter, setFilter] = useState('all');
  const [derived, setDerived] = useState(readDerived);
  const { data: server = [], refetch } = useQuery({ queryKey: ['notifications'], queryFn: () => api.get('/collab/notifications').then((r) => r.data.notifications || []), refetchInterval: 90000 });
  const { data: todos = [] } = useQuery({
    queryKey: ['todos', 'notif'],
    queryFn: () => { const a = new Date(); a.setHours(0, 0, 0, 0); a.setDate(a.getDate() - 7); const b = new Date(); b.setHours(23, 59, 59, 999); return todosAPI.getRange(a.toISOString(), b.toISOString()).then((r) => r.data.todos || []); },
  });
  const list = useMemo(() => buildNotifications({ server, todos, derivedRead: derived }), [server, todos, derived]);
  const shown = applyFilter(list, filter);
  const unread = list.filter((n) => !n.read).length;

  const markRead = useCallback(async (ns) => {
    const ids = ns.filter((n) => n.server).map((n) => n.server);
    if (ids.length) { try { await api.post('/collab/notifications/read', { ids }); } catch { /* shown again next time */ } void refetch(); window.dispatchEvent(new Event('pb-notifications-changed')); }
    const rest = ns.filter((n) => !n.server);
    if (rest.length) { const s = new Set(derived); rest.forEach((n) => s.add(n.id)); saveDerived(s); setDerived(s); window.dispatchEvent(new Event('pb-notifications-changed')); }
  }, [derived, refetch]);
  const open = (n) => {
    void markRead([n]);
    if (n.noteId) navigate('/notes/' + n.noteId);
    else if (n.kind === 'meeting') navigate('/calendar');
    else navigate('/tasks?task=' + n.todoId);
  };
  const act = (n) => (n.kind === 'meeting' && /^https?:\/\//i.test(n.link || '') ? ['Join', () => { void markRead([n]); window.open(n.link, '_blank', 'noopener'); }] : [n.kind === 'mention' ? 'View' : 'Open', () => open(n)]);

  const q = settings?.quietHours || { on: false, from: '22:00', to: '07:00' };
  const setQuiet = (patch) => updateSettings({ quietHours: { ...q, ...patch } });
  const groups = ['Today', 'Earlier'].map((g) => [g, shown.filter((n) => groupOf(n.at) === g)]).filter(([, l]) => l.length);

  useEffect(() => { document.title = unread ? `(${unread}) Notifications - Peblo` : 'Notifications - Peblo'; return () => { document.title = 'Peblo'; }; }, [unread]);

  return (
    <div className="soft-page s-notif">
      <section className="s-notif-main" aria-label="Notifications">
        <header>
          <h1>Notifications</h1>
          {unread > 0 && <span className="s-notif-new" data-testid="notif-new">{unread} new</span>}
          <span className="grow" />
          <button type="button" className="s-notif-btn" data-testid="notif-read-all" disabled={!unread} onClick={() => markRead(list.filter((n) => !n.read))}><Check size={15} /> Mark all read</button>
        </header>
        <Seg label="Filter notifications" value={filter} options={FILTERS.map(([v, l]) => ({ id: v, label: l }))} onChange={setFilter} />
        <div className="s-notif-list">
          {groups.map(([g, items]) => (
            <div key={g} role="group" aria-label={g}>
              <div className="s-notif-gh">{g}</div>
              {items.map((n) => {
                const Icon = ICON[n.kind] || Bell; const [label, run] = act(n);
                return (
                  <div key={n.id} className={`s-notif-row${n.read ? '' : ' unread'}`} data-testid="notif-row" data-kind={n.kind}>
                    <span className="ic" style={{ background: `var(--s-${TONE[n.kind]})` }}><Icon size={18} /></span>
                    <button type="button" className="txt" onClick={() => open(n)}><b>{n.title}</b><small>{n.sub}</small></button>
                    <button type="button" className={`s-notif-btn${n.kind === 'meeting' && n.link ? ' dark' : ''}`} onClick={run}>{label}</button>
                    <time>{whenLabel(n.at)}</time>
                  </div>
                );
              })}
            </div>
          ))}
          {!groups.length && <p className="s-empty" data-testid="notif-empty">{filter === 'all' ? 'Nothing needs you right now.' : 'Nothing in this filter.'}</p>}
        </div>
      </section>
      <aside className="s-notif-side">
        <div className="s-notif-card lilac">
          <b>Quiet hours</b>
          <p>No pop-ups between {q.from || '22:00'} and {q.to || '07:00'}. Meetings still ring.</p>
          <div className="row"><Switch label="Quiet hours" checked={!!q.on} onChange={(v) => setQuiet({ on: v })} /><span>{q.on ? 'On' : 'Off'}</span></div>
          {q.on && <div className="row times"><label>From <input type="time" value={q.from || '22:00'} onChange={(e) => setQuiet({ from: e.target.value })} /></label><label>To <input type="time" value={q.to || '07:00'} onChange={(e) => setQuiet({ to: e.target.value })} /></label></div>}
        </div>
        <div className="s-notif-card">
          <b>Where to get them</b>
          <div className="row"><span>In the app</span><Switch label="In the app" checked={settings?.notifyInApp !== false} onChange={(v) => updateSettings({ notifyInApp: v })} /></div>
          <div className="row"><span>Desktop pop-up</span><Switch label="Desktop pop-up" checked={settings?.desktopNotify !== false} onChange={(v) => updateSettings({ desktopNotify: v })} /></div>
          <div className="row off"><span>Email digest</span><em>Soon</em></div>
          <div className="row off"><span>Phone push</span><em>Soon</em></div>
        </div>
      </aside>
    </div>
  );
}
