import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Image as ImageIcon, Paperclip, ListChecks, Heading1, Link2, Search } from 'lucide-react';
import { notesAPI, todosAPI } from '../api';
import { parseTask } from '../utils/parseTask';
import { fileToAttachment, attachmentMarkdown } from '../utils/imageData';
import { dayChip, timeOf, startOfDay, addDays, snippetOf } from './softUtils';
import TaskSheet from './TaskSheet';
import './soft.css';
import './soft2.css';

const words = (s) => (s || '').toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || [];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const store = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };

/**
 * Soft Studio quick capture card (mockups 4 and 5).
 * Used as a pop-up from the dock, and as the whole Ctrl+Shift+Space window.
 * Task mode: sentence parsing, quick due/priority/tag/note chips, attachments (paste, drop, pick).
 * Note mode: title, body with a small toolbar, attachments, tags, pin and "make tasks from the checklist".
 */
export default function SoftCapture({ onClose, windowMode = false }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState('task');
  const [value, setValue] = useState('');
  const [body, setBody] = useState('');
  const [atts, setAtts] = useState([]);
  const [due, setDue] = useState(null);
  const [prio, setPrio] = useState(null);
  const [extraTags, setExtraTags] = useState([]);
  const [tagOpen, setTagOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [linkNote, setLinkNote] = useState(null);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const [inbox, setInbox] = useState(true);
  const [pin, setPin] = useState(false);
  const [makeTasks, setMakeTasks] = useState(false);
  const [keepOpen, setKeepOpen] = useState(() => store('peblo-capture-keep', '0') === '1');
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null);
  const inputRef = useRef(null);
  const bodyRef = useRef(null);
  const fileRef = useRef(null);

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
  // The Electron window stays open while something is typed or attached (so taking a screenshot does not lose it).
  const dirty = !!(value.trim() || body.trim() || atts.length);
  useEffect(() => {
    window.__pebloCaptureDirty = dirty;
    return () => { window.__pebloCaptureDirty = false; };
  }, [dirty]);

  const parsed = mode === 'task' && value.trim() ? parseTask(value) : null;
  const typed = words(parsed ? parsed.text : value);
  const suggestion = useMemo(() => {
    if (mode !== 'task' || !typed.length) return null;
    return notes.find((n) => words(n.title).some((w) => typed.includes(w))) || null;
  }, [notes, mode, value]); // eslint-disable-line react-hooks/exhaustive-deps
  const similar = useMemo(() => {
    if (mode !== 'task' || typed.length === 0) return null;
    return upcoming.find((t) => !t.completed && words(t.text).some((w) => typed.includes(w))) || null;
  }, [upcoming, mode, value]); // eslint-disable-line react-hooks/exhaustive-deps
  const found = useMemo(() => {
    const s = q.trim().toLowerCase();
    return notes.filter((n) => !s || (n.title || '').toLowerCase().includes(s)).slice(0, 4);
  }, [notes, q]);

  const reset = () => {
    setValue(''); setBody(''); setAtts([]); setDue(null); setPrio(null); setExtraTags([]); setTagOpen(false); setTagDraft('');
    setLinkNote(null); setPicking(false); setQ(''); setPin(false); setMakeTasks(false); setCreated(null);
  };
  const close = () => {
    reset();
    if (windowMode) window.close();
    else onClose?.();
  };

  // ---- attachments: pick, paste, drop
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

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['todos'] });
    queryClient.invalidateQueries({ queryKey: ['notes'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const save = async (e, forceSheet = false) => {
    e?.preventDefault();
    const raw = value.trim();
    if (saving) return;
    if (mode === 'task' ? !raw : !raw && !body.trim() && !atts.length) return;
    setSaving(true);
    try {
      if (mode === 'task') {
        const t = parseTask(raw);
        let noteId = linkNote?.id || undefined;
        if (atts.length) {
          const md = attachmentMarkdown(atts);
          if (noteId) {
            const cur = (await notesAPI.get(noteId)).data.note;
            await notesAPI.update(noteId, { content: `${cur.content || ''}\n\n${md}` });
          } else {
            const n = (await notesAPI.create({ title: `Attachments · ${t.text || raw}`.slice(0, 120), content: md, tags: ['attachments'] })).data.note;
            noteId = n.id;
          }
        }
        let deadline = t.deadline || null;
        if (due) { const base = deadline || new Date(`${due}T09:00`); deadline = new Date(`${due}T${pad(base.getHours())}:${pad(base.getMinutes())}`); }
        const res = await todosAPI.create({
          text: t.text || raw,
          priority: prio || t.priority,
          tags: [...new Set([...(t.tags || []), ...extraTags])],
          deadline: deadline ? deadline.toISOString() : null,
          noteId,
        });
        refreshAll();
        const made = res.data.todo || res.data.todos?.[0];
        if ((forceSheet || !keepOpen) && made?.id) {
          const note = noteId ? { id: noteId, title: linkNote?.title || `Attachments · ${t.text || raw}` } : made.note;
          setValue('');
          setCreated({ ...made, note });
          return;
        }
        setStatus(deadline ? `Added · due ${dayChip(deadline)}, ${timeOf({ deadline })}` : 'Added to your tasks');
        reset();
        setTimeout(() => inputRef.current?.focus(), 30);
        if (!keepOpen) setTimeout(close, 650);
      } else {
        const lines = body.split('\n');
        const title = raw || (lines.find((l) => l.trim()) || 'Quick note').replace(/^[#>\-*\s[\]x]+/i, '').slice(0, 120) || 'Quick note';
        const content = [body.trim(), attachmentMarkdown(atts)].filter(Boolean).join('\n\n');
        const tags = [...new Set([...(inbox ? ['inbox'] : []), ...extraTags])];
        const pinned = pin && notes.filter((n) => n.meta?.pinned && !n.isDeleted && !n.isArchived).length < 3;
        const made = (await notesAPI.create({ title, content, tags, ...(pinned ? { meta: { pinned: true } } : {}) })).data.note;
        let count = 0;
        if (makeTasks) {
          for (const l of lines) {
            const m = /^\s*[-*]\s+\[ \]\s+(.+)$/.exec(l);
            if (m) { await todosAPI.create({ text: m[1].trim().slice(0, 200), priority: 'medium', noteId: made.id }); count += 1; }
          }
        }
        refreshAll();
        setStatus(`Saved to Notes${inbox ? ' · #inbox' : ''}${count ? ` · ${count} task${count === 1 ? '' : 's'} made` : ''}${pin && !pinned ? ' · 3 notes already pinned' : ''}`);
        reset();
        if (!keepOpen) setTimeout(close, 800);
        else setTimeout(() => inputRef.current?.focus(), 30);
      }
    } catch (err) {
      setStatus(err.response?.data?.error || 'Could not save. Is Peblo still running?');
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab' && !e.shiftKey && e.target === inputRef.current && !(mode === 'note' && value.trim())) { e.preventDefault(); setMode((m) => (m === 'task' ? 'note' : 'task')); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(null, mode === 'task'); }
    else if (e.key === 'Enter' && mode === 'note' && e.target === inputRef.current) { e.preventDefault(); bodyRef.current?.focus(); }
  };

  if (created) {
    return (
      <div className={`s-capture${windowMode ? ' window' : ''}`}>
        <TaskSheet task={created} isNew inline onClose={close} />
      </div>
    );
  }

  const attachBar = (
    <div className="s-cap-attach">
      {atts.length === 0 ? (
        <button type="button" className="s-cap-drop" onClick={() => fileRef.current?.click()}>
          <span className="plus">+</span>
          <span>Drop a photo or file here, or paste with <kbd>Ctrl</kbd> <kbd>V</kbd></span>
        </button>
      ) : (
        <div className="s-cap-thumbs">
          {atts.map((a) => (
            <div key={a.id} className={`s-cap-thumb${a.isImage ? ' img' : ''}`}>
              {a.isImage ? <img src={a.url} alt={a.name} /> : <span className="f"><b>{a.name}</b><small>{Math.max(1, Math.round(a.size / 1024))} KB</small></span>}
              <button type="button" aria-label={`Remove ${a.name}`} onClick={() => setAtts(atts.filter((x) => x.id !== a.id))}><X size={12} strokeWidth={2.8} /></button>
            </div>
          ))}
          <button type="button" className="s-cap-more" aria-label="Add another file" onClick={() => fileRef.current?.click()}>+</button>
        </div>
      )}
      <input ref={fileRef} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
    </div>
  );

  return (
    <form className={`s-capture${windowMode ? ' window' : ''}`} onSubmit={save} onKeyDown={onKeyDown} onPaste={onPaste} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <div className="s-capture-top">
        <div className="s-capture-seg" role="tablist" aria-label="What to capture">
          <button type="button" role="tab" aria-selected={mode === 'task'} className={mode === 'task' ? 'on' : ''} onClick={() => setMode('task')}>Task</button>
          <button type="button" role="tab" aria-selected={mode === 'note'} className={mode === 'note' ? 'on' : ''} onClick={() => setMode('note')}>Note</button>
        </div>
        <span className="s-capture-hint">Tab switches</span>
        <span className="grow" />
        <label className="s-cap-keep"><input type="checkbox" checked={keepOpen} onChange={toggleKeep} /> Keep open after adding</label>
        <button type="button" className="s-capture-close" aria-label="Close" onClick={close}><X size={16} strokeWidth={2.4} /></button>
      </div>

      <label htmlFor="s-capture-input" className="s-sr">{mode === 'task' ? 'What do you need to do?' : 'Title'}</label>
      <input
        id="s-capture-input"
        ref={inputRef}
        className="s-capture-input"
        value={value}
        onChange={(e) => { setValue(e.target.value); setStatus(null); }}
        placeholder={mode === 'task' ? 'Revise BCNF tomorrow 6pm !high #exams' : 'Title (optional)'}
        autoComplete="off"
      />

      {mode === 'task' && parsed && (
        <div className="s-capture-chips">
          <span className="s-cap-lab">Understood:</span>
          {parsed.deadline && <span className="s-tag" style={{ background: 'var(--s-mint)' }}>{dayChip(parsed.deadline)}, {timeOf({ deadline: parsed.deadline })}</span>}
          {parsed.priority !== 'medium' && <span className="s-tag" style={{ background: 'var(--s-peach)' }}>{parsed.priority === 'high' ? 'High' : 'Low'}</span>}
          {parsed.tags.map((t) => <span key={t} className="s-tag" style={{ background: 'var(--s-butter)' }}>#{t}</span>)}
          {!parsed.deadline && parsed.priority === 'medium' && parsed.tags.length === 0 && <span className="s-cap-lab">just the task, add a day, !high or #tag if you like</span>}
        </div>
      )}

      {mode === 'task' && (
        <div className="s-cap-quick" role="group" aria-label="Quick settings">
          {[['Today', ymd(startOfDay())], ['Tomorrow', ymd(addDays(startOfDay(), 1))], ['Next week', ymd(addDays(startOfDay(), 7))]].map(([n, v]) => (
            <button key={n} type="button" className={due === v ? 'on' : ''} aria-pressed={due === v} onClick={() => setDue(due === v ? null : v)}>{n}</button>
          ))}
          <button type="button" className={prio === 'high' ? 'on' : ''} aria-pressed={prio === 'high'} onClick={() => setPrio(prio === 'high' ? null : 'high')}>High</button>
          {extraTags.map((t) => <button key={t} type="button" className="on tag" onClick={() => setExtraTags(extraTags.filter((x) => x !== t))}>#{t}<X size={12} aria-hidden="true" /></button>)}
          {tagOpen ? (
            <input className="s-cap-tag" autoFocus aria-label="Add a tag" placeholder="tag" value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addTag(tagDraft); setTagOpen(false); } if (e.key === 'Escape') { e.stopPropagation(); setTagOpen(false); } }} onBlur={() => { if (tagDraft.trim()) addTag(tagDraft); setTagOpen(false); }} />
          ) : <button type="button" className="ghost" onClick={() => setTagOpen(true)}>+ tag</button>}
          {linkNote ? <button type="button" className="on note" onClick={() => setLinkNote(null)}>Note: {linkNote.title || 'Untitled'}<X size={12} aria-hidden="true" /></button>
            : <button type="button" className="ghost" onClick={() => setPicking((p) => !p)} aria-expanded={picking}>+ Link a note</button>}
          {suggestion && !linkNote && <button type="button" className="ghost" onClick={() => setLinkNote(suggestion)}>Link “{suggestion.title || 'Untitled'}”?</button>}
        </div>
      )}
      {mode === 'task' && picking && !linkNote && (
        <div className="s-cap-pick">
          <label className="s-cap-search"><Search size={14} /><input autoFocus aria-label="Search notes" placeholder="Search your notes" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setPicking(false); } }} /></label>
          {found.map((n) => <button key={n.id} type="button" onClick={() => { setLinkNote({ id: n.id, title: n.title }); setPicking(false); setQ(''); }}><b>{n.title || 'Untitled'}</b><small>{snippetOf(n.content, 50)}</small></button>)}
          {found.length === 0 && <span className="s-empty small">No note matches.</span>}
        </div>
      )}

      {mode === 'note' && (
        <>
          <div className="s-cap-tools" role="toolbar" aria-label="Add to the note">
            <button type="button" onClick={() => { fileRef.current.accept = 'image/*'; fileRef.current.click(); setTimeout(() => { if (fileRef.current) fileRef.current.accept = ''; }, 500); }}><ImageIcon size={14} /> Photo</button>
            <button type="button" onClick={() => { if (fileRef.current) fileRef.current.accept = ''; fileRef.current?.click(); }}><Paperclip size={14} /> File</button>
            <button type="button" onClick={() => addToBody('- [ ] ')}><ListChecks size={14} /> Checklist</button>
            <button type="button" onClick={() => addToBody('## ')}><Heading1 size={14} /> Heading</button>
            <button type="button" onClick={() => addToBody('[link text](https://)')}><Link2 size={14} /> Link</button>
          </div>
          <textarea ref={bodyRef} className="s-cap-body" aria-label="Note" placeholder="A thought, a link, an idea…" value={body} onChange={(e) => { setBody(e.target.value); setStatus(null); }} rows={5} />
        </>
      )}

      {attachBar}

      {mode === 'note' && (
        <div className="s-cap-quick" role="group" aria-label="Save options">
          <span className="s-cap-lab">Save to</span>
          <button type="button" className={inbox ? 'on' : ''} aria-pressed={inbox} onClick={() => setInbox(!inbox)}>Inbox</button>
          {extraTags.map((t) => <button key={t} type="button" className="on tag" onClick={() => setExtraTags(extraTags.filter((x) => x !== t))}>#{t}<X size={12} aria-hidden="true" /></button>)}
          {tagOpen ? (
            <input className="s-cap-tag" autoFocus aria-label="Add a tag" placeholder="tag" value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addTag(tagDraft); setTagOpen(false); } if (e.key === 'Escape') { e.stopPropagation(); setTagOpen(false); } }} onBlur={() => { if (tagDraft.trim()) addTag(tagDraft); setTagOpen(false); }} />
          ) : <button type="button" className="ghost" onClick={() => setTagOpen(true)}>+ tag</button>}
          <button type="button" className={pin ? 'on' : 'ghost'} aria-pressed={pin} onClick={() => setPin(!pin)}>Pin to Home</button>
          <button type="button" className={makeTasks ? 'on' : 'ghost'} aria-pressed={makeTasks} onClick={() => setMakeTasks(!makeTasks)}>Make tasks from checklist</button>
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
        <span className={`s-capture-status${status ? ' on' : ''}`} role="status">{status || (mode === 'task' ? 'Enter adds · Ctrl Enter adds and sets details · Esc closes' : 'Ctrl Enter saves · Esc closes')}</span>
        <span className="grow" />
        <button type="submit" className="s-capture-add" disabled={saving || (mode === 'task' ? !value.trim() : !value.trim() && !body.trim() && !atts.length)}>{saving ? 'Saving…' : mode === 'task' ? 'Add task' : 'Save note'}</button>
      </div>
    </form>
  );
}
