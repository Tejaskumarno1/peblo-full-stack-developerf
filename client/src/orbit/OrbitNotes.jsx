import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Loader2, X, Network } from 'lucide-react';
import { notesAPI, todosAPI, hubAPI, studyAPI } from '../api';
import BlockEditor from '../components/BlockEditor';
import useNoteDoc from '../hooks/useNoteDoc';
import { useOrbit, useDismiss } from './OrbitShell';
import { topicName, levelOf, levelVar, tagsOfNote, agoText, shortDate } from './orbitUtils';
import { snippetOf } from '../soft/softUtils';
import { clock, dayWord } from '../river/riverUtils';

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
  const menuRef = useDismiss(menu, () => setMenu(false));
  const [dismissed, setDismissed] = useState([]);

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
    <article className="o-sheet" style={{ top: 92, width: 876 }} aria-label="Note">
      <SheetHead onBack={back}>
        <span className="crumb">{space ? topicName(space) : 'Map'}</span>
        {topic && (
          <>
            <ChevronRight size={14} strokeWidth={2.2} style={{ color: 'var(--o-fg2)' }} />
            <span className="topic"><i style={{ borderColor: levelVar(levelOf(mastery.get(topic)?.score)) }} />{topicName(topic)}</span>
          </>
        )}
        <span className="grow" />
        <span className="status">{doc.isDraft ? 'NEW NOTE' : status}</span>
        {!doc.isDraft && (
          <div className="o-menu-wrap" ref={menuRef}>
            <button type="button" className="o-btn ghost small" style={{ height: 44, width: 44, padding: 0 }} aria-label="More" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>···</button>
            {menu && (
              <div className="o-pop right" role="menu" style={{ width: 210 }}>
                {doc.isDeleted && <button type="button" role="menuitem" onClick={() => { setMenu(false); note.restore(); }}>Restore</button>}
                {!doc.isDeleted && <button type="button" role="menuitem" onClick={() => { setMenu(false); note.archive('/'); }}>{doc.isArchived ? 'Unarchive' : 'Archive'}</button>}
                <button type="button" role="menuitem" onClick={() => { setMenu(false); note.exportMd(); }}>Export as Markdown</button>
                <button type="button" role="menuitem" style={{ color: 'var(--o-weak-ink)' }} onClick={() => { setMenu(false); note.trash('/notes'); }}>{doc.isDeleted ? 'Delete forever' : 'Move to Trash'}</button>
              </div>
            )}
          </div>
        )}
      </SheetHead>

      <div className="o-sheet-body">
        <div className="o-sheet-main">
          <span className="o-eyebrow">NOTE · {doc.isDraft ? 'NOT SAVED YET' : `WRITTEN ${shortDate(created)}`}{doc.isDeleted ? ' · IN TRASH' : doc.isArchived ? ' · ARCHIVED' : ''}</span>
          <label htmlFor="o-note-title" className="o-sr">Title</label>
          <input id="o-note-title" className="o-title-input" value={doc.title} placeholder="Untitled note" onChange={(e) => patch({ title: e.target.value })} disabled={doc.isDeleted} />
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
          <div className="o-body">
            <BlockEditor key={editorKey} initialContent={doc.content} onChange={(md) => patch({ content: md })} editable={!doc.isDeleted} formattingToolbar={false} />
          </div>
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

/* ------------------------------------------------------------------ */

function OrbitNoteList({ onNew }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const topic = params.get('topic');
  const { notes, mastery, space } = useOrbit();
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(null); // null | 'archive' | 'trash'
  const { data: special = [] } = useQuery({
    queryKey: ['notes', 'orbit', archived],
    queryFn: () => notesAPI.getAll({ sort: 'updated', ...(archived === 'archive' ? { archived: 'true' } : { deleted: 'true' }) }).then((r) => r.data.notes || []),
    enabled: !!archived,
  });

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = (archived ? special : notes)
      .filter((n) => !topic || tagsOfNote(n).includes(topic))
      .filter((n) => !s || (n.title || '').toLowerCase().includes(s) || (n.content || '').toLowerCase().includes(s));
    // Each note goes under its most specific topic (the tag the fewest notes share)
    const counts = new Map();
    for (const n of notes) for (const t of tagsOfNote(n)) counts.set(t, (counts.get(t) || 0) + 1);
    const map = new Map();
    for (const n of list) {
      const own = tagsOfNote(n).filter((x) => x !== topic);
      const t = own.sort((a, b) => (counts.get(a) || 0) - (counts.get(b) || 0))[0] || topic || '';
      if (!map.has(t)) map.set(t, []);
      map.get(t).push(n);
    }
    return [...map.entries()].sort((a, b) => (a[0] === '') - (b[0] === '') || b[1].length - a[1].length);
  }, [notes, special, archived, topic, space, q]);

  return (
    <article className="o-sheet" style={{ top: 92, width: 876 }} aria-label="Notes">
      <SheetHead onBack={() => navigate('/')}>
        <span className="crumb">Notes</span>
        {topic && (<><ChevronRight size={14} strokeWidth={2.2} style={{ color: 'var(--o-fg2)' }} /><span className="topic"><i style={{ borderColor: levelVar(levelOf(mastery.get(topic)?.score)) }} />{topicName(topic)}</span></>)}
        <span className="grow" />
        <div className="o-chips">
          {topic && <button type="button" className="o-chip" onClick={() => setParams({})}>All notes</button>}
          <button type="button" className={`o-chip${archived === 'archive' ? ' on' : ''}`} onClick={() => setArchived(archived === 'archive' ? null : 'archive')}>Archive</button>
          <button type="button" className={`o-chip${archived === 'trash' ? ' on' : ''}`} onClick={() => setArchived(archived === 'trash' ? null : 'trash')}>Trash</button>
        </div>
      </SheetHead>
      <div className="o-list">
        <div className="o-list-head">
          <h1>{archived === 'archive' ? 'Archive' : archived === 'trash' ? 'Trash' : topic ? topicName(topic) : 'Every note'}</h1>
          <span className="grow" />
          <label htmlFor="o-note-search" className="o-sr">Search notes</label>
          <input id="o-note-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes…" />
          <button type="button" className="o-btn small" style={{ height: 42 }} onClick={() => onNew(topic ? [topic] : space ? [space] : [])}>New note</button>
        </div>
        {groups.length === 0 && <p className="o-quiet">{q ? 'No notes match.' : archived ? 'Nothing here.' : 'No notes yet.'}</p>}
        {groups.map(([t, list]) => (
          <section key={t || 'none'} className="o-group">
            <div className="o-group-head">
              <i style={{ borderColor: t ? levelVar(levelOf(mastery.get(t)?.score)) : 'var(--o-line)' }} />
              {t ? topicName(t) : 'Not on a topic yet'}
              <span>{list.length} NOTE{list.length === 1 ? '' : 'S'}</span>
            </div>
            <div className="o-group-items">
              {list.map((n) => (
                <Link key={n.id} to={`/notes/${n.id}`} className="o-note-tile">
                  <span className="t">{n.title || 'Untitled'}</span>
                  <span className="s">{snippetOf(n.content, 120) || 'Empty note'}</span>
                  <span className="m">EDITED {agoText(n.updatedAt).toUpperCase()}</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}

