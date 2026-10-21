import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Image as ImageIcon, Paperclip, ListChecks, Heading1, Link2, Search } from 'lucide-react';
import { notesAPI, todosAPI } from '../api';
import { parseTask } from '../utils/parseTask';
import { parseTimes, dayWord, clock, clockRange, startOfDay, addDays, sameDay, isMeeting, momentOf, endOf } from './riverUtils';
import { freeGaps, dur } from './planner';
import { extras, noteForLine } from './captureParse';
import { fileToAttachment, attachmentMarkdown } from '../utils/imageData';
import { snippetOf } from '../soft/softUtils';
import RSelect from './RSelect';
import './river.css';

const TRY = {
  meeting: [['Call Priya Friday 4pm for 30 min', 'Friday 4:00–4:30 pm, with Priya'], ['Standup every weekday 10am', 'Repeats Monday to Friday']],
  task: [['Submit assignment by Sunday', 'Due Sunday, end of day'], ['Send report friday 5pm !high', 'High priority, Friday 5 pm']],
};

const HINTS = {
  meeting: 'Design crit tomorrow 3-4pm #work',
  task: 'Send metrics to Ananya tuesday 10am !high',
  note: 'A thought, a decision, a link…',
};

/** Turns a line into the date and times it mentions (today if only a time is given). */
function readLine(raw, mode) {
  const u = extras(raw, mode);
  const times = parseTimes(u.line);
  const t = parseTask(times.text);
  let day = t.deadline ? new Date(t.deadline) : null;
  if (!day && (times.startTime || u.recurrence)) day = new Date();
  let deadline = null;
  if (day) {
    deadline = new Date(day);
    if (times.startTime) {
      const [h, m] = times.startTime.split(':').map(Number);
      deadline.setHours(h, m, 0, 0);
    } else if (mode === 'task' && !t.deadline && !u.recurrence) {
      deadline = null;
    }
  }
  // "for 30 min" sets the length unless an explicit range ("3-4pm") was written
  let endTime = times.endTime;
  if (mode === 'meeting' && times.startTime && u.durMin && !/\d\s*(?:-|–|to)\s*\d/.test(u.line)) {
    const [h, m] = times.startTime.split(':').map(Number);
    const tot = Math.min(h * 60 + m + u.durMin, 23 * 60 + 59);
    endTime = String(Math.floor(tot / 60)).padStart(2, '0') + ':' + String(tot % 60).padStart(2, '0');
  }
  // A repeat with no day said starts today, or the next day that fits
  if (u.recurrence && deadline && !t.deadline) {
    if (times.startTime && deadline < new Date()) deadline.setDate(deadline.getDate() + 1);
    if (u.recurrence === 'weekdays') while ([0, 6].includes(deadline.getDay())) deadline.setDate(deadline.getDate() + 1);
  }
  return {
    ...t, deadline, startTime: mode === 'meeting' ? times.startTime : null, endTime: mode === 'meeting' ? endTime : null, dueTime: mode === 'task' ? times.startTime : null,
    recurrence: u.recurrence, attendees: u.attendees, remindMin: u.remindMin,
  };
}

const LENGTHS = [[15, '15 min'], [30, '30 min'], [45, '45 min'], [60, '1 h'], [90, '1 h 30'], [120, '2 h']];
const REPEATS = [['none', 'Does not repeat'], ['daily', 'Every day'], ['weekdays', 'Every weekday'], ['weekly', 'Every week'], ['monthly', 'Every month']];
const REMINDS = [[0, 'No reminder'], [5, '5 min before'], [10, '10 min before'], [15, '15 min before'], [30, '30 min before'], [60, '1 hour before']];
const REPEAT_WORD = { daily: 'Every day', weekdays: 'Every weekday', weekly: 'Every week', monthly: 'Every month', yearly: 'Every year' };

const words = (s) => (s || '').toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || [];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes());
const store = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const at24 = (day, t) => { const d = new Date(day); const [h, m] = t.split(':').map(Number); d.setHours(h, m, 0, 0); return d; };

/**
 * River capture card: a meeting, a task or a note.
 * Opened from the + button, from a click on the river (with the time filled in),
 * and as the Ctrl+Shift+Space window. It has everything Soft Studio's capture has
 * (quick due chips, tags, link a note, attachments, note body, pin, checklist to tasks, keep open)
 * and, for meetings, the length, start, people, repeat and reminder.
 */
