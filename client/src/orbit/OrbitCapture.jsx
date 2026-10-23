import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { notesAPI, todosAPI } from '../api';
import { parseTask } from '../utils/parseTask';
import { dayWord, parseTimes, startOfDay } from '../river/riverUtils';
import { fileToAttachment, attachmentMarkdown } from '../utils/imageData';
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
  const [keepOpen, setKeepOpen] = useState(() => { try { return localStorage.getItem('peblo-capture-keep') === '1'; } catch { return false; } });
  const toggleKeep = () => { const next = !keepOpen; setKeepOpen(next); try { localStorage.setItem('peblo-capture-keep', next ? '1' : '0'); } catch { /* no storage */ } };

  useEffect(() => { inputRef.current?.focus(); }, [mode]);
  useEffect(() => {
    if (!windowMode) return undefined;
    const reset = () => { if (document.visibilityState === 'visible') { setStatus(null); setTimeout(() => inputRef.current?.focus(), 30); } };
    window.addEventListener('focus', reset);
    document.addEventListener('visibilitychange', reset);
    return () => { window.removeEventListener('focus', reset); document.removeEventListener('visibilitychange', reset); };
  }, [windowMode]);

  const [atts, setAtts] = useState([]);
  const fileRef = useRef(null);
  const addFiles = async (files) => {
    const ok = [];
    for (const f of files) { try { ok.push(await fileToAttachment(f)); } catch (e) { setStatus(e.message); } }
    if (ok.length) setAtts((a) => [...a, ...ok]);
  };
  const onPaste = (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  };

  const times = mode === 'meeting' && value.trim() ? parseTimes(value) : null;
  const parsed = value.trim() ? parseTask(times ? times.text : value) : null;
  const meetingAt = () => {
    const now = new Date();
    const day = parsed?.deadline ? new Date(parsed.deadline) : new Date();
    let start = times?.startTime;
    if (!start) { const r = new Date(Math.ceil((now.getTime() + 60000) / 900000) * 900000); start = String(r.getHours()).padStart(2, '0') + ':' + String(r.getMinutes()).padStart(2, '0'); }
    let end = times?.endTime;
    if (!end || end <= start) { const [h, m] = start.split(':').map(Number); const tot = Math.min(h * 60 + m + 60, 23 * 60 + 59); end = String(Math.floor(tot / 60)).padStart(2, '0') + ':' + String(tot % 60).padStart(2, '0'); }
    return { day: startOfDay(day), start, end };
  };
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
        await todosAPI.create({ text: parsed.text || raw, priority: parsed.priority, tags, deadline: deadline ? deadline.toISOString() : null });
        setStatus(`Task added${tags[0] ? ` to ${topicName(tags[0])}` : ''}${deadline ? ` · due ${dayWord(deadline).toLowerCase()}` : ''}`);
      } else if (mode === 'meeting') {
        const m = meetingAt();
        await todosAPI.create({ text: (parsed.text || raw).slice(0, 200), priority: parsed.priority, tags, deadline: m.day.toISOString(), startTime: m.start, endTime: m.end });
        setStatus(`Meeting added · ${dayWord(m.day).toLowerCase()} ${m.start}–${m.end}`);
      } else {
        const text = ` ${raw}`.replace(/\s#[\p{L}\p{N}_-]+/gu, ' ').replace(/\s+/g, ' ').trim();
        await notesAPI.create({ title: text.slice(0, 120) || 'Quick note', content: atts.length ? attachmentMarkdown(atts) : '', tags: tags.length ? tags : ['inbox'] });
        setAtts([]);
        setStatus(tags[0] ? `On the map in ${topicName(tags[0])}` : 'Saved · tag it to put it on the map');
      }
      queryClient.invalidateQueries({ queryKey: ['todos'] });
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      setValue('');
      if (keepOpen) setTimeout(() => inputRef.current?.focus(), 30);
      else setTimeout(close, 700);
    } catch (err) {
      setStatus(err.response?.data?.error || 'Could not save. Is Peblo still running?');
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') { e.preventDefault(); setMode((m) => (m === 'note' ? 'task' : m === 'task' ? 'meeting' : 'note')); }
  };

  return (
    <form className={`o-capture${windowMode ? ' window' : ''}`} onSubmit={save} onKeyDown={onKeyDown}>
      <div className="o-capture-top">
        <div className="o-seg" role="tablist" aria-label="What to capture">
          <button type="button" role="tab" aria-selected={mode === 'note'} onClick={() => setMode('note')}>Note</button>
          <button type="button" role="tab" aria-selected={mode === 'task'} onClick={() => setMode('task')}>Task</button>
          <button type="button" role="tab" aria-selected={mode === 'meeting'} onClick={() => setMode('meeting')}>Meeting</button>
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
      <label htmlFor="o-capture-input" className="o-sr">{mode === 'task' ? 'What do you need to do?' : mode === 'meeting' ? 'What is the meeting?' : 'What did you learn?'}</label>
      <input
        id="o-capture-input"
        ref={inputRef}
        className="o-capture-input"
        value={value}
        onChange={(e) => { setValue(e.target.value); setStatus(null); }}
        onPaste={onPaste}
        placeholder={mode === 'task' ? 'Solve PYQ 2024 Q3 tomorrow #normalization' : mode === 'meeting' ? 'Study group tomorrow 4-5pm #normalization' : 'BCNF: every determinant is a key #normalization'}
        autoComplete="off"
      />
      {mode === 'note' && (
        <div className="o-attach">
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles([...e.target.files]); e.target.value = ''; }} />
          <button type="button" className="o-btn ghost small" onClick={() => fileRef.current?.click()}>Attach a picture</button>
          {atts.map((a, i) => (
            <span key={i} className="o-chip">{a.name || 'picture'} <button type="button" aria-label="Remove picture" onClick={() => setAtts(atts.filter((_, j) => j !== i))} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, display: 'flex' }}><X size={13} /></button></span>
          ))}
        </div>
      )}
      {tags.length > 0 && (
        <div className="o-attach" aria-label="Topics">
          {tags.map((t) => <span key={t} className="o-chip">#{t}</span>)}
        </div>
      )}
      <div className="o-capture-foot">
        <span className="o-capture-status" role="status">
          {status || (mode === 'meeting' && parsed ? (() => { const m = meetingAt(); return `Meeting · ${dayWord(m.day).toLowerCase()} ${m.start}–${m.end}`; })() : mode === 'task' && parsed && (parsed.deadline || parsed.priority !== 'medium') ? `Task${parsed.deadline ? ` · due ${dayWord(parsed.deadline).toLowerCase()}` : ''}${parsed.priority !== 'medium' ? ` · ${parsed.priority} priority` : ''}${tags.length ? ` · on ${tags.map(topicName).join(', ')}` : ''}` : tags.length ? `Goes on ${tags.map(topicName).join(', ')}` : 'Add #topic to put it on the map · Tab switches · Esc closes')}
        </span>
        <span className="grow" />
        <label className="o-keep"><input type="checkbox" checked={keepOpen} onChange={toggleKeep} /> Keep open after adding</label>
        <button type="submit" className="o-btn small" disabled={!value.trim() || saving}>{saving ? 'Saving…' : mode === 'task' ? 'Add task' : mode === 'meeting' ? 'Add meeting' : 'Save note'}</button>
      </div>
    </form>
  );
}
