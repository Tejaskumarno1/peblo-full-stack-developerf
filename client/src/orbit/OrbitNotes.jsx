import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Copy, FileDown, FileText, History, Link2, Lock, Printer, Replace, Share2, Trash2, Undo2, ChevronRight, Loader2, X, Network, Star, Maximize2 } from 'lucide-react';
import { notesAPI, todosAPI, hubAPI, studyAPI } from '../api';
import BlockEditor from '../components/BlockEditor';
import useNoteDoc from '../hooks/useNoteDoc';
import { useOrbit, useDismiss } from './OrbitShell';
import { topicName, levelOf, levelVar, tagsOfNote, agoText, shortDate } from './orbitUtils';
import { snippetOf } from '../soft/softUtils';
import { clock, dayWord } from '../river/riverUtils';
import OrbitNoteList from './OrbitNoteList';
import VersionHistory from '../components/VersionHistory';
import ShareDialog from '../soft/ShareDialog';
import '../soft/dialogs.css';
import { exportDocs } from '../utils/exporters';
import { TEMPLATES, outlineOf, countMatches, replaceAll } from './noteTemplates';

const words = (s) => [...new Set((s || '').toLowerCase().match(/[\p{L}\p{N}]{5,}/gu) || [])];

/** Orbit · Notes: one note on a sheet over the map (mockup: OrbitNote), or every note by topic. */
export default function OrbitNotes() {
  const note = useNoteDoc();
  const navigate = useNavigate();
  return (
    <>
      <div className="o-scrim" onMouseDown={() => { note.forceSave(); navigate('/'); }} />
      {note.routeId || note.doc ? <OrbitNote note={note} /> : <OrbitNoteList onNew={(tags) => note.startDraft(tags)} />}
    </>
  );
}

function SheetHead({ children, onBack }) {
  return (
    <header className="o-sheet-head">
      {children}
      <button type="button" className="o-btn ghost small" style={{ height: 44 }} onClick={onBack}><Network size={16} strokeWidth={2.2} /> Back to map</button>
    </header>
  );
}

/* ------------------------------------------------------------------ */

