import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api/client';
import { todosAPI } from '../api';
import { useAuth } from '../context/AuthContext';
import { buildNotifications, readDerived, inQuietHours } from './notifUtils';

/** The notification list and its unread count, shared by the header bell and the Notifications page. */
export function useNotificationCount() {
  const [tick, setTick] = useState(0);
  useEffect(() => { const f = () => setTick((t) => t + 1); window.addEventListener('pb-notifications-changed', f); return () => window.removeEventListener('pb-notifications-changed', f); }, []);
  const { data: server = [] } = useQuery({ queryKey: ['notifications'], queryFn: () => api.get('/collab/notifications').then((r) => r.data.notifications || []), refetchInterval: 90000, staleTime: 30000 });
  const { data: todos = [] } = useQuery({
    queryKey: ['todos', 'notif'],
    queryFn: () => { const a = new Date(); a.setHours(0, 0, 0, 0); a.setDate(a.getDate() - 7); const b = new Date(); b.setHours(23, 59, 59, 999); return todosAPI.getRange(a.toISOString(), b.toISOString()).then((r) => r.data.todos || []); },
    staleTime: 60000,
  });
  const { settings } = useAuth();
  const seen = useRef(null);
  // A new mention or comment pops up on the desktop, unless pop-ups are off or it is quiet hours.
  useEffect(() => {
    const ids = server.filter((n) => !n.read).map((n) => n.id);
    if (seen.current === null) { seen.current = new Set(ids); return; }
    const fresh = server.filter((n) => !n.read && !seen.current.has(n.id));
    ids.forEach((i) => seen.current.add(i));
    if (!fresh.length || settings?.desktopNotify === false || settings?.notifyInApp === false || inQuietHours(settings)) return;
    try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(fresh[0].title, { body: fresh[0].body || '', tag: 'peblo-' + fresh[0].id }); } catch { /* blocked */ }
  }, [server, settings]);
  return useMemo(() => buildNotifications({ server, todos, derivedRead: readDerived() }).filter((n) => !n.read).length, [server, todos, tick]); // eslint-disable-line react-hooks/exhaustive-deps
}
