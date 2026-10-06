import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { notesAPI, todosAPI } from '../api';
import { parseTask } from '../utils/parseTask';
import { parseTimes, dayWord, clock, clockRange } from './riverUtils';
import './river.css';

const HINTS = {
  meeting: 'Design crit tomorrow 3-4pm #work',
  task: 'Send metrics to Ananya tuesday 10am !high',
  note: 'A thought, a decision, a link…',
};

/** Turns a line into the date and times it mentions (today if only a time is given). */
function readLine(raw, mode) {
  const times = parseTimes(raw);
  const t = parseTask(times.text);
  let day = t.deadline ? new Date(t.deadline) : null;
  if (!day && times.startTime) day = new Date();
  let deadline = null;
  if (day) {
    deadline = new Date(day);
    if (times.startTime) {
      const [h, m] = times.startTime.split(':').map(Number);
      deadline.setHours(h, m, 0, 0);
    } else if (mode === 'task' && !t.deadline) {
      deadline = null;
    }
  }
  return { ...t, deadline, startTime: mode === 'meeting' ? times.startTime : null, endTime: mode === 'meeting' ? times.endTime : null, dueTime: mode === 'task' ? times.startTime : null };
}

/**
 * River capture card: a meeting, a task or a note, in one line.
 * Opened from the + button, from a double-click on the river (with the time filled in),
 * and as the Ctrl+Shift+Space window.
 */
export default function RiverCapture({ onClose, preset = {}, windowMode = false }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState(preset.mode || 'task');
  const [value, setValue] = useState(preset.text || '');
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, [mode]);
  useEffect(() => {
    if (!windowMode) return undefined;
    const reset = () => { if (document.visibilityState === 'visible') { setStatus(null); setTimeout(() => inputRef.current?.focus(), 30); } };
    window.addEventListener('focus', reset);
    document.addEventListener('visibilitychange', reset);
    return () => { window.removeEventListener('focus', reset); document.removeEventListener('visibilitychange', reset); };
  }, [windowMode]);

  // A time picked on the river wins over what the line says.
  const at = preset.at ? new Date(preset.at) : null;
  const parsed = value.trim() && mode !== 'note' ? readLine(value, mode) : null;
  let when = null;
  if (parsed) {
    if (at && !parsed.deadline) {
      const s = new Date(at);
      if (mode === 'meeting') {
        const e = new Date(s.getTime() + 60 * 60000);
        when = { deadline: s, startTime: s.toTimeString().slice(0, 5), endTime: e.toTimeString().slice(0, 5) };
      } else {
        when = { deadline: s };
      }
    } else if (parsed.deadline) {
      when = { deadline: parsed.deadline, startTime: parsed.startTime, endTime: parsed.endTime };
    }
  }

  const label = (() => {
    if (!when) return null;
    if (mode === 'meeting' && when.startTime) {
      const s = when.deadline;
      const [eh, em] = when.endTime.split(':').map(Number);
      const e = new Date(s); e.setHours(eh, em, 0, 0);
      return `${dayWord(s)}, ${clockRange(s, e)}`;
    }
    return `${dayWord(when.deadline)}${parsed?.dueTime || at ? `, ${clock(when.deadline)}` : ''}`;
  })();

  const close = () => {
    setValue('');
    if (windowMode) window.close();
    else onClose?.();
  };

  const save = async (e) => {
    e?.preventDefault();
    const raw = value.trim();
    if (!raw || saving) return;
    if (mode === 'meeting' && !(when && when.startTime)) {
      setStatus('Add a time, like "3pm" or "3-4pm", so it can sit on the river.');
      return;
    }
    setSaving(true);
    try {
      if (mode === 'note') {
        const [first, ...rest] = raw.split('\n');
        await notesAPI.create({ title: first.slice(0, 120) || 'Quick note', content: rest.join('\n'), tags: ['inbox'] });
        setStatus('Saved to Notes');
      } else {
        let deadline = when?.deadline || null;
        // A task with only a day is due at the end of it (shown at 10 pm on the river)
        if (deadline && mode === 'task' && !parsed.dueTime && !at) { deadline = new Date(deadline); deadline.setHours(23, 59, 0, 0); }
        await todosAPI.create({
          text: parsed.text || raw,
          priority: parsed.priority,
          tags: parsed.tags,
          deadline: deadline ? deadline.toISOString() : null,
          startTime: mode === 'meeting' ? when.startTime : null,
          endTime: mode === 'meeting' ? when.endTime : null,
        });
        setStatus(mode === 'meeting' ? `On the river · ${label}` : deadline ? `On the river · due ${label}` : 'Added · no date yet');
      }
      queryClient.invalidateQueries({ queryKey: ['todos'] });
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setValue('');
      setTimeout(close, 650);
    } catch (err) {
      setStatus(err.response?.data?.error || 'Could not save. Is Peblo still running?');
    } finally {
      setSaving(false);
    }
  };

  const modes = ['meeting', 'task', 'note'];
  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') { e.preventDefault(); setMode((m) => modes[(modes.indexOf(m) + (e.shiftKey ? 2 : 1)) % 3]); }
  };

  return (
    <form className={`r-capture${windowMode ? ' window' : ''}`} onSubmit={save} onKeyDown={onKeyDown}>
      <div className="r-capture-top">
        <div className="r-seg" role="tablist" aria-label="What to capture">
          {modes.map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}>{m[0].toUpperCase() + m.slice(1)}</button>
          ))}
        </div>
        <span className="r-capture-status">Tab switches</span>
        <span className="grow" />
        <button type="button" className="r-x" aria-label="Close" onClick={close}><X size={18} /></button>
      </div>
      <label htmlFor="r-capture-input" className="r-sr">{mode === 'note' ? "What's on your mind?" : `New ${mode}`}</label>
      <input
        id="r-capture-input"
        ref={inputRef}
        className="r-capture-input"
        value={value}
        onChange={(e) => { setValue(e.target.value); setStatus(null); }}
        placeholder={HINTS[mode]}
        autoComplete="off"
      />
      <div className="r-capture-foot">
        <span className="r-capture-status" role="status">
          {status || (label ? `${mode === 'meeting' ? 'Meeting' : 'Due'} ${label}${parsed?.tags?.length ? ` · #${parsed.tags.join(' #')}` : ''}` : mode === 'note' ? 'Lands on the river at the time you write it' : 'Enter adds · Esc closes · try "friday 4pm", "!high" or "#tag"')}
        </span>
        <span className="grow" />
        <button type="submit" className="r-btn" disabled={!value.trim() || saving}>{saving ? 'Saving…' : mode === 'note' ? 'Save note' : 'Put on the river'}</button>
      </div>
    </form>
  );
}
