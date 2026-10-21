import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { todosAPI } from '../api';
import { startOfDay, addDays, isMeeting, momentOf, clockRange, endOf } from './riverUtils';
import './river.css';

const KEY = 'peblo-meeting-reminded';
const readFired = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const saveFired = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(-200))); } catch { /* no storage */ } };
const providerOf = (l) => (/meet\.google/i.test(l) ? 'Google Meet' : /teams\./i.test(l) ? 'Teams' : /zoom\./i.test(l) ? 'Zoom' : /webex/i.test(l) ? 'Webex' : 'the meeting');

/**
 * A heads-up before a meeting: a desktop notification and a card with a Join button.
 * Uses the reminder set on the meeting; a meeting with a link and no reminder gets 5 minutes.
 * Works while Peblo is running (it stays in the tray when the window is closed).
 */
export default function MeetingReminders() {
  const { data: todos = [] } = useQuery({
    queryKey: ['todos', 'range', 'reminders'],
    queryFn: () => todosAPI.getRange(startOfDay().toISOString(), addDays(startOfDay(), 2).toISOString()).then((r) => r.data.todos || []),
    refetchInterval: 60000,
    staleTime: 30000,
  });
  const [cards, setCards] = useState([]);
  const fired = useRef(null);
  if (fired.current === null) fired.current = new Set(readFired());

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      for (const t of todos) {
        if (!isMeeting(t) || t.completed) continue;
        const s = momentOf(t).getTime();
        const lead = (t.meta?.remindMin || (t.meta?.link ? 5 : 0)) * 60000;
        if (!lead) continue;
        const key = t.id + ':' + s;
        if (fired.current.has(key) || now < s - lead || now > s + 5 * 60000) continue;
        fired.current.add(key);
        saveFired([...fired.current]);
        const mins = Math.max(0, Math.round((s - now) / 60000));
        setCards((c) => [...c, { key, t, s, mins }]);
        try {
          if (typeof Notification !== 'undefined') {
            if (Notification.permission === 'default') Notification.requestPermission();
            if (Notification.permission === 'granted') {
              const e = endOf(t) || new Date(s + 3600000);
              const n = new Notification(`${t.text} ${mins > 0 ? 'in ' + mins + ' min' : 'is starting'}`, { body: t.meta?.link ? 'Click to join ' + providerOf(t.meta.link) : clockRange(new Date(s), e), tag: key });
              n.onclick = () => { if (t.meta?.link) window.open(t.meta.link, '_blank', 'noopener'); window.focus(); };
            }
          }
        } catch { /* notifications blocked */ }
      }
    };
    tick();
    const id = setInterval(tick, 20000);
    return () => clearInterval(id);
  }, [todos]);

  if (!cards.length) return null;
  return (
    <div className="r-remind" role="region" aria-label="Meeting reminders">
      {cards.map((c) => (
        <div key={c.key} className="r-remind-card" role="status">
          <button type="button" className="r-x" aria-label="Dismiss" onClick={() => setCards((x) => x.filter((y) => y.key !== c.key))}><X size={14} /></button>
          <b>{c.t.text}</b>
          <span>{c.mins > 0 ? 'Starts in ' + c.mins + ' min' : 'Starting now'} · {clockRange(new Date(c.s), endOf(c.t) || new Date(c.s + 3600000))}</span>
          <div className="r-btns">
            {c.t.meta?.link && <a className="r-btn small" href={c.t.meta.link} target="_blank" rel="noopener noreferrer" onClick={() => setCards((x) => x.filter((y) => y.key !== c.key))}>Join {providerOf(c.t.meta.link)}</a>}
            <button type="button" className="r-btn ghost small" onClick={() => setCards((x) => x.filter((y) => y.key !== c.key))}>Dismiss</button>
          </div>
        </div>
      ))}
    </div>
  );
}
