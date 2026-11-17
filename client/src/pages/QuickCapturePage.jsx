import { useEffect, useRef, useState } from 'react';
import { FileText, CheckSquare } from 'lucide-react';
import { notesAPI, todosAPI, profileAPI } from '../api';
import { applyAccent, normHex, applyThemeClasses, resolveNow, normalizeSchedule, applyTextAndColourPrefs } from '../utils/appearance';
import { parseTask } from '../utils/parseTask';
import '../styles/quick-capture.css';
import { useAuth } from '../context/AuthContext';
import SoftCapture from '../soft/SoftCapture';
import RiverCapture from '../river/RiverCapture';
import OrbitCapture from '../orbit/OrbitCapture';

/** Ctrl+Shift+Space window: Soft Studio has its own capture card. */
export default function QuickCaptureWindow() {
  const { uiStyle: localStyle } = useAuth();
  const acctStyle = useAccountAppearance();
  const uiStyle = acctStyle || localStyle;
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

const STYLES = ['soft', 'river', 'orbit', 'studio', 'console'];
/**
 * The capture window stays open in the background between uses, so a theme, accent or style changed on another device
 * (or while the storage event was missed) would not reach it. Each time it is shown it reads the account and applies
 * them at once. Returns the account's style ('' until known).
 */
function useAccountAppearance() {
  const [style, setStyle] = useState('');
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const { data } = await profileAPI.me();
        const s = data?.user?.settings || {};
        if (!alive) return;
        if (['light', 'dark', 'midnight', 'system', 'auto'].includes(s.theme)) applyThemeClasses(resolveNow(s.theme, s.themeSchedule ? normalizeSchedule(s.themeSchedule) : null));
        applyAccent(normHex(s.accent));
        applyTextAndColourPrefs(s);
        if (STYLES.includes(s.uiStyle)) {
          setStyle(s.uiStyle);
          for (const el of [document.body, document.documentElement]) el.setAttribute('data-style', s.uiStyle);
        }
      } catch { /* offline: keep what this device has */ }
    };
    pull();
    document.addEventListener('visibilitychange', pull);
    window.addEventListener('focus', pull);
    return () => { alive = false; document.removeEventListener('visibilitychange', pull); window.removeEventListener('focus', pull); };
  }, []);
  return style;
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
