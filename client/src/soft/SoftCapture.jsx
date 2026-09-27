import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { notesAPI, todosAPI } from '../api';
import { parseTask } from '../utils/parseTask';
import { dayChip, timeOf, startOfDay, addDays } from './softUtils';
import './soft.css';

const words = (s) => (s || '').toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || [];

/**
 * Soft Studio quick capture card (mockup: SoftCapture).
 * Used as a pop-up from the dock, and as the whole Ctrl+Shift+Space window.
 */
export default function SoftCapture({ onClose, windowMode = false }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState('task');
  const [value, setValue] = useState('');
  const [linkNote, setLinkNote] = useState(null);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  const from = startOfDay();
  const { data: upcoming = [] } = useQuery({
    queryKey: ['todos', 'range', 'soft-capture', from.toDateString()],
    queryFn: () => todosAPI.getRange(addDays(from, -7).toISOString(), addDays(from, 30).toISOString()).then((r) => r.data.todos || []),
    staleTime: 30000,
  });
  const { data: notes = [] } = useQuery({
    queryKey: ['notes', 'sidebar'],
    queryFn: () => notesAPI.getAll({ sort: 'updated' }).then((r) => r.data.notes || []),
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

  const parsed = mode === 'task' && value.trim() ? parseTask(value) : null;
  const typed = words(parsed ? parsed.text : value);

  // A note whose title shares a word with the task, to link it.
  const suggestion = useMemo(() => {
    if (mode !== 'task' || !typed.length) return null;
    return notes.find((n) => words(n.title).some((w) => typed.includes(w))) || null;
  }, [notes, mode, value]); // eslint-disable-line react-hooks/exhaustive-deps

  // An open task that looks like the one being typed.
  const similar = useMemo(() => {
    if (mode !== 'task' || typed.length === 0) return null;
    return upcoming.find((t) => !t.completed && words(t.text).some((w) => typed.includes(w))) || null;
  }, [upcoming, mode, value]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    setValue('');
    setLinkNote(null);
    if (windowMode) window.close();
    else onClose?.();
  };

  const save = async (e) => {
    e?.preventDefault();
    const raw = value.trim();
    if (!raw || saving) return;
    setSaving(true);
    try {
      if (mode === 'task') {
        const t = parseTask(raw);
        await todosAPI.create({
          text: t.text || raw,
          priority: t.priority,
          tags: t.tags,
          deadline: t.deadline ? t.deadline.toISOString() : null,
          noteId: linkNote?.id || undefined,
        });
        setStatus(t.deadline ? `Added · due ${dayChip(t.deadline)}, ${timeOf({ deadline: t.deadline })}` : 'Added to your tasks');
      } else {
        const [first, ...rest] = raw.split('\n');
        await notesAPI.create({ title: first.slice(0, 120) || 'Quick note', content: rest.join('\n'), tags: ['inbox'] });
        setStatus('Saved to Notes · #inbox');
      }
      queryClient.invalidateQueries({ queryKey: ['todos'] });
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setValue('');
      setLinkNote(null);
      setTimeout(close, 650);
    } catch (err) {
      setStatus(err.response?.data?.error || 'Could not save. Is Peblo still running?');
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') { e.preventDefault(); setMode((m) => (m === 'task' ? 'note' : 'task')); }
  };

  return (
    <form className={`s-capture${windowMode ? ' window' : ''}`} onSubmit={save} onKeyDown={onKeyDown}>
      <div className="s-capture-top">
        <div className="s-capture-seg" role="tablist" aria-label="What to capture">
          <button type="button" role="tab" aria-selected={mode === 'task'} className={mode === 'task' ? 'on' : ''} onClick={() => setMode('task')}>Task</button>
          <button type="button" role="tab" aria-selected={mode === 'note'} className={mode === 'note' ? 'on' : ''} onClick={() => setMode('note')}>Note</button>
        </div>
        <span className="s-capture-hint">Tab switches</span>
        <span className="grow" />
        <button type="button" className="s-capture-close" aria-label="Close" onClick={close}><X size={16} strokeWidth={2.4} /></button>
      </div>

      <label htmlFor="s-capture-input" className="s-sr">{mode === 'task' ? 'What do you need to do?' : "What's on your mind?"}</label>
      <input
        id="s-capture-input"
        ref={inputRef}
        className="s-capture-input"
        value={value}
        onChange={(e) => { setValue(e.target.value); setStatus(null); }}
        placeholder={mode === 'task' ? 'Revise BCNF tomorrow !high #exams' : 'A thought, a link, an idea…'}
        autoComplete="off"
      />

      {(parsed || mode === 'note' || suggestion) && (
        <div className="s-capture-chips">
          {parsed?.deadline && <span className="s-tag" style={{ background: 'var(--s-mint)' }}>{dayChip(parsed.deadline)}, {timeOf({ deadline: parsed.deadline })}</span>}
          {parsed && parsed.priority !== 'medium' && <span className="s-tag" style={{ background: 'var(--s-peach)' }}>{parsed.priority === 'high' ? 'High' : 'Low'}</span>}
          {parsed?.tags.map((t) => <span key={t} className="s-tag" style={{ background: 'var(--s-butter)' }}>#{t}</span>)}
          {mode === 'note' && <span className="s-tag" style={{ background: 'var(--s-butter)' }}>#inbox</span>}
          {suggestion && (
            <button type="button" className={`s-capture-link${linkNote ? ' on' : ''}`} onClick={() => setLinkNote(linkNote ? null : suggestion)}>
              {linkNote ? `Linked to ${suggestion.title || 'Untitled'}` : `+ Link ${suggestion.title || 'Untitled'}`}
            </button>
          )}
        </div>
      )}

      {similar && (
        <div className="s-capture-similar">
          <span className="blob" aria-hidden="true" />
          <span className="grow"><strong>Looks similar:</strong> "{similar.text}" is already due {dayChip(similar.deadline || new Date()).toLowerCase()}{timeOf(similar) ? ` at ${timeOf(similar)}` : ''}.</span>
          {!windowMode && <button type="button" className="s-capture-open" onClick={() => { close(); navigate('/tasks'); }}>Open it</button>}
        </div>
      )}

      <div className="s-capture-foot">
        <span className={`s-capture-status${status ? ' on' : ''}`} role="status">{status || 'Enter adds · Esc closes · try "friday", "!low" or "#tag"'}</span>
        <span className="grow" />
        <button type="submit" className="s-capture-add" disabled={!value.trim() || saving}>{saving ? 'Saving…' : mode === 'task' ? 'Add task' : 'Save note'}</button>
      </div>
    </form>
  );
}
