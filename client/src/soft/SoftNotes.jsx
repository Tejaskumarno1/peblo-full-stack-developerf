import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Check, Sparkles, ArrowUp, History, X, Loader2 } from 'lucide-react';
import { notesAPI, todosAPI } from '../api';
import { useAutoSave } from '../hooks';
import BlockEditor from '../components/BlockEditor';
import { toneOf, toneVar, relTime, snippetOf, timeOf } from './softUtils';

const editable = (title) => (!title || title === 'Untitled' ? '' : title);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Soft Studio · Notes (mockup: SoftNotes). List, editor and helpers, with its own layout. */
export default function SoftNotes() {
  const { id: routeId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState(() => params.get('tag') || 'all');
  const [doc, setDoc] = useState(null); // the open note (local copy while editing)
  const [editorKey, setEditorKey] = useState('none');
  const [preview, setPreview] = useState(false);
  const [tagDraft, setTagDraft] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [pill, setPill] = useState(null); // selection toolbar {x, y, text}
  const [toast, setToast] = useState('');
  const bodyRef = useRef(null);

  // ---------- data ----------
  const { data: allNotes = [] } = useQuery({
    queryKey: ['notes', 'sidebar'],
    queryFn: () => notesAPI.getAll({ sort: 'updated' }).then((r) => r.data.notes || []),
  });
  const listParams = filter === 'archive' ? { archived: 'true' } : filter === 'trash' ? { deleted: 'true' } : filter === 'all' ? {} : { tag: filter };
  const { data: listed = [] } = useQuery({
    queryKey: ['notes', 'soft', filter],
    queryFn: () => notesAPI.getAll({ sort: 'updated', ...listParams }).then((r) => r.data.notes || []),
  });
  const noteId = doc && !doc.isDraft ? doc.id : null;
  const { data: linked = [] } = useQuery({
    queryKey: ['todos', 'note', noteId],
    queryFn: () => todosAPI.getAll({ noteId }).then((r) => r.data.todos || []),
    enabled: !!noteId,
  });
  const { data: versions = [] } = useQuery({
    queryKey: ['notes', 'backups', noteId],
    queryFn: () => notesAPI.getBackups(noteId).then((r) => r.data.backups || r.data || []),
    enabled: !!noteId,
  });

  const tagCounts = useMemo(() => {
    const m = new Map();
    for (const n of allNotes) for (const t of n.tags || []) if (t !== 'inbox' && t !== 'private') m.set(t, (m.get(t) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [allNotes]);
  const inboxCount = allNotes.filter((n) => (n.tags || []).includes('inbox')).length;
  const chipTags = tagCounts.slice(0, 2);
  if (filter !== 'all' && filter !== 'inbox' && filter !== 'archive' && filter !== 'trash' && !chipTags.includes(filter)) chipTags.splice(1, 1, filter);

  // ---------- open a note ----------
  const open = useCallback((note) => {
    setDoc({ ...note, title: editable(note.title), content: note.content || '', tags: note.tags || [] });
    setEditorKey(`${note.id}-${Date.now()}`);
    setPreview(!!note.isDeleted);
    setTagDraft(null);
    setMenuOpen(false);
    setHistoryOpen(false);
    setPill(null);
  }, []);

  const startDraft = useCallback(() => {
    setDoc({ id: '__draft__', isDraft: true, title: '', content: '', tags: filter !== 'all' && filter !== 'archive' && filter !== 'trash' ? [filter] : [], createdAt: new Date().toISOString() });
    setEditorKey(`draft-${Date.now()}`);
    setPreview(false);
    navigate('/notes', { replace: true });
  }, [filter, navigate]);

  useEffect(() => {
    if (params.get('new') === '1') {
      setParams({}, { replace: true });
      startDraft();
      return;
    }
    if (!routeId) {
      if (!doc && allNotes[0]) navigate(`/notes/${allNotes[0].id}`, { replace: true });
      return;
    }
    if (doc?.id === routeId) return;
    const found = allNotes.find((n) => n.id === routeId) || listed.find((n) => n.id === routeId);
    if (found) open(found);
    else notesAPI.get(routeId).then((r) => open(r.data.note)).catch(() => navigate('/notes', { replace: true }));
  }, [routeId, allNotes, listed, params]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- saving ----------
  const saveData = useMemo(() => {
    if (!doc || doc.isDeleted) return null;
    if (doc.isDraft && !doc.title.trim() && !doc.content.trim()) return null;
    return { title: doc.title, content: doc.content, tags: doc.tags };
  }, [doc?.title, doc?.content, doc?.tags, doc?.isDraft, doc?.isDeleted]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveFn = useCallback(async (id, payload) => {
    if (id === '__draft__') {
      const { data } = await notesAPI.create({ ...payload, title: payload.title || 'Untitled' });
      const created = data.note;
      // Keep the editor as it is; only the id changes.
      setDoc((d) => (d && d.isDraft ? { ...d, id: created.id, isDraft: false, createdAt: created.createdAt, updatedAt: created.updatedAt } : d));
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      navigate(`/notes/${created.id}`, { replace: true });
      return;
    }
    await notesAPI.update(id, { ...payload, title: payload.title || 'Untitled' });
    queryClient.setQueriesData({ queryKey: ['notes'] }, (old) => (Array.isArray(old)
      ? old.map((n) => (n.id === id ? { ...n, ...payload, title: payload.title || 'Untitled', updatedAt: new Date().toISOString() } : n))
      : old));
  }, [navigate, queryClient]);

  const { saveStatus, forceSave } = useAutoSave(doc?.id, saveData, saveFn);

  const patch = (p) => setDoc((d) => ({ ...d, ...p }));

  // ---------- note actions ----------
  const refreshLists = () => {
    queryClient.invalidateQueries({ queryKey: ['notes'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const archive = async () => {
    setMenuOpen(false);
    await notesAPI.archive(doc.id);
    refreshLists();
    setDoc(null);
    navigate('/notes', { replace: true });
  };
  const trash = async () => {
    setMenuOpen(false);
    if (!window.confirm(doc.isDeleted ? 'Delete this note forever? This cannot be undone.' : 'Move this note to the Trash?')) return;
    await notesAPI.delete(doc.id);
    refreshLists();
    setDoc(null);
    navigate('/notes', { replace: true });
  };
  const restore = async () => {
    await notesAPI.restore(doc.id);
    refreshLists();
    patch({ isDeleted: false });
    setPreview(false);
  };
  const exportMd = () => {
    setMenuOpen(false);
    const blob = new Blob([`# ${doc.title || 'Untitled'}\n\n${doc.content}`], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(doc.title || 'Untitled').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'note'}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const restoreVersion = async (v) => {
    await notesAPI.revertBackup(doc.id, v.id);
    const { data } = await notesAPI.get(doc.id);
    open(data.note);
    refreshLists();
    queryClient.invalidateQueries({ queryKey: ['notes', 'backups', doc.id] });
  };

  const addTag = (raw) => {
    const t = raw.trim().replace(/^#/, '').toLowerCase();
    if (t && !doc.tags.includes(t)) patch({ tags: [...doc.tags, t] });
    setTagDraft(null);
  };

  const ask = (q) => {
    const text = q.trim();
    if (!text || !noteId) return;
    forceSave();
    const p = new URLSearchParams({ q: text, note: noteId, noteTitle: doc.title || 'This note' });
    navigate(`/ai?${p.toString()}`);
  };

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2200); };
  const toggleTask = async (t) => {
    queryClient.setQueryData(['todos', 'note', noteId], (old) => (old || []).map((x) => (x.id === t.id ? { ...x, completed: !x.completed } : x)));
    await todosAPI.update(t.id, { completed: !t.completed });
    queryClient.invalidateQueries({ queryKey: ['todos'] });
  };

  // ---------- selection toolbar ----------
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection();
      const box = bodyRef.current;
      if (!sel || sel.isCollapsed || !box || !sel.rangeCount || !box.contains(sel.anchorNode)) { setPill(null); return; }
      const text = sel.toString().trim();
      if (text.length < 3) { setPill(null); return; }
      const r = sel.getRangeAt(0).getBoundingClientRect();
      const b = box.getBoundingClientRect();
      setPill({ x: Math.min(Math.max(r.left + r.width / 2 - b.left, 150), b.width - 150), y: r.top - b.top - 50 + box.scrollTop, text: text.slice(0, 400) });
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);
  const pillAction = async (kind) => {
    const text = pill?.text;
    setPill(null);
    if (!text) return;
    if (kind === 'task') {
      if (!noteId) { flash('Type something first so the note is saved.'); return; }
      await todosAPI.create({ text: text.length > 120 ? `${text.slice(0, 117)}…` : text, priority: 'medium', noteId });
      queryClient.invalidateQueries({ queryKey: ['todos'] });
      flash('Task added and linked to this note');
    } else if (kind === 'explain') ask(`Explain this simply: "${text}"`);
    else ask(`Quiz me on this: "${text}"`);
  };

  // Notes that mention this note's title
  const mentions = useMemo(() => {
    const title = (doc?.title || '').trim().toLowerCase();
    if (title.length < 4) return [];
    return allNotes.filter((n) => n.id !== doc.id && (n.content || '').toLowerCase().includes(title)).slice(0, 4);
  }, [allNotes, doc?.id, doc?.title]);

  const crumb = doc?.isDeleted ? 'Trash' : doc?.isArchived ? 'Archive' : doc?.tags?.[0] ? cap(doc.tags[0]) : null;
  const saved = saveStatus === 'saving' ? { text: 'Saving…', icon: <Loader2 size={14} className="s-spin" /> }
    : saveStatus === 'unsaved' ? { text: 'Editing…', icon: null }
      : saveStatus === 'error' ? { text: "Couldn't save", icon: null, bad: true }
        : { text: 'Saved on this computer', icon: <Check size={14} strokeWidth={2.4} /> };

  const listTitle = filter === 'archive' ? 'Archive' : filter === 'trash' ? 'Trash' : 'Notes';

  return (
    <div className="soft-page s-notes">
      {/* ---------- list ---------- */}
      <aside className="s-notes-list" aria-label="Notes">
        <div className="s-tile-head">
          <h1 className="s-notes-h1">{listTitle}</h1>
          <button type="button" className="s-new" aria-label="New note" title="New note" onClick={startDraft}><Plus size={18} strokeWidth={2.6} /></button>
        </div>
        <div className="s-filter" role="tablist" aria-label="Filter notes">
          <button type="button" role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'all on' : 'all'} onClick={() => setFilter('all')}>All</button>
          <button type="button" role="tab" aria-selected={filter === 'inbox'} className={filter === 'inbox' ? 'on' : ''} style={{ background: 'var(--s-butter)' }} onClick={() => setFilter('inbox')}>Inbox{inboxCount ? ` · ${inboxCount}` : ''}</button>
          {chipTags.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={filter === t} className={filter === t ? 'on' : ''} style={{ background: toneVar(toneOf(t)) }} onClick={() => setFilter(t)}>{cap(t)}</button>
          ))}
        </div>
        <div className="s-notes-rows">
          {listed.length === 0 && <p className="s-empty" style={{ padding: '8px 12px' }}>{filter === 'trash' ? 'The Trash is empty.' : filter === 'archive' ? 'Nothing archived.' : 'No notes here yet.'}</p>}
          {listed.map((n) => {
            const tone = toneVar(toneOf(n.tags?.[0]));
            const on = doc?.id === n.id;
            return (
              <Link key={n.id} to={`/notes/${n.id}`} className={`s-note-row${on ? ' on' : ''}`} style={on ? { background: tone } : undefined} onClick={() => forceSave()}>
                <span className="dot" style={{ background: tone }} aria-hidden="true" />
                <span className="txt">
                  <span className="t">{n.title && n.title !== 'Untitled' ? n.title : 'Untitled'}</span>
                  <span className="s">{snippetOf(n.content) || 'Empty note'}</span>
                  <span className="m">{relTime(n.updatedAt)}</span>
                </span>
              </Link>
            );
          })}
        </div>
        <div className="s-notes-foot">
          <button type="button" className={filter === 'archive' ? 'on' : ''} onClick={() => setFilter(filter === 'archive' ? 'all' : 'archive')}>Archive</button>
          <span aria-hidden="true">·</span>
          <button type="button" className={filter === 'trash' ? 'on' : ''} onClick={() => setFilter(filter === 'trash' ? 'all' : 'trash')}>Trash</button>
        </div>
      </aside>

      {/* ---------- editor ---------- */}
      <main className="s-note-main" aria-label="Note">
        {!doc ? (
          <div className="s-note-empty">
            <h2 className="s-h2">Write something</h2>
            <p className="s-empty">Pick a note on the left, or start a new one.</p>
            <button type="button" className="s-accent-btn" onClick={startDraft}>New note</button>
          </div>
        ) : (
          <>
            <div className="s-note-bar">
              <span className="s-crumb">Notes{crumb ? `  ›  ${crumb}` : ''}</span>
              <span className={`s-saved${saved.bad ? ' bad' : ''}`}>{saved.icon}{saved.text}</span>
              <span className="grow" />
              {doc.isDeleted ? (
                <button type="button" className="s-outline" onClick={restore}>Restore</button>
              ) : (
                <button type="button" className="s-outline" onClick={() => setPreview((v) => !v)} aria-pressed={preview}>{preview ? 'Edit' : 'Preview'}</button>
              )}
              <div className="s-menu-wrap">
                <button type="button" className="s-outline round" aria-label="More" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>···</button>
                {menuOpen && !doc.isDraft && (
                  <div className="s-menu" role="menu">
                    {!doc.isDeleted && <button type="button" role="menuitem" onClick={archive}>{doc.isArchived ? 'Unarchive' : 'Archive'}</button>}
                    <button type="button" role="menuitem" onClick={exportMd}>Export as Markdown</button>
                    <button type="button" role="menuitem" className="danger" onClick={trash}>{doc.isDeleted ? 'Delete forever' : 'Move to Trash'}</button>
                  </div>
                )}
              </div>
            </div>

            <label htmlFor="s-note-title" className="s-sr">Title</label>
            <input
              id="s-note-title"
              className="s-note-title"
              value={doc.title}
              placeholder="Untitled note"
              onChange={(e) => patch({ title: e.target.value })}
              disabled={doc.isDeleted}
            />
            <div className="s-note-tags">
              {doc.tags.map((t) => (
                <span key={t} className="s-tag s-note-tag" style={{ background: toneVar(toneOf(t)) }}>
                  #{t}
                  {!doc.isDeleted && <button type="button" aria-label={`Remove tag ${t}`} onClick={() => patch({ tags: doc.tags.filter((x) => x !== t) })}><X size={12} strokeWidth={2.6} /></button>}
                </span>
              ))}
              {tagDraft === null ? (
                !doc.isDeleted && <button type="button" className="s-dashed s-add-tag" onClick={() => setTagDraft('')}>+ tag</button>
              ) : (
                <input
                  className="s-tag-input"
                  aria-label="New tag"
                  autoFocus
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(tagDraft); } if (e.key === 'Escape') setTagDraft(null); }}
                  onBlur={() => (tagDraft.trim() ? addTag(tagDraft) : setTagDraft(null))}
                  placeholder="tag"
                />
              )}
            </div>

            <div className="s-note-body" ref={bodyRef}>
              <BlockEditor
                key={editorKey}
                initialContent={doc.content}
                onChange={(md) => patch({ content: md })}
                editable={!preview && !doc.isDeleted}
                formattingToolbar={false}
              />
              {pill && !preview && (
                <div className="s-sel-pill" style={{ left: pill.x, top: Math.max(pill.y, 0) }} onMouseDown={(e) => e.preventDefault()}>
                  <button type="button" className="on" onClick={() => pillAction('explain')}>Explain</button>
                  <button type="button" onClick={() => pillAction('task')}>Make a task</button>
                  <button type="button" onClick={() => pillAction('quiz')}>Quiz me</button>
                </div>
              )}
            </div>
            {toast && <div className="s-toast" role="status">{toast}</div>}
          </>
        )}
      </main>

      {/* ---------- helpers ---------- */}
      <aside className="s-note-side" aria-label="About this note">
        <form className="s-note-ask" onSubmit={(e) => { e.preventDefault(); ask(question); setQuestion(''); }}>
          <label htmlFor="s-note-ask" className="s-ask-label" style={{ fontSize: 15 }}><Sparkles size={17} /> Ask about this note</label>
          <div className="s-ask-row small">
            <input id="s-note-ask" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={noteId ? 'What should I remember from this?' : 'Save the note to ask about it'} disabled={!noteId} autoComplete="off" />
            <button type="submit" className="s-send small" aria-label="Ask" disabled={!question.trim() || !noteId}><ArrowUp size={16} strokeWidth={2.4} /></button>
          </div>
          <div className="s-chips" style={{ gap: 6 }}>
            <button type="button" className="s-chip small" disabled={!noteId} onClick={() => ask('Summarise this note in a few short bullet points.')}>Summarise</button>
            <button type="button" className="s-chip small" disabled={!noteId} onClick={() => ask('Make 8 flashcards (question and answer) from this note.')}>Flashcards</button>
            <button type="button" className="s-chip small" disabled={!noteId} onClick={() => ask('List the tasks and to-dos hidden in this note.')}>Find tasks</button>
          </div>
        </form>

        <section className="s-side-card" style={{ background: 'var(--s-peach)' }} aria-labelledby="s-linked">
          <h3 id="s-linked" className="s-h3">Linked tasks</h3>
          {linked.length === 0 && <p className="s-empty small">Select text in the note and press Make a task.</p>}
          {linked.slice(0, 4).map((t) => (
            <label key={t.id} className={`s-side-task${t.completed ? ' done' : ''}`}>
              <input type="checkbox" className="s-check small" checked={!!t.completed} onChange={() => toggleTask(t)} />
              <span className="t">{t.text}</span>
              {timeOf(t) && <span className={`time${t.priority === 'high' ? ' hot' : ''}`}>{timeOf(t)}</span>}
            </label>
          ))}
        </section>

        <section className="s-side-card" style={{ background: 'var(--s-mint)' }} aria-labelledby="s-mentions">
          <h3 id="s-mentions" className="s-h3">Mentioned in</h3>
          {mentions.length === 0 && <p className="s-empty small">{(doc?.title || '').trim().length < 4 ? 'Give the note a title to see where it is mentioned.' : 'No other note mentions this one yet.'}</p>}
          {mentions.map((n) => <Link key={n.id} to={`/notes/${n.id}`} className="s-side-link">{n.title || 'Untitled'}</Link>)}
        </section>

        {noteId && (
          <div className="s-menu-wrap">
            <button type="button" className="s-versions" onClick={() => setHistoryOpen((v) => !v)} aria-expanded={historyOpen}>
              <History size={15} strokeWidth={2.2} /> {versions.length ? `${versions.length} version${versions.length === 1 ? '' : 's'} kept` : 'No earlier versions'}
            </button>
            {historyOpen && versions.length > 0 && (
              <div className="s-menu up" role="menu">
                {versions.slice(0, 8).map((v) => (
                  <button key={v.id} type="button" role="menuitem" onClick={() => { setHistoryOpen(false); restoreVersion(v); }}>
                    Restore · {relTime(v.createdAt)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