function OrbitNote({ note }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { mastery, space, todos, setSelected } = useOrbit();
  const { doc, editorKey, patch, noteId, saveStatus } = note;
  const [tagDraft, setTagDraft] = useState(null);
  const [menu, setMenu] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const menuRef = useDismiss(menu, () => setMenu(false));
  const [dismissed, setDismissed] = useState([]);
  // Round 6: focus mode, emoji picker, copied message
  const [zen, setZen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [flash, setFlash] = useState('');
  // Round 10: find & replace bar
  const [findOpen, setFindOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [replText, setReplText] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  useEffect(() => {
    if (!zen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setZen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zen]);
  // Ctrl/Cmd+F opens find and replace (instead of the browser's own find) while a note can be edited
  const canEdit = !!doc && !doc.isDraft && !doc.isDeleted && !doc.meta?.locked;
  useEffect(() => {
    if (!canEdit) return undefined;
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') { e.preventDefault(); setFindOpen(true); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canEdit]);
  useEffect(() => { if (!flash) return undefined; const t = setTimeout(() => setFlash(''), 2500); return () => clearTimeout(t); }, [flash]);

  const { data: linked = [] } = useQuery({
    queryKey: ['todos', 'note', noteId],
    queryFn: () => todosAPI.getAll({ noteId }).then((r) => r.data.todos || []),
    enabled: !!noteId,
  });
  const { data: bank } = useQuery({
    queryKey: ['study', 'note-questions', noteId],
    queryFn: () => studyAPI.noteQuestions(noteId).then((r) => r.data.count),
    enabled: !!noteId,
  });
  const query = doc ? `${doc.title} ${snippetOf(doc.content, 160)}` : '';
  const { data: related = [] } = useQuery({
    queryKey: ['orbit', 'related', noteId, doc?.title],
    queryFn: () => hubAPI.search(query).then((r) => (r.data.sources || []).filter((s) => s.kind === 'note' && s.id !== noteId)),
    enabled: !!noteId && query.trim().length > 3,
    staleTime: 60000,
  });

  const tags = doc ? doc.tags.filter((t) => t !== 'inbox') : [];
  const allNotes = note.allNotes;

  // Suggestions: a related note on a topic this note isn't on, and an open task this note could help with
  const suggestions = useMemo(() => {
    if (!doc || doc.isDraft) return [];
    const out = [];
    for (const s of related) {
      const other = allNotes.find((n) => n.id === s.id);
      const fresh = tagsOfNote(other).filter((t) => !tags.includes(t));
      if (other && fresh.length) { out.push({ key: `tag-${fresh[0]}`, kind: 'tag', other, tag: fresh[0] }); break; }
    }
    const mine = words(`${doc.title} ${doc.content}`);
    const task = todos.find((t) => !t.completed && !t.noteId && words(t.text).some((w) => mine.includes(w)));
    if (task) out.push({ key: `task-${task.id}`, kind: 'task', task });
    return out.filter((s) => !dismissed.includes(s.key));
  }, [related, allNotes, doc?.id, doc?.title, tags.join(','), todos, dismissed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!doc) {
    return (
      <article className="o-sheet" style={{ top: 92, width: 876, alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 className="o-spin" />
      </article>
    );
  }

  const meta = doc.meta && typeof doc.meta === 'object' ? doc.meta : {};
  const locked = !!meta.locked;
  const readOnly = !!doc.isDeleted || locked;
  const plain = String(doc.content || '').replace(/[#>*_`~\-\[\]()!|]/g, ' ');
  const wordCount = (plain.match(/[\p{L}\p{N}]+/gu) || []).length;
  const readMin = Math.max(1, Math.round(wordCount / 200));
  const setMeta = async (p) => {
    if (doc.isDraft) return;
    const next = { ...meta };
    for (const [k, v] of Object.entries(p)) { if (v === null || v === false || v === '') delete next[k]; else next[k] = v; }
    patch({ meta: next });
    try { await notesAPI.update(noteId, { meta: p }); } catch (e) { console.error('Could not save', e); setFlash("Couldn't save that. Try again."); patch({ meta }); } finally { queryClient.invalidateQueries({ queryKey: ['notes'] }); }
  };
  const duplicate = async () => {
    try {
      const r = await notesAPI.create({ title: `${doc.title || 'Untitled'} (copy)`, content: doc.content || '', tags: doc.tags });
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      navigate(`/notes/${(r.data.note || r.data).id}`);
    } catch (e) { console.error('Could not duplicate', e); setFlash("Couldn't duplicate the note."); }
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(`${window.location.origin}/notes/${noteId}`); setFlash('Link copied'); } catch { setFlash('Could not copy. Copy the address from the browser.'); }
  };
  const outline = outlineOf(doc.content);
  const matches = countMatches(doc.content, findText, { matchCase });
  const doReplace = () => {
    const r = replaceAll(doc.content, findText, replText, { matchCase });
    if (!r.count) return;
    note.applyContent({ content: r.text });
    setFlash(`Replaced ${r.count} ${r.count === 1 ? 'match' : 'matches'}`);
  };
  const applyTemplate = (t) => note.applyContent({ content: t.content, title: doc.title || t.title });
  const jumpTo = (h) => {
    const els = [...document.querySelectorAll('.o-body [data-content-type="heading"], .o-body h1, .o-body h2, .o-body h3')];
    const el = els.find((x) => (x.textContent || '').replace(/[*_`]/g, '').trim() === h.text);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const EMOJIS = ['📘', '📝', '🧠', '💡', '🔬', '📐', '💻', '🧮', '📊', '🎯', '⭐', '🔥', '✅', '📅', '🌱', '🧪'];
  const topic = tags[0];
  const created = new Date(doc.createdAt);
  const edited = new Date(doc.updatedAt || doc.createdAt);
  const status = saveStatus === 'saving' ? 'SAVING…' : saveStatus === 'error' ? "COULDN'T SAVE" : saveStatus === 'unsaved' ? 'EDITING…' : `EDITED ${dayWord(edited) === 'Today' ? clock(edited).toUpperCase() : dayWord(edited).toUpperCase()} · SAVED`;
  const back = () => { note.forceSave(); navigate('/'); };
  const showTopic = (t) => { note.forceSave(); setSelected(`t-${t}`); navigate('/'); };
  const addTag = (raw) => { note.addTag(raw); setTagDraft(null); };

  const accept = async (s) => {
    if (s.kind === 'tag') patch({ tags: [...doc.tags, s.tag] });
    else {
      try {
        await todosAPI.update(s.task.id, { noteId });
      } catch (e) {
        console.error('Could not link the task', e);
        return; // keep the suggestion visible so it can be accepted again
      } finally {
        queryClient.invalidateQueries({ queryKey: ['todos'] });
      }
    }
    setDismissed((d) => [...d, s.key]);
  };

  return (
    <article className={`o-sheet${zen ? ' zen' : ''}`} style={{ top: 92, width: 876 }} aria-label="Note">
      <SheetHead onBack={back}>
        <nav className="o-crumbs" aria-label="Breadcrumb">
          <button type="button" className="crumb" aria-label="Back to the map" onClick={back}>{space ? topicName(space) : 'Map'}</button>
          {topic && (
            <>
              <ChevronRight size={14} strokeWidth={2.2} style={{ color: 'var(--o-fg2)' }} />
              <button type="button" className="topic" aria-label={`Show ${topicName(topic)} on the map`} onClick={() => showTopic(topic)}><i style={{ borderColor: levelVar(levelOf(mastery.get(topic)?.score)) }} />{topicName(topic)}</button>
            </>
          )}
          <ChevronRight size={14} strokeWidth={2.2} style={{ color: 'var(--o-fg2)' }} />
          <span className="here" aria-current="page">{doc.title || 'Untitled note'}</span>
        </nav>
        <span className="grow" />
        <span className="status" role="status" aria-live="polite">{flash || (doc.isDraft ? 'NEW NOTE' : status)}</span>
        {saveStatus === 'error' && <button type="button" className="o-btn small" onClick={() => note.forceSave()}>Retry</button>}
        {!doc.isDraft && (
          <button type="button" className="o-btn ghost small" style={{ height: 44, width: 44, padding: 0 }} aria-label={meta.favourite ? 'Remove from favourites' : 'Add to favourites'} aria-pressed={!!meta.favourite} onClick={() => setMeta({ favourite: meta.favourite ? null : true })}>
            <Star size={18} fill={meta.favourite ? 'currentColor' : 'none'} />
          </button>
        )}
        <button type="button" className="o-btn ghost small" style={{ height: 44, width: 44, padding: 0 }} aria-label={zen ? 'Leave focus mode' : 'Focus mode'} aria-pressed={zen} onClick={() => setZen(!zen)}><Maximize2 size={17} /></button>
        {!doc.isDraft && (
          <div className="o-menu-wrap" ref={menuRef}>
            <button type="button" className="o-btn ghost small" style={{ height: 44, width: 44, padding: 0 }} aria-label="More" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>···</button>
            {menu && (
              <div className="o-pop right" role="menu" style={{ width: 210 }}>
                {doc.isDeleted && <button type="button" role="menuitem" onClick={() => { setMenu(false); note.restore(); }}><Undo2 size={15} />Restore</button>}
                {!doc.isDeleted && <button type="button" role="menuitem" onClick={() => { setMenu(false); note.archive('/'); }}><Archive size={15} />{doc.isArchived ? 'Unarchive' : 'Archive'}</button>}
                {!doc.isDeleted && <button type="button" role="menuitem" onClick={() => { setMenu(false); setMeta({ locked: locked ? null : true }); }}><Lock size={15} />{locked ? 'Unlock (allow editing)' : 'Lock (read only)'}</button>}
                {!readOnly && <button type="button" role="menuitem" onClick={() => { setMenu(false); setFindOpen(true); }}><Replace size={15} />Find and replace</button>}
                {!doc.isDraft && <button type="button" role="menuitem" onClick={() => { setMenu(false); note.forceSave(); setHistoryOpen(true); }}><History size={15} />Version history</button>}
                <button type="button" role="menuitem" onClick={() => { setMenu(false); duplicate(); }}><Copy size={15} />Duplicate</button>
                {!doc.isDeleted && !doc.isDraft && <button type="button" role="menuitem" onClick={() => { setMenu(false); setShareOpen(true); }}><Share2 size={15} />Share link…</button>}
                <button type="button" role="menuitem" onClick={() => { setMenu(false); copyLink(); }}><Link2 size={15} />Copy link</button>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); note.exportMd(); }}><FileText size={15} />Export as Markdown</button>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); exportDocs([doc], 'pdf').catch((e) => console.error('PDF export failed', e)); }}><FileDown size={15} />Download as PDF</button>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); exportDocs([doc], 'doc').catch((e) => console.error('Word export failed', e)); }}><FileDown size={15} />Download as Word</button>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); exportDocs([doc], 'print').catch((e) => console.error('Print failed', e)); }}><Printer size={15} />Print</button>
                <button type="button" role="menuitem" style={{ color: 'var(--o-weak-ink)' }} onClick={() => { setMenu(false); note.trash('/notes'); }}><Trash2 size={15} />{doc.isDeleted ? 'Delete forever' : 'Move to Trash'}</button>
              </div>
            )}
          </div>
        )}
      </SheetHead>
      {shareOpen && doc?.id && <div className="pb-dlg-host"><ShareDialog kind="note" id={doc.id} title={doc.title} onClose={() => setShareOpen(false)} /></div>}
      {historyOpen && <VersionHistory noteId={doc.id} currentContent={doc.content} onClose={() => setHistoryOpen(false)} onRestored={(n) => note.applyContent({ content: n.content, title: n.title })} />}

      <div className="o-sheet-body">
        <div className="o-sheet-main">
          <span className="o-eyebrow">NOTE · {doc.isDraft ? 'NOT SAVED YET' : `WRITTEN ${shortDate(created)}`}{doc.isDeleted ? ' · IN TRASH' : doc.isArchived ? ' · ARCHIVED' : ''}</span>
          <label htmlFor="o-note-title" className="o-sr">Title</label>
          <div className="o-title-row">
            {!doc.isDraft && (
              <span className="o-menu-wrap">
                <button type="button" className="o-emoji" aria-label={meta.emoji ? `Icon ${meta.emoji}, change` : 'Add an icon'} aria-expanded={emojiOpen} disabled={readOnly} onClick={() => setEmojiOpen(!emojiOpen)}>{meta.emoji || '＋'}</button>
                {emojiOpen && (
                  <div className="o-pop o-emojis" role="menu">
                    {EMOJIS.map((e) => <button key={e} type="button" role="menuitem" aria-label={`Use ${e}`} onClick={() => { setEmojiOpen(false); setMeta({ emoji: e }); }}>{e}</button>)}
                    {meta.emoji && <button type="button" role="menuitem" onClick={() => { setEmojiOpen(false); setMeta({ emoji: null }); }}>Remove</button>}
                  </div>
                )}
              </span>
            )}
            <input id="o-note-title" className="o-title-input" value={doc.title} placeholder="Untitled note" onChange={(e) => patch({ title: e.target.value })} disabled={readOnly} />
          </div>
          {locked && <p className="o-quiet" role="note">This note is locked. Unlock it from the ··· menu to edit.</p>}
          <div className="o-tags">
            {doc.tags.map((t) => (
              <span key={t} className="o-chip">
                <i style={{ background: levelVar(levelOf(mastery.get(t)?.score)) }} />{topicName(t)}
                {!doc.isDeleted && <button type="button" aria-label={`Take off ${t}`} onClick={() => note.removeTag(t)}><X size={12} strokeWidth={2.6} /></button>}
              </span>
            ))}
            {!doc.isDeleted && (tagDraft === null ? (
              <button type="button" className="o-add-tag" onClick={() => setTagDraft('')}>+ topic</button>
            ) : (
              <input
                className="o-tag-input"
                aria-label="Add to a topic"
                autoFocus
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(tagDraft); } if (e.key === 'Escape') setTagDraft(null); }}
                onBlur={() => (tagDraft.trim() ? addTag(tagDraft) : setTagDraft(null))}
                placeholder="topic"
              />
            ))}
          </div>
          {findOpen && !readOnly && (
            <div className="o-find" role="search" aria-label="Find and replace">
              <input aria-label="Find" autoFocus value={findText} onChange={(e) => setFindText(e.target.value)} placeholder="Find" onKeyDown={(e) => { if (e.key === 'Escape') setFindOpen(false); }} />
              <input aria-label="Replace with" value={replText} onChange={(e) => setReplText(e.target.value)} placeholder="Replace with" onKeyDown={(e) => { if (e.key === 'Escape') setFindOpen(false); }} />
              <label className="o-find-case"><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case</label>
              <span className="o-quiet" role="status" aria-live="polite">{findText ? `${matches} ${matches === 1 ? 'match' : 'matches'}` : ''}</span>
              <button type="button" className="o-btn small" disabled={!matches} onClick={doReplace}>Replace all</button>
              <button type="button" className="o-btn ghost small" aria-label="Close find" onClick={() => setFindOpen(false)}><X size={14} /></button>
            </div>
          )}
          {!readOnly && !String(doc.content || '').trim() && (
            <div className="o-templates" role="group" aria-label="Start from a template">
              <span className="o-quiet">Start from a template</span>
              {TEMPLATES.map((t) => <button key={t.id} type="button" className="o-chip" onClick={() => applyTemplate(t)}>{t.name}</button>)}
            </div>
          )}
          <div className="o-body">
            <BlockEditor noteId={doc.id} key={editorKey} initialContent={doc.content} onChange={(md) => patch({ content: md })} editable={!readOnly} />
          </div>
          {!readOnly && <p className="o-quiet" style={{ margin: '6px 0 0', fontSize: 12.5 }}>Type <kbd>/</kbd> for commands, <kbd>@</kbd> to link a note.</p>}
          <p className="o-wc" aria-label="Word count">{wordCount} {wordCount === 1 ? 'word' : 'words'} · {String(doc.content || '').length} characters · {readMin} min read</p>
        </div>

        <aside className="o-rail" aria-label="Links">
          <section>
            <h2 className="o-h3">CONNECTED TO</h2>
            <div className="o-chips">
              {tags.map((t) => (
                <button key={t} type="button" className="o-chip" onClick={() => showTopic(t)}>
                  <i style={{ background: levelVar(levelOf(mastery.get(t)?.score)) }} />{topicName(t)}
                </button>
              ))}
              {linked.map((t) => (
                <Link key={t.id} to="/tasks" className="o-chip task">{t.text}{t.deadline ? ` · ${dayWord(t.deadline)}` : ''}</Link>
              ))}
              {tags.length === 0 && linked.length === 0 && <span className="o-quiet" style={{ fontSize: 13 }}>Not on the map yet. Add a topic to place it.</span>}
            </div>
          </section>

          {outline.length > 1 && (
            <section>
              <h2 className="o-h3">OUTLINE</h2>
              <nav className="o-outline" aria-label="Outline">
                {outline.map((h, i) => (
                  <button key={`${i}-${h.text}`} type="button" style={{ paddingLeft: (h.level - 1) * 12 }} onClick={() => jumpTo(h)}>{h.text}</button>
                ))}
              </nav>
            </section>
          )}

          {linked.length > 0 && (
            <section>
              <h2 className="o-h3">TASKS ON THIS NOTE</h2>
              {linked.map((t) => (
                <label key={t.id} className="o-linked-task">
                  <input type="checkbox" checked={!!t.completed} onChange={async () => { try { await todosAPI.update(t.id, { completed: !t.completed }); } catch (e) { console.error(e); } finally { queryClient.invalidateQueries({ queryKey: ['todos'] }); } }} aria-label={`Done: ${t.text}`} />
                  <span className={t.completed ? 'done' : ''}>{t.text}</span>
                </label>
              ))}
            </section>
          )}

          {suggestions.length > 0 && (
            <section>
              <h2 className="o-h3">PEBLO SUGGESTS A LINK</h2>
              {suggestions.map((s) => (
                <div key={s.key} className="o-suggest">
                  {s.kind === 'tag' ? (
                    <span>Your <b>{s.other.title || 'Untitled'}</b> note looks related. Put this note on <b>{topicName(s.tag)}</b> too?</span>
                  ) : (
                    <span>This note may help with <b>{s.task.text}</b>. Attach it to that task?</span>
                  )}
                  <div className="o-btns">
                    <button type="button" className="o-btn small" onClick={() => accept(s)}>{s.kind === 'tag' ? 'Link' : 'Attach'}</button>
                    <button type="button" className="o-btn ghost small" onClick={() => setDismissed((d) => [...d, s.key])}>Not now</button>
                  </div>
                </div>
              ))}
            </section>
          )}

          <section className="o-bank">
            <b>{bank ?? 0} Q</b>
            <span>{bank ? 'in your quiz bank come from this note' : 'Quiz this note\'s topic and its questions will come from notes like this one'}</span>
          </section>
        </aside>
      </div>
    </article>
  );
}
