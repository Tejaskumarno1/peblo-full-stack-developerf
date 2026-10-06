import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { notesAPI, todosAPI } from '../api';
import { parseTask } from '../utils/parseTask';
import { dayWord } from '../river/riverUtils';
import { topicName } from './orbitUtils';
import './orbit.css';

/**
 * Orbit capture card: a note or a task, dropped on a topic.
 * Opened from the + button and the map tools, and as the Ctrl+Shift+Space window.
 */
export default function OrbitCapture({ onClose, preset = {}, windowMode = false }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState(preset.mode || 'note');
  const [value, setValue] = useState('');
  const [topic, setTopic] = useState(preset.tag || null);
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

  const parsed = value.trim() ? parseTask(value) : null;
  const tags = [...new Set([...(topic ? [topic] : []), ...(parsed?.tags || [])])];

  const close = () => {
    setValue('');
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
        let deadline = parsed.deadline ? new Date(parsed.deadline) : null;
        if (deadline) deadline.setHours(23, 59, 0, 0);
        await todosAPI.create({ text: parsed.text || raw, priority: parsed.priority, tags, deadline: deadline ? deadline.toISOString() : null });
        setStatus(`Task added${tags[0] ? ` to ${topicName(tags[0])}` : ''}${deadline ? ` · due ${dayWord(deadline).toLowerCase()}` : ''}`);
      } else {
        const text = ` ${raw}`.replace(/\s#[\p{L}\p{N}_-]+/gu, ' ').replace(/\s+/g, ' ').trim();
        await notesAPI.create({ title: text.slice(0, 120) || 'Quick note', content: '', tags: tags.length ? tags : ['inbox'] });
        setStatus(tags[0] ? `On the map in ${topicName(tags[0])}` : 'Saved · tag it to put it on the map');
      }
      queryClient.invalidateQueries({ queryKey: ['todos'] });
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      setValue('');
      setTimeout(close, 700);
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
    <form className={`o-capture${windowMode ? ' window' : ''}`} onSubmit={save} onKeyDown={onKeyDown}>
      <div className="o-capture-top">
        <div className="o-seg" role="tablist" aria-label="What to capture">
          <button type="button" role="tab" aria-selected={mode === 'note'} onClick={() => setMode('note')}>Note</button>
          <button type="button" role="tab" aria-selected={mode === 'task'} onClick={() => setMode('task')}>Task</button>
        </div>
        {topic && (
          <span className="o-chip" style={{ height: 30 }}>
            {topicName(topic)}
            <button type="button" aria-label="Not on this topic" onClick={() => setTopic(null)} style={{ border: 'none', background: 'transparent', display: 'flex', cursor: 'pointer', padding: 0 }}><X size={13} /></button>
          </span>
        )}
        <span className="grow" />
        <button type="button" className="o-x" style={{ margin: 0 }} aria-label="Close" onClick={close}><X size={18} /></button>
      </div>
      <label htmlFor="o-capture-input" className="o-sr">{mode === 'task' ? 'What do you need to do?' : 'What did you learn?'}</label>
      <input
        id="o-capture-input"
        ref={inputRef}
        className="o-capture-input"
        value={value}
        onChange={(e) => { setValue(e.target.value); setStatus(null); }}
        placeholder={mode === 'task' ? 'Solve PYQ 2024 Q3 tomorrow #normalization' : 'BCNF: every determinant is a key #normalization'}
        autoComplete="off"
      />
      <div className="o-capture-foot">
        <span className="o-capture-status" role="status">
          {status || (tags.length ? `Goes on ${tags.map(topicName).join(', ')}` : 'Add #topic to put it on the map · Tab switches · Esc closes')}
        </span>
        <span className="grow" />
        <button type="submit" className="o-btn small" disabled={!value.trim() || saving}>{saving ? 'Saving…' : mode === 'task' ? 'Add task' : 'Save note'}</button>
      </div>
    </form>
  );
}