export default function RiverCapture({ onClose, preset = {}, windowMode = false }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState(preset.mode || 'task');
  const [value, setValue] = useState(preset.text || '');
  const [body, setBody] = useState('');
  const [atts, setAtts] = useState([]);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [override, setOverride] = useState(null); // a free slot picked from the clash list
  const [keepClash, setKeepClash] = useState(false);
  // meeting settings
  const [len, setLen] = useState(null);
  const [pickDate, setPickDate] = useState('');
  const [pickTime, setPickTime] = useState('');
  const [withText, setWithText] = useState('');
  const [rep, setRep] = useState(null);
  const [rem, setRem] = useState(null);
  const [link, setLink] = useState('');
  const [mTasks, setMTasks] = useState([]); // existing tasks tied to the meeting
  const [newTask, setNewTask] = useState('');
  const [taskPick, setTaskPick] = useState(false);
  // task / note settings (as in Soft Studio)
  const [due, setDue] = useState(null);
  const [prio, setPrio] = useState(null);
  const [extraTags, setExtraTags] = useState([]);
  const [tagOpen, setTagOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [noLink, setNoLink] = useState(false);
  const [linkChosen, setLinkChosen] = useState(null);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const [inbox, setInbox] = useState(true);
  const [pin, setPin] = useState(false);
  const [makeTasks, setMakeTasks] = useState(false);
  const [keepOpen, setKeepOpen] = useState(() => store('peblo-capture-keep', '0') === '1');
  const inputRef = useRef(null);
  const bodyRef = useRef(null);
  const fileRef = useRef(null);

  const from = startOfDay();
  const { data: allNotes = [] } = useQuery({
    queryKey: ['notes', 'capture-link'],
    queryFn: () => notesAPI.getAll({ sort: 'updated', snippet: '1' }).then((r) => r.data.notes || []),
    staleTime: 60000,
  });
  const { data: upcoming = [] } = useQuery({
    queryKey: ['todos', 'range', 'river-capture', from.toDateString()],
    queryFn: () => todosAPI.getRange(addDays(from, -7).toISOString(), addDays(from, 30).toISOString()).then((r) => r.data.todos || []),
    staleTime: 30000,
  });

  useEffect(() => { inputRef.current?.focus(); }, [mode]);
  useEffect(() => {
    if (!windowMode) return undefined;
    const reset = () => { if (document.visibilityState === 'visible') { setStatus(null); setTimeout(() => inputRef.current?.focus(), 30); } };
    window.addEventListener('focus', reset);
    document.addEventListener('visibilitychange', reset);
    return () => { window.removeEventListener('focus', reset); document.removeEventListener('visibilitychange', reset); };
  }, [windowMode]);
  // The Electron window stays open while something is typed or attached (so taking a screenshot does not lose it).
  const dirty = !!(value.trim() || body.trim() || atts.length);
  useEffect(() => {
    window.__pebloCaptureDirty = dirty;
    return () => { window.__pebloCaptureDirty = false; };
  }, [dirty]);

  // ---------- what the line says ----------
  const at = preset.at ? new Date(preset.at) : null;
  const parsed = value.trim() && mode !== 'note' ? readLine(value, mode) : null;
  const names = withText.trim() ? withText.split(/\s*(?:,|&|\band\b)\s*/).map((s) => s.trim()).filter(Boolean).slice(0, 8) : (parsed?.attendees || []);
  const recurrence = rep !== null ? (rep === 'none' ? null : rep) : (parsed?.recurrence || null);
  const remindMin = rem !== null ? (rem || null) : (parsed?.remindMin || null);

  let when = null;
  if (parsed) {
    if (at && !parsed.deadline) {
      const s = new Date(at);
      if (mode === 'meeting') {
        const e = new Date(s.getTime() + 60 * 60000);
        when = { deadline: s, startTime: hhmm(s), endTime: hhmm(e) };
      } else {
        when = { deadline: s };
      }
    } else if (parsed.deadline) {
      when = { deadline: parsed.deadline, startTime: parsed.startTime, endTime: parsed.endTime };
    }
  }
  if (mode === 'meeting' && !when && at) {
    const s = new Date(at);
    when = { deadline: s, startTime: hhmm(s), endTime: hhmm(new Date(s.getTime() + 60 * 60000)) };
  }
  if (mode === 'meeting' && (pickDate || pickTime)) {
    const day = pickDate ? new Date(`${pickDate}T00:00`) : (when ? startOfDay(when.deadline) : startOfDay());
    const t = pickTime || when?.startTime || hhmm(new Date(Math.ceil(Date.now() / 900000) * 900000));
    const s = at24(day, t);
    const e = new Date(s.getTime() + (len || 60) * 60000);
    when = { deadline: s, startTime: hhmm(s), endTime: hhmm(e > startOfDay(s).getTime() + 86399000 ? at24(day, '23:59') : e) };
  }
  if (mode === 'meeting' && when?.startTime && len) {
    const s = at24(startOfDay(when.deadline), when.startTime);
    const e = new Date(s.getTime() + len * 60000);
    when = { ...when, endTime: hhmm(e.getDate() !== s.getDate() ? at24(s, '23:59') : e) };
  }
  if (override && when && mode === 'meeting') when = { ...when, deadline: override.s, startTime: hhmm(override.s), endTime: hhmm(override.e) };
  if (mode === 'task' && due && parsed) {
    const d = new Date(`${due}T00:00`);
    if (parsed.dueTime && parsed.deadline) d.setHours(parsed.deadline.getHours(), parsed.deadline.getMinutes());
    else d.setHours(23, 59, 0, 0);
    when = { deadline: d };
  }

  // ---------- clash with something already that day ----------
  const span = (() => {
    if (mode !== 'meeting' || !when?.startTime || !when.endTime) return null;
    const s = at24(startOfDay(when.deadline), when.startTime);
    const e = at24(startOfDay(when.deadline), when.endTime);
    return e > s ? { s, e } : null;
  })();
  const dayStart = span ? startOfDay(span.s) : null;
  const { data: dayTodos = [] } = useQuery({
    queryKey: ['todos', 'range', 'capture', dayStart ? dayStart.toISOString() : null],
    queryFn: () => todosAPI.getRange(dayStart.toISOString(), addDays(dayStart, 1).toISOString()).then((r) => r.data.todos || []),
    enabled: !!dayStart,
  });
  const dayMeetings = dayTodos.filter(isMeeting);
  const endIn = (t) => endOf(t) || new Date(momentOf(t).getTime() + 3600000);
  const clashing = span ? dayMeetings.filter((t) => momentOf(t) < span.e && endIn(t) > span.s) : [];
  const lenMs = span ? span.e - span.s : 0;
  const slots = span && clashing.length
    ? freeGaps(dayMeetings, dayStart, 1, sameDay(dayStart, new Date()) ? new Date() : dayStart, Math.round(lenMs / 60000))
      .filter((g) => g.s.getTime() !== span.s.getTime()).slice(0, 2)
    : [];
  // the same length on the next days (9 am to 6 pm), when today has nothing that fits
  const { data: ahead = [] } = useQuery({
    queryKey: ['todos', 'range', 'capture-ahead', dayStart ? dayStart.toISOString() : null],
    queryFn: () => todosAPI.getRange(addDays(dayStart, 1).toISOString(), addDays(dayStart, 8).toISOString()).then((r) => r.data.todos || []),
    enabled: !!dayStart && clashing.length > 0,
  });
  const otherDays = [];
  if (span && clashing.length) {
    const meets = ahead.filter(isMeeting);
    for (let i = 1; i <= 7 && otherDays.length < 2; i++) {
      const day = addDays(dayStart, i);
      const open = new Date(day).setHours(9, 0, 0, 0);
      const shut = new Date(day).setHours(18, 0, 0, 0);
      for (const g of freeGaps(meets, day, 1, day, Math.round(lenMs / 60000))) {
        const s = new Date(Math.max(g.s.getTime(), open));
        if (s.getTime() + lenMs <= Math.min(g.e.getTime(), shut)) { otherDays.push({ s, e: new Date(s.getTime() + lenMs) }); break; }
      }
    }
  }
  const pickSlot = (g) => { setOverride({ s: g.s, e: g.e || new Date(g.s.getTime() + lenMs) }); setKeepClash(false); };
  const mini = (() => {
    if (!span || !clashing.length) return null;
    const lo = Math.min(span.s.getTime(), ...clashing.map((t) => momentOf(t).getTime())) - 30 * 60000;
    const hi = Math.max(span.e.getTime(), ...clashing.map((t) => endIn(t).getTime())) + 60 * 60000;
    const pc = (d) => ((d.getTime() - lo) / (hi - lo)) * 100;
    return { pc, lo, hi };
  })();

  // ---------- notes and similar tasks ----------
  const auto = useMemo(() => (mode === 'note' || noLink || !value.trim() ? null : noteForLine(value, allNotes)), [mode, noLink, value, allNotes]);
  const linkNote = linkChosen || auto;
  const typed = words(parsed ? parsed.text : value);
  const similar = useMemo(() => {
    if (mode !== 'task' || typed.length === 0) return null;
    return upcoming.find((t) => !t.completed && !isMeeting(t) && words(t.text).some((w) => typed.includes(w))) || null;
  }, [upcoming, mode, value]); // eslint-disable-line react-hooks/exhaustive-deps
  const openTasks = useMemo(() => upcoming.filter((t) => !t.completed && !isMeeting(t) && !mTasks.some((m) => m.id === t.id)).slice(0, 5), [upcoming, mTasks]);
  const linkFixed = (() => { const s = link.trim(); if (!s) return ''; return /^https?:\/\//i.test(s) ? s : 'https://' + s; })();
  const provider = /meet\.google/i.test(linkFixed) ? 'Google Meet' : /teams\.(microsoft|live)/i.test(linkFixed) ? 'Teams' : /zoom\.us|zoom\.com/i.test(linkFixed) ? 'Zoom' : /webex/i.test(linkFixed) ? 'Webex' : linkFixed ? 'Link' : '';
  const found = useMemo(() => {
    const s = q.trim().toLowerCase();
    return allNotes.filter((n) => !s || (n.title || '').toLowerCase().includes(s)).slice(0, 4);
  }, [allNotes, q]);

  const label = (() => {
    if (!when) return null;
    if (mode === 'meeting' && when.startTime) {
      const s = at24(startOfDay(when.deadline), when.startTime);
      return `${dayWord(s)}, ${clockRange(s, at24(startOfDay(when.deadline), when.endTime))}`;
    }
    return `${dayWord(when.deadline)}${parsed?.dueTime || at ? `, ${clock(when.deadline)}` : ''}`;
  })();

  const reset = () => {
    setValue(''); setBody(''); setAtts([]); setDue(null); setPrio(null); setExtraTags([]); setTagOpen(false); setTagDraft('');
    setLinkChosen(null); setPicking(false); setQ(''); setPin(false); setMakeTasks(false); setNoLink(false);
    setLink(''); setMTasks([]); setNewTask(''); setTaskPick(false); setLen(null); setPickDate(''); setPickTime(''); setWithText(''); setRep(null); setRem(null); setOverride(null); setKeepClash(false);
  };
  const close = () => {
    reset();
    if (windowMode) window.close();
    else onClose?.();
  };

  // ---------- attachments: pick, paste, drop ----------
  const addFiles = async (list) => {
    const files = [...list].filter((f) => f && f.size !== undefined);
    if (!files.length) return;
    setStatus(files.length > 1 ? `Adding ${files.length} files…` : 'Adding…');
    const ok = [];
    for (const f of files.slice(0, 6)) {
      try { ok.push(await fileToAttachment(f)); } catch (e) { setStatus(e.message); }
    }
    if (ok.length) { setAtts((a) => [...a, ...ok].slice(0, 8)); setStatus(null); }
  };
  const onPaste = (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  };
  const onDrop = (e) => {
    if (e.dataTransfer?.files?.length) { e.preventDefault(); addFiles(e.dataTransfer.files); }
  };
  const toggleKeep = () => {
    const next = !keepOpen;
    setKeepOpen(next);
    try { localStorage.setItem('peblo-capture-keep', next ? '1' : '0'); } catch { /* ignore */ }
  };
  const addTag = (raw) => {
    const t = raw.trim().replace(/^#/, '').toLowerCase();
    if (t && !extraTags.includes(t)) setExtraTags([...extraTags, t]);
    setTagDraft('');
  };
  const addToBody = (text) => {
    setBody((b) => `${b}${b && !b.endsWith('\n') ? '\n' : ''}${text}`);
    setTimeout(() => bodyRef.current?.focus(), 20);
  };

  const save = async (e) => {
    e?.preventDefault();
    const raw = value.trim();
    if (saving) return;
    if (mode === 'note' ? !raw && !body.trim() && !atts.length : !raw) return;
    if (mode === 'meeting' && !(when && when.startTime)) {
      setStatus('Add a time, like "3pm" or "3-4pm", or pick one below, so it can sit on the river.');
      return;
    }
    setSaving(true);
    try {
      let done;
      if (mode === 'note') {
        const lines = body.split('\n');
        const title = raw || (lines.find((l) => l.trim()) || 'Quick note').replace(/^[#>\-*\s[\]x]+/i, '').slice(0, 120) || 'Quick note';
        const content = [body.trim(), attachmentMarkdown(atts)].filter(Boolean).join('\n\n');
        const tags = [...new Set([...(inbox ? ['inbox'] : []), ...extraTags])];
        const pinned = pin && allNotes.filter((n) => n.meta?.pinned && !n.isDeleted && !n.isArchived).length < 3;
        const made = (await notesAPI.create({ title, content, tags, ...(pinned ? { meta: { pinned: true } } : {}) })).data.note;
        let count = 0;
        if (makeTasks) {
          for (const l of lines) {
            const m = /^\s*[-*]\s+\[ \]\s+(.+)$/.exec(l);
            if (m) { await todosAPI.create({ text: m[1].trim().slice(0, 200), priority: 'medium', noteId: made.id }); count += 1; }
          }
        }
        done = `Saved to Notes${inbox ? ' · #inbox' : ''}${count ? ` · ${count} task${count === 1 ? '' : 's'} made` : ''}${pin && !pinned ? ' · 3 notes already pinned' : ''}`;
      } else {
        let noteId = linkNote ? linkNote.id : undefined;
        if (mode === 'task' && atts.length) {
          const md = attachmentMarkdown(atts);
          if (noteId) {
            const cur = (await notesAPI.get(noteId)).data.note;
            await notesAPI.update(noteId, { content: `${cur.content || ''}\n\n${md}` });
          } else {
            noteId = (await notesAPI.create({ title: `Attachments · ${parsed.text || raw}`.slice(0, 120), content: md, tags: ['attachments'] })).data.note.id;
          }
        }
        let deadline = when?.deadline || null;
        // A task with only a day is due at the end of it (shown at 10 pm on the river)
        if (deadline && mode === 'task' && !parsed.dueTime && !at) { deadline = new Date(deadline); deadline.setHours(23, 59, 0, 0); }
        const meta = {};
        if (mode === 'meeting' && names.length) meta.attendees = names;
        if (mode === 'meeting' && linkFixed) meta.link = linkFixed;
        if (mode === 'meeting') {
          const tied = [...mTasks];
          if (newTask.trim()) {
            const day = new Date(deadline || when.deadline); day.setHours(23, 59, 0, 0);
            const made = (await todosAPI.create({ text: newTask.trim().slice(0, 200), priority: 'medium', deadline: day.toISOString(), noteId })).data.todo;
            if (made?.id) tied.push({ id: made.id, text: made.text });
          }
          if (tied.length) meta.linkedTasks = tied.map((t) => ({ id: t.id, text: t.text }));
        }
        if (remindMin) meta.remindMin = remindMin;
        await todosAPI.create({
          text: parsed.text || raw,
          priority: (mode === 'task' && prio) || parsed.priority,
          tags: [...new Set([...(parsed.tags || []), ...(mode === 'task' ? extraTags : [])])],
          deadline: deadline ? deadline.toISOString() : null,
          startTime: mode === 'meeting' ? when.startTime : null,
          endTime: mode === 'meeting' ? when.endTime : null,
          recurrence: recurrence || 'none',
          noteId,
          meta: Object.keys(meta).length ? meta : undefined,
        });
        done = recurrence ? `On the river · ${label}, repeating` : mode === 'meeting' ? `On the river · ${label}` : deadline ? `On the river · due ${label}` : 'Added · no date yet';
      }
      queryClient.invalidateQueries({ queryKey: ['todos'] });
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      reset();
      setStatus(done);
      if (keepOpen) setTimeout(() => inputRef.current?.focus(), 30);
      else setTimeout(close, 700);
    } catch (err) {
      setStatus(err.response?.data?.error || 'Could not save. Is Peblo still running?');
    } finally {
      setSaving(false);
    }
  };

  const modes = ['meeting', 'task', 'note'];
  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab' && e.target === inputRef.current && !(mode === 'note' && value.trim())) { e.preventDefault(); setMode((m) => modes[(modes.indexOf(m) + (e.shiftKey ? 2 : 1)) % 3]); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
    else if (e.key === 'Enter' && mode === 'note' && e.target === inputRef.current) { e.preventDefault(); bodyRef.current?.focus(); }
  };

  const tagBar = (
    <>
      {extraTags.map((t) => <button key={t} type="button" className="on" onClick={() => setExtraTags(extraTags.filter((x) => x !== t))}>#{t} ×</button>)}
      {tagOpen ? (
        <input className="r-cap-tag" autoFocus aria-label="Add a tag" placeholder="tag" value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addTag(tagDraft); setTagOpen(false); } if (e.key === 'Escape') { e.stopPropagation(); setTagOpen(false); } }} onBlur={() => { if (tagDraft.trim()) addTag(tagDraft); setTagOpen(false); }} />
      ) : <button type="button" className="ghost" onClick={() => setTagOpen(true)}>+ tag</button>}
    </>
  );

  const effLen = len || (span ? Math.round(lenMs / 60000) : 60);
  const understood = mode !== 'note' && (when || names.length || linkNote || recurrence);

  return (
    <form className={`r-capture${windowMode ? ' window' : ''}`} onSubmit={save} onKeyDown={onKeyDown} onPaste={onPaste} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <div className="r-capture-top">
        <div className="r-seg" role="tablist" aria-label="What to capture">
          {modes.map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}>{m[0].toUpperCase() + m.slice(1)}</button>
          ))}
        </div>
        <span className="r-capture-status">Tab switches</span>
        <span className="grow" />
        <label className="r-cap-keep"><input type="checkbox" checked={keepOpen} onChange={toggleKeep} /> Keep open after adding</label>
        <button type="button" className="r-x" aria-label="Close" onClick={close}><X size={18} /></button>
      </div>
      <label htmlFor="r-capture-input" className="r-sr">{mode === 'note' ? 'Title' : `New ${mode}`}</label>
      <input
        id="r-capture-input"
        ref={inputRef}
        className="r-capture-input"
        value={value}
        onChange={(e) => { setValue(e.target.value); setStatus(null); setOverride(null); setKeepClash(false); }}
        placeholder={mode === 'note' ? 'Title (optional)' : mode === 'meeting' && at ? 'Meeting title, like "Client call"' : HINTS[mode]}
        autoComplete="off"
      />

      {understood && (
        <div className="r-under" aria-label="What Peblo understood">
          <span className="r-under-h">PEBLO UNDERSTOOD</span>
          <div className="r-under-row">
            <span className="r-uc b">{mode === 'meeting' ? 'Meeting' : 'Task'}</span>
            {when && <span className="r-uc b">{when.deadline.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span>}
            {mode === 'meeting' && when?.startTime && when.endTime && <span className="r-uc b">{label.split(', ').slice(1).join(', ')}</span>}
            {mode === 'task' && when && (parsed?.dueTime || at) && <span className="r-uc b">{clock(when.deadline)}</span>}
            {recurrence && <span className="r-uc b">{REPEAT_WORD[recurrence]}</span>}
            {names.length > 0 && <span className="r-uc">With {names.join(', ')}</span>}
            {remindMin ? <span className="r-uc">Remind {remindMin} min before</span> : null}
            {mode === 'task' && (prio || parsed?.priority === 'high') && <span className="r-uc">High priority</span>}
            {linkNote && <span className="r-uc">Link note: {linkNote.title || 'Untitled'}<button type="button" aria-label="Do not link that note" onClick={() => { setNoLink(true); setLinkChosen(null); }}>×</button></span>}
          </div>
        </div>
      )}

      {mode === 'meeting' && (
        <div className="r-mset" role="group" aria-label="Meeting settings">
          <div className="r-mrow grid one">
            <label>Meeting link<input type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a Google Meet, Teams or Zoom link" autoComplete="off" /></label>
          </div>
          {provider && <p className="r-capture-status">{provider === 'Link' ? 'Link added.' : provider + ' link added.'} A Join button shows on the meeting.</p>}
          <div className="r-qk" role="group" aria-label="Connect notes and tasks">
            {linkNote
              ? <button type="button" className="on" onClick={() => { setLinkChosen(null); setNoLink(true); }}>Note: {linkNote.title || 'Untitled'} ×</button>
              : <button type="button" className="ghost" onClick={() => setPicking((p) => !p)} aria-expanded={picking}>+ Connect a note</button>}
            {mTasks.map((t) => <button key={t.id} type="button" className="on" onClick={() => setMTasks(mTasks.filter((x) => x.id !== t.id))}>Task: {t.text.slice(0, 24)} ×</button>)}
            <button type="button" className="ghost" onClick={() => setTaskPick((p) => !p)} aria-expanded={taskPick}>+ Connect a task</button>
          </div>
          {taskPick && (
            <div className="r-cap-pick">
              {openTasks.map((t) => <button key={t.id} type="button" onClick={() => { setMTasks([...mTasks, { id: t.id, text: t.text }]); setTaskPick(false); }}><b>{t.text}</b><small>{t.deadline ? 'Due ' + dayWord(t.deadline).toLowerCase() : 'No date yet'}</small></button>)}
              {openTasks.length === 0 && <span className="r-quiet small">No open tasks to connect.</span>}
            </div>
          )}
          <div className="r-mrow grid one">
            <label>New task for this meeting<input value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="Prepare the agenda" autoComplete="off" /></label>
          </div>
          <div className="r-mrow">
            <span className="r-under-h">LENGTH</span>
            <div className="r-qk">
              {LENGTHS.map(([m, n]) => (
                <button key={m} type="button" className={effLen === m ? 'on' : ''} aria-pressed={effLen === m} onClick={() => { setLen(m); setOverride(null); }}>{n}</button>
              ))}
            </div>
          </div>
          <div className="r-mrow grid">
            <label>Day<input type="date" value={pickDate || (when ? ymd(when.deadline) : '')} onChange={(e) => { setPickDate(e.target.value); setOverride(null); }} /></label>
            <label>Starts<input type="time" step="900" value={pickTime || (when?.startTime || '')} onChange={(e) => { setPickTime(e.target.value); setOverride(null); }} /></label>
            <label>With<input value={withText || names.join(', ')} onChange={(e) => setWithText(e.target.value)} placeholder="Priya, Sam" autoComplete="off" /></label>
            <RSelect block label="Repeat" value={rep ?? recurrence ?? 'none'} options={REPEATS} onChange={setRep} />
            <RSelect block label="Reminder" value={rem ?? remindMin ?? 0} options={REMINDS} onChange={(v) => setRem(Number(v))} />
          </div>
        </div>
      )}

      {mode === 'task' && (
        <div className="r-qk" role="group" aria-label="Quick settings">
          {[['Today', ymd(startOfDay())], ['Tomorrow', ymd(addDays(startOfDay(), 1))], ['Next week', ymd(addDays(startOfDay(), 7))]].map(([n, v]) => (
            <button key={n} type="button" className={due === v ? 'on' : ''} aria-pressed={due === v} onClick={() => setDue(due === v ? null : v)}>{n}</button>
          ))}
          <button type="button" className={prio === 'high' ? 'on' : ''} aria-pressed={prio === 'high'} onClick={() => setPrio(prio === 'high' ? null : 'high')}>High</button>
          {tagBar}
          {linkNote
            ? <button type="button" className="on" onClick={() => { setLinkChosen(null); setNoLink(true); }}>Note: {linkNote.title || 'Untitled'} ×</button>
            : <button type="button" className="ghost" onClick={() => setPicking((p) => !p)} aria-expanded={picking}>+ Link a note</button>}
        </div>
      )}
      {mode !== 'note' && picking && !linkNote && (
        <div className="r-cap-pick">
          <label className="r-cap-search"><Search size={14} /><input autoFocus aria-label="Search notes" placeholder="Search your notes" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setPicking(false); } }} /></label>
          {found.map((n) => <button key={n.id} type="button" onClick={() => { setLinkChosen({ id: n.id, title: n.title }); setNoLink(false); setPicking(false); setQ(''); }}><b>{n.title || 'Untitled'}</b><small>{snippetOf(n.content, 50)}</small></button>)}
          {found.length === 0 && <span className="r-quiet small">No note matches.</span>}
        </div>
      )}

      {mode === 'note' && (
        <>
          <div className="r-cap-tools" role="toolbar" aria-label="Add to the note">
            <button type="button" onClick={() => { fileRef.current.accept = 'image/*'; fileRef.current.click(); setTimeout(() => { if (fileRef.current) fileRef.current.accept = ''; }, 500); }}><ImageIcon size={14} /> Photo</button>
            <button type="button" onClick={() => { if (fileRef.current) fileRef.current.accept = ''; fileRef.current?.click(); }}><Paperclip size={14} /> File</button>
            <button type="button" onClick={() => addToBody('- [ ] ')}><ListChecks size={14} /> Checklist</button>
            <button type="button" onClick={() => addToBody('## ')}><Heading1 size={14} /> Heading</button>
            <button type="button" onClick={() => addToBody('[link text](https://)')}><Link2 size={14} /> Link</button>
          </div>
          <textarea ref={bodyRef} className="r-cap-body" aria-label="Note" placeholder="A thought, a link, an idea…" value={body} onChange={(e) => { setBody(e.target.value); setStatus(null); }} rows={5} />
        </>
      )}

      {mode !== 'meeting' && (
        <div className="r-cap-attach">
          {atts.length === 0 ? (
            <button type="button" className="r-cap-drop" onClick={() => fileRef.current?.click()}>
              <span className="plus">+</span>
              <span>Drop a photo or file here, or paste with <kbd>Ctrl</kbd> <kbd>V</kbd></span>
            </button>
          ) : (
            <div className="r-cap-thumbs">
              {atts.map((a) => (
                <div key={a.id} className={`r-cap-thumb${a.isImage ? ' img' : ''}`}>
                  {a.isImage ? <img src={a.url} alt={a.name} /> : <span className="f"><b>{a.name}</b><small>{Math.max(1, Math.round(a.size / 1024))} KB</small></span>}
                  <button type="button" aria-label={`Remove ${a.name}`} onClick={() => setAtts(atts.filter((x) => x.id !== a.id))}><X size={12} strokeWidth={2.8} /></button>
                </div>
              ))}
              <button type="button" className="r-cap-more" aria-label="Add another file" onClick={() => fileRef.current?.click()}>+</button>
            </div>
          )}
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        </div>
      )}

      {mode === 'note' && (
        <div className="r-qk" role="group" aria-label="Save options">
          <span className="r-under-h">SAVE TO</span>
          <button type="button" className={inbox ? 'on' : ''} aria-pressed={inbox} onClick={() => setInbox(!inbox)}>Inbox</button>
          {tagBar}
          <button type="button" className={pin ? 'on' : 'ghost'} aria-pressed={pin} onClick={() => setPin(!pin)}>Pin to Home</button>
          <button type="button" className={makeTasks ? 'on' : 'ghost'} aria-pressed={makeTasks} onClick={() => setMakeTasks(!makeTasks)}>Make tasks from checklist</button>
        </div>
      )}

      {similar && (
        <p className="r-cap-similar"><b>Looks similar:</b> “{similar.text}” is already due {similar.deadline ? dayWord(similar.deadline).toLowerCase() : 'sometime'}.</p>
      )}

      {mini && !keepClash && (
        <div className="r-clash" role="alert">
          <b>Clash: you already have {clashing.map((t) => '“' + t.text + '”').join(' and ')} at {clockRange(momentOf(clashing[0]), endIn(clashing[0]))}</b>
          <div className="r-mini" aria-hidden="true">
            {clashing.map((t) => (
              <span key={t.id} className="m" style={{ left: mini.pc(momentOf(t)) + '%', width: (mini.pc(endIn(t)) - mini.pc(momentOf(t))) + '%' }}>{t.text}</span>
            ))}
            <span className="n" style={{ left: mini.pc(span.s) + '%', width: (mini.pc(span.e) - mini.pc(span.s)) + '%' }}>New · {clock(span.s)}</span>
          </div>
          <div className="slots">
            {slots.map((g, i) => <button key={g.s.getTime()} type="button" className={`r-btn small${i ? ' ghost' : ''}`} onClick={() => pickSlot(g)}>{i === 0 ? `Move to ${clock(g.s)}` : `${clock(g.s)} (free)`}</button>)}
            {otherDays.map((g) => <button key={g.s.getTime()} type="button" className="r-btn ghost small" onClick={() => pickSlot(g)}>{dayWord(g.s)} {clock(g.s)} (free)</button>)}
            <button type="button" className="r-btn ghost small" onClick={() => setKeepClash(true)}>Keep {clock(span.s)} anyway</button>
          </div>
        </div>
      )}
      {mini && keepClash && <p className="r-capture-status">Keeping {clock(span.s)}, overlapping {clashing.map((t) => '“' + t.text + '”').join(' and ')}.</p>}
      {override && !clashing.length && <p className="r-capture-status">Moved to {dayWord(override.s)}, {clock(override.s)}, which is free.</p>}

      <div className="r-capture-foot">
        <span className="r-capture-status" role="status">
          {status || (label ? `${mode === 'meeting' ? 'Meeting' : 'Due'} ${label}${parsed?.tags?.length ? ` · #${parsed.tags.join(' #')}` : ''}` : mode === 'note' ? 'Ctrl Enter saves · Esc closes' : 'Enter adds · Esc closes · try "friday 4pm", "!high" or "#tag"')}
        </span>
        <span className="grow" />
        <button type="submit" className="r-btn" disabled={saving || (mode === 'note' ? !value.trim() && !body.trim() && !atts.length : !value.trim())}>{saving ? 'Saving…' : mode === 'note' ? 'Save note' : mode === 'meeting' ? 'Add meeting' : 'Put on the river'}</button>
      </div>
    </form>
  );
}
