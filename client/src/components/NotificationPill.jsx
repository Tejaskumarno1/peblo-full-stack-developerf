import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { ago } from '../utils/comments';

/*
 * A small "2 new" pill in the corner when something happened in my notes while I was away: someone commented, suggested
 * a change or mentioned me. It updates the moment the server says so, and sits out of the way when there is nothing new.
 */
export default function NotificationPill() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/collab/notifications');
      setItems(r.data.notifications || []);
      setUnread(r.data.unread || 0);
    } catch { /* offline or signed out: try again later */ }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 90000);
    window.addEventListener('pb-notifications-changed', load);
    return () => { clearInterval(t); window.removeEventListener('pb-notifications-changed', load); };
  }, [load]);

  const markRead = async (ids) => {
    try { await api.post('/collab/notifications/read', ids ? { ids } : {}); } catch { /* shown again next time */ }
    void load();
  };
  const openItem = (n) => {
    void markRead([n.id]);
    setOpen(false);
    if (n.noteId) navigate(`/notes/${n.noteId}`);
  };

  if (!unread && !open) return null;
  const list = items.slice(0, 8);
  return (
    <div className="pb-notif" data-testid="notifications">
      {open && (
        <div className="card" role="dialog" aria-label="Notifications">
          <header>
            <b>What happened</b>
            <button type="button" onClick={() => { void markRead(); setOpen(false); }} data-testid="notif-read-all">Mark all read</button>
            <button type="button" aria-label="Close" onClick={() => setOpen(false)}>×</button>
          </header>
          <ul>
            {list.map((n) => (
              <li key={n.id} className={n.read ? '' : 'new'}>
                <button type="button" onClick={() => openItem(n)} data-testid="notif-item">
                  <span>{n.title}</span>
                  {n.body && <em>{n.body}</em>}
                  <small>{ago(n.createdAt)}</small>
                </button>
              </li>
            ))}
            {list.length === 0 && <li className="none">Nothing yet.</li>}
          </ul>
        </div>
      )}
      <button type="button" className="pill" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`${unread} new notification${unread === 1 ? '' : 's'}`} data-testid="notif-pill">
        <span aria-hidden="true">🔔</span> {unread} new
      </button>
      <style>{`
        .pb-notif { position: fixed; right: 18px; bottom: 18px; z-index: 1100; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; font: 13px/1.4 system-ui, sans-serif; }
        .pb-notif .pill { border: 0; border-radius: 999px; background: #111827; color: #fff; padding: 8px 14px; cursor: pointer; font: inherit; font-weight: 700; box-shadow: 0 6px 20px rgba(0,0,0,.3); }
        .pb-notif .card { width: min(340px, calc(100vw - 36px)); max-height: 60vh; overflow: auto; background: #111827; color: #f3f4f6; border-radius: 14px; box-shadow: 0 18px 50px rgba(0,0,0,.4); }
        .pb-notif header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #ffffff22; }
        .pb-notif header b { flex: 1; }
        .pb-notif header button { border: 0; background: transparent; color: #93c5fd; cursor: pointer; font: inherit; }
        .pb-notif ul { list-style: none; margin: 0; padding: 4px; }
        .pb-notif li button { width: 100%; text-align: left; border: 0; background: transparent; color: inherit; border-radius: 8px; padding: 8px; cursor: pointer; font: inherit; display: grid; gap: 2px; }
        .pb-notif li button:hover { background: #ffffff14; }
        .pb-notif li.new button span { font-weight: 700; }
        .pb-notif li em { opacity: .75; font-style: normal; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pb-notif li small { opacity: .55; }
        .pb-notif .none { padding: 12px; opacity: .65; }
      `}</style>
    </div>
  );
}
