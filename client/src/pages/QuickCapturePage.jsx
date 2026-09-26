import { useEffect, useRef, useState } from 'react';
import { FileText, CheckSquare, CornerDownLeft } from 'lucide-react';
import { notesAPI, todosAPI } from '../api';
import '../styles/quick-capture.css';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Pulls simple shortcuts out of a task line:
 *   "call mom tomorrow !high #family" → text "call mom", due tomorrow, high priority, tag family
 * Supports: today, tonight, tomorrow, weekday names ("friday", "next monday"), !high/!low, #tags.
 */
export function parseTask(input) {
  let text = ` ${input.trim()} `;
  let priority = 'medium';
  const tags = [];
  let deadline = null;

  text = text.replace(/\s!(high|h|urgent|low|l|medium|med|m)\b/gi, (_, p) => {
    const v = p.toLowerCase();
    priority = v.startsWith('h') || v === 'urgent' ? 'high' : v.startsWith('l') ? 'low' : 'medium';
    return ' ';
  });
  text = text.replace(/\s#([\p{L}\p{N}_-]+)/gu, (_, t) => { tags.push(t.toLowerCase()); return ' '; });

  const now = new Date();
  const at = (d) => { const x = new Date(d); x.setHours(17, 0, 0, 0); return x; };
  text = text.replace(/\s(today|tonight)\b/i, () => { deadline = at(now); return ' '; });
  text = text.replace(/\s(tomorrow|tmrw|tmr)\b/i, () => { const d = new Date(now); d.setDate(d.getDate() + 1); deadline = at(d); return ' '; });
  text = text.replace(/\s(?:on\s|next\s)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i, (m, day) => {
    const target = WEEKDAYS.indexOf(day.toLowerCase());
    const d = new Date(now);
    let diff = (target - d.getDay() + 7) % 7;
    if (diff === 0 || /next/i.test(m)) diff += diff === 0 ? 7 : 0;
    d.setDate(d.getDate() + diff);
    deadline = at(d);
    return ' ';
  });

  return { text: text.replace(/\s+/g, ' ').trim(), priority, tags, deadline };
}

export default function QuickCapturePage() {
  const [mode, setMode] = useState('note'); // 'note' | 'task'
  const [value, setValue] = useState('');
  const [status, setStatus] = useState(null); // { ok, text }
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  // Each time the window is shown again, start fresh and focus the box.
  useEffect(() => {
    document.title = 'Quick capture';
    document.body.classList.add('quick-capture-body');
    const reset = () => {
      if (document.visibilityState === 'visible') {
        setStatus(null);
        setTimeout(() => inputRef.current?.focus(), 30);
      }
    };
    document.addEventListener('visibilitychange', reset);
    window.addEventListener('focus', reset);
    reset();
    return () => {
      document.removeEventListener('visibilitychange', reset);
      window.removeEventListener('focus', reset);
      document.body.classList.remove('quick-capture-body');
    };
  }, []);

  const close = () => window.close();

  const save = async () => {
    const raw = value.trim();
    if (!raw || saving) return;
    setSaving(true);
    try {
      if (mode === 'task') {
        const t = parseTask(raw.split('\n')[0]);
        await todosAPI.create({
          text: t.text || raw,
          priority: t.priority,
          tags: t.tags,
          deadline: t.deadline ? t.deadline.toISOString() : null,
        });
        const due = t.deadline ? ` · due ${t.deadline.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}` : '';
        setStatus({ ok: true, text: `Task added${due}` });
      } else {
        const [first, ...rest] = raw.split('\n');
        const title = first.replace(/^#+\s*/, '').slice(0, 120) || 'Quick note';
        await notesAPI.create({ title, content: rest.join('\n').trim(), tags: ['inbox'] });
        setStatus({ ok: true, text: 'Saved to Notes (tagged "inbox")' });
      }
      setValue('');
      setTimeout(close, 700);
    } catch (err) {
      setStatus({ ok: false, text: err.response?.data?.error || 'Could not save. Is Peblo still running?' });
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') { e.preventDefault(); setMode((m) => (m === 'note' ? 'task' : 'note')); }
    else if (e.key === 'Enter' && (mode === 'task' || e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
  };

  const preview = mode === 'task' && value.trim() ? parseTask(value) : null;

  return (
    <div className="qc-root">
      <div className="qc-header">
        <div className="qc-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'note'} className={mode === 'note' ? 'active' : ''} onClick={() => { setMode('note'); inputRef.current?.focus(); }}>
            <FileText size={14} /> Note
          </button>
          <button type="button" role="tab" aria-selected={mode === 'task'} className={mode === 'task' ? 'active' : ''} onClick={() => { setMode('task'); inputRef.current?.focus(); }}>
            <CheckSquare size={14} /> Task
          </button>
        </div>
        <span className="qc-hint">Tab to switch · Esc to close</span>
      </div>

      <textarea
        ref={inputRef}
        className="qc-input"
        value={value}
        onChange={(e) => { setValue(e.target.value); setStatus(null); }}
        onKeyDown={onKeyDown}
        placeholder={mode === 'task' ? 'Call the bank tomorrow !high #finance' : 'First line is the title…\nThe rest becomes the note.'}
        rows={mode === 'task' ? 1 : 3}
        spellCheck
        autoFocus
      />

      <div className="qc-footer">
        <span className={`qc-status ${status ? (status.ok ? 'ok' : 'error') : ''}`}>
          {status
            ? status.text
            : preview
              ? [preview.deadline && `Due ${preview.deadline.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`, preview.priority !== 'medium' && `${preview.priority} priority`, preview.tags.length && preview.tags.map((t) => `#${t}`).join(' ')].filter(Boolean).join(' · ') || 'Tip: add "tomorrow", "friday", !high or #tag'
              : mode === 'note' ? 'Ctrl+Enter to save' : ''}
        </span>
        <button type="button" className="qc-save" onClick={save} disabled={!value.trim() || saving}>
          {saving ? 'Saving…' : <>Save <CornerDownLeft size={13} /></>}
        </button>
      </div>
    </div>
  );
}
