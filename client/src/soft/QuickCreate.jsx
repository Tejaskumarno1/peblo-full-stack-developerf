import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { todosAPI } from '../api';
import { parseQuick } from './quickParse';
import { spanOf, timeOf } from './softUtils';
import './quickcreate.css';

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (h) => { const m = Math.round(h * 60); return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`; };
const toH = (s) => { const [h, m] = s.split(':').map(Number); return h + (m || 0) / 60; };
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

/**
 * Calendar quick create (mockup: Calendar create). Opens after a click or a drag on empty space.
 * Understands plain words ("lunch with Sam fri 1pm for an hour") and warns when the time clashes with something.
 */
export default function QuickCreate({ anchor, todos, onClose, onSay }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [date, setDate] = useState(ymd(anchor.day));
  const [start, setStart] = useState(hhmm(anchor.start));
  const [end, setEnd] = useState(hhmm(Math.min(23.99, anchor.end)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ref = useRef(null);
  useEffect(() => { setTimeout(() => ref.current?.focus(), 30); }, []);
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);

  const parsed = useMemo(() => parseQuick(text), [text]);
  // Words in the title win over the picked slot
  useEffect(() => {
    if (parsed.date) setDate(ymd(parsed.date));
    if (parsed.start) { setStart(parsed.start); setEnd(parsed.end); }
  }, [parsed.date, parsed.start, parsed.end]);

  const clashes = useMemo(() => {
    const [y, m, d] = date.split('-').map(Number);
    const day = new Date(y, m - 1, d);
    const a = toH(start); const b = toH(end);
    return todos.filter((t) => t.deadline && !t.completed && timeOf(t) && sameDay(t.deadline, day)).filter((t) => {
      const s = spanOf(t);
      return s && s.start < b && s.end > a;
    });
  }, [todos, date, start, end]);

  const save = async (e) => {
    e.preventDefault();
    const title = (parsed.title || text).trim();
    if (!title) { setErr('Give it a name.'); return; }
    if (end <= start) { setErr('It has to end after it starts.'); return; }
    setBusy(true); setErr('');
    try {
      const [y, m, d] = date.split('-').map(Number);
      const made = await todosAPI.create({ text: title.slice(0, 200), priority: 'medium', deadline: new Date(y, m - 1, d).toISOString(), startTime: start, endTime: end });
      qc.invalidateQueries({ queryKey: ['todos'] });
      const id = made?.data?.todo?.id || made?.data?.id;
      onSay?.(`Added "${title.length > 32 ? `${title.slice(0, 32)}...` : title}"`, id ? async () => { await todosAPI.delete(id); qc.invalidateQueries({ queryKey: ['todos'] }); } : undefined);
      onClose();
    } catch (ex) {
      setErr(ex.response?.data?.error || 'Could not save it.');
    } finally { setBusy(false); }
  };

  return (
    <div className="s-qc-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="s-qc" role="dialog" aria-label="Quick create" onSubmit={save}>
        <div className="s-qc-head"><b>Quick create</b><button type="button" aria-label="Close" onClick={onClose}><X size={16} /></button></div>
        <input ref={ref} className="s-qc-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Lunch with Sam Fri 1pm for an hour" maxLength={200} aria-label="What and when" />
        <div className="s-qc-chips" aria-live="polite">
          <span className="cap">{parsed.chips.length ? 'Understood' : 'Type it in plain words, or pick below'}</span>
          {parsed.chips.map((c) => <span key={c.k} className="s-qc-chip">{c.label}</span>)}
        </div>
        {clashes.length > 0 && (
          <div className="s-qc-clash" role="alert">
            <AlertTriangle size={15} />
            <span>Clashes with {clashes.slice(0, 2).map((t) => t.text).join(' and ')}{clashes.length > 2 ? ` and ${clashes.length - 2} more` : ''}.</span>
          </div>
        )}
        <div className="s-qc-row">
          <label>Day<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
          <label>Starts<input type="time" value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value >= end) setEnd(hhmm(Math.min(23.9, toH(e.target.value) + 1))); }} required /></label>
          <label>Ends<input type="time" value={end} onChange={(e) => setEnd(e.target.value)} required /></label>
        </div>
        {err && <p className="s-qc-err" role="alert">{err}</p>}
        <div className="s-qc-actions">
          <button type="submit" className="s-qc-go" disabled={busy}>{busy ? 'Adding' : 'Create'}</button>
          <button type="button" className="s-qc-no" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
