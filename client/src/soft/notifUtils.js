// Notification centre helpers: turn server notifications, today's meetings and due tasks into one list.
const KEY = 'peblo-notif-read';
export const readDerived = () => { try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return new Set(); } };
export const saveDerived = (set) => { try { localStorage.setItem(KEY, JSON.stringify([...set].slice(-300))); } catch { /* no storage */ } };

const toMin = (hhmm) => { const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || ''); return m ? +m[1] * 60 + +m[2] : null; };
/** Quiet hours: are we inside the window (it may cross midnight)? Meetings are never silenced. */
export function inQuietHours(settings, now = new Date()) {
  const q = settings?.quietHours;
  if (!q || q.on === false) return false;
  const a = toMin(q.from || '22:00'); const b = toMin(q.to || '07:00');
  if (a === null || b === null || a === b) return false;
  const n = now.getHours() * 60 + now.getMinutes();
  return a < b ? n >= a && n < b : n >= a || n < b;
}

const clock = (hhmm) => { const m = toMin(hhmm); if (m === null) return ''; const h = Math.floor(m / 60); return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const dayOf = (d) => { const x = new Date(d); return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };

/** Build the list. server = /collab/notifications rows, todos = tasks around today. */
export function buildNotifications({ server = [], todos = [], derivedRead = new Set(), now = new Date() }) {
  const out = [];
  const today = dayOf(now);
  for (const n of server) {
    const mention = /mention/i.test(n.kind) || /mention/i.test(n.title || '');
    const ws = ['office_post', 'office_suggestion', 'assigned', 'member_joined', 'org_invite'].includes(n.kind) ? n.kind : null;
    out.push({ id: 's:' + n.id, server: n.id, kind: ws || (mention ? 'mention' : 'note'), spaceId: n.spaceId || null, todoId: n.todoId || undefined, title: n.title, sub: n.kind === 'org_invite' ? 'Open to accept or decline' : n.body || (n.from ? 'From ' + n.from : ''), at: new Date(n.createdAt), read: !!n.read, noteId: n.noteId, path: n.kind === 'org_invite' && /^\/invite\?token=/.test(n.body || '') ? n.body : undefined });
  }
  for (const t of todos) {
    if (t.completed || !t.deadline) continue;
    const d = dayOf(t.deadline);
    if (t.startTime) {
      if (d !== today) continue;
      const mins = toMin(t.startTime);
      const startMs = today + mins * 60000;
      const left = Math.round((startMs - now.getTime()) / 60000);
      const id = 't:' + t.id + ':' + t.startTime;
      const title = left > 0 && left <= 120 ? `${t.text} starts in ${left < 60 ? left + ' minutes' : Math.round(left / 60) + ' hour' + (left >= 90 ? 's' : '')}` : left <= 0 && left > -60 ? `${t.text} is on now` : `${t.text} at ${clock(t.startTime)}`;
      out.push({ id, kind: 'meeting', title, sub: `${clock(t.startTime)}${t.endTime ? ' to ' + clock(t.endTime) : ''}`, at: new Date(startMs - Math.min(10, Math.max(left, 0)) * 60000), read: derivedRead.has(id), link: t.meta?.link, todoId: t.id });
    } else if (d <= today) {
      const id = 'k:' + t.id + ':' + d;
      out.push({ id, kind: 'task', title: d < today ? `${t.text} is overdue` : `${t.text} is due today`, sub: 'From your task list', at: new Date(d < today ? d : today + 9 * 3600000), read: derivedRead.has(id), todoId: t.id });
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

export const FILTERS = [['all', 'All'], ['unread', 'Unread'], ['mention', 'Mentions'], ['task', 'Tasks'], ['meeting', 'Meetings'], ['team', 'Teams'], ['org_invite', 'Invites']];
export const TEAM_KINDS = ['office_post', 'office_suggestion', 'assigned', 'member_joined', 'org_invite'];
export const applyFilter = (list, f) => list.filter((n) => f === 'all' || (f === 'unread' ? !n.read : f === 'team' ? TEAM_KINDS.includes(n.kind) : n.kind === f));
export const whenLabel = (d, now = new Date()) => {
  const x = new Date(d); const diff = dayOf(now) - dayOf(x);
  if (diff === 0) return x.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (diff === 86400000) return 'Yesterday';
  return x.toLocaleDateString([], { weekday: 'short' });
};
export const groupOf = (d, now = new Date()) => (dayOf(d) >= dayOf(now) ? 'Today' : 'Earlier');

