import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, X } from 'lucide-react';
import { todosAPI } from '../api';
import '../styles/newmeeting.css';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const roundedNow = () => { const d = new Date(Math.ceil((Date.now() + 60000) / 900000) * 900000); return d; };
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const addMin = (t, m) => { const [h, mi] = t.split(':').map(Number); const tot = Math.min(h * 60 + mi + m, 23 * 60 + 59); return `${pad(Math.floor(tot / 60))}:${pad(tot % 60)}`; };
const REPEATS = [['none', 'Does not repeat'], ['daily', 'Every day'], ['weekdays', 'Every weekday'], ['weekly', 'Every week'], ['monthly', 'Every month']];

/**
 * "New meeting" for Soft Studio and Orbit (River has its own capture card).
 * A small form: title, day, start and end, repeat and a meeting link. Saves a meeting on the calendar.
 * `className` styles the button so it fits the header it sits in.
 */
export default function NewMeeting({ className = '', label = 'New meeting', day }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [repeat, setRepeat] = useState('none');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const titleRef = useRef(null);

  const show = () => {
    const r = roundedNow();
    const d = day ? new Date(day) : r;
    setDate(ymd(d));
    setStart(hhmm(r));
    setEnd(addMin(hhmm(r), 60));
    setTitle(''); setRepeat('none'); setLink(''); setErr('');
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return undefined;
    setTimeout(() => titleRef.current?.focus(), 30);
    const k = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [open]);

  const save = async (e) => {
    e.preventDefault();
    if (!title.trim()) { setErr('Give the meeting a name.'); return; }
    if (end <= start) { setErr('It has to end after it starts.'); return; }
    setBusy(true); setErr('');
    try {
      const [y, m, d] = date.split('-').map(Number);
      await todosAPI.create({
        text: title.trim().slice(0, 200),
        priority: 'medium',
        deadline: new Date(y, m - 1, d).toISOString(),
        startTime: start,
        endTime: end,
        recurrence: repeat,
        meta: link.trim() ? { link: link.trim() } : undefined,
      });
      qc.invalidateQueries({ queryKey: ['todos'] });
      setOpen(false);
    } catch (ex) {
      setErr(ex.response?.data?.error || 'Could not save the meeting.');
    } finally { setBusy(false); }
  };

  return (
    <>
      <button type="button" className={className} onClick={show}><CalendarPlus size={15} /> {label}</button>
      {open && createPortal(
        <div className="pb-nm-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <form className="pb-nm" role="dialog" aria-label="New meeting" onSubmit={save}>
            <div className="pb-nm-head"><b>New meeting</b><button type="button" aria-label="Close" onClick={() => setOpen(false)}><X size={16} /></button></div>
            <label>Name<input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Design review" maxLength={200} /></label>
            <div className="pb-nm-row">
              <label>Day<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
              <label>Starts<input type="time" value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value >= end) setEnd(addMin(e.target.value, 60)); }} required /></label>
              <label>Ends<input type="time" value={end} onChange={(e) => setEnd(e.target.value)} required /></label>
            </div>
            <label>Repeat
              <select value={repeat} onChange={(e) => setRepeat(e.target.value)}>{REPEATS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
            </label>
            <label>Meeting link (optional)<input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://meet.google.com/…" /></label>
            {err && <p role="alert" className="pb-nm-err">{err}</p>}
            <div className="pb-nm-foot">
              <button type="button" onClick={() => setOpen(false)}>Cancel</button>
              <button type="submit" className="go" disabled={busy}>{busy ? 'Saving…' : 'Add meeting'}</button>
            </div>
          </form>
        </div>,
        document.body,
      )}
    </>
  );
}
