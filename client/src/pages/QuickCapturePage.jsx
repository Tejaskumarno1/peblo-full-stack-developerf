import { useEffect, useRef, useState } from 'react';
import { FileText, CheckSquare } from 'lucide-react';
import { notesAPI, todosAPI } from '../api';
import { parseTask } from '../utils/parseTask';
import '../styles/quick-capture.css';
import { useAuth } from '../context/AuthContext';
import SoftCapture from '../soft/SoftCapture';
import RiverCapture from '../river/RiverCapture';
import OrbitCapture from '../orbit/OrbitCapture';

/** Ctrl+Shift+Space window: Soft Studio has its own capture card. */
export default function QuickCaptureWindow() {
  const { uiStyle } = useAuth();
  if (uiStyle === 'soft') {
    return <div className="soft soft-window"><SoftCapture windowMode /></div>;
  }
  if (uiStyle === 'river') {
    return <div className="river river-window"><RiverCapture windowMode /></div>;
  }
  if (uiStyle === 'orbit') {
    return <div className="orbit orbit-window"><OrbitCapture windowMode /></div>;
  }
  return <QuickCapturePage />;
}

function QuickCapturePage() {
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

      {preview && (preview.deadline || preview.priority !== 'medium' || preview.tags.length > 0) && (
        <div className="qc-chips">
          {preview.deadline && <span className="qc-chip accent">{preview.deadline.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · {preview.deadline.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}</span>}
          {preview.priority !== 'medium' && <span className={`qc-chip ${preview.priority === 'high' ? 'danger' : ''}`}>{preview.priority === 'high' ? 'High priority' : 'Low priority'}</span>}
          {preview.tags.map((t) => <span key={t} className="qc-chip">#{t}</span>)}
        </div>
      )}

      <div className="qc-footer">
        <span className={`qc-status ${status ? (status.ok ? 'ok' : 'error') : ''}`}>
          {status
            ? status.text
            : mode === 'task'
              ? 'Try "tomorrow", "friday", !high or #tag · understood on this device'
              : 'First line is the title · Ctrl+Enter to save'}
        </span>
        <button type="button" className="qc-cancel" onClick={close}>Cancel</button>
        <button type="button" className="qc-save" onClick={save} disabled={!value.trim() || saving}>
          {saving ? 'Saving…' : <>{mode === 'task' ? 'Add task' : 'Save note'} <span className="qc-kbd">{mode === 'task' ? 'Enter' : 'Ctrl Enter'}</span></>}
        </button>
      </div>
    </div>
  );
}
