import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Check, Loader2, X } from 'lucide-react';
import { notesAPI, todosAPI, riverAPI } from '../api';
import BlockEditor from '../components/BlockEditor';
import useNoteDoc from '../hooks/useNoteDoc';
import { RiverHeader, useDismiss } from './RiverShell';
import { snippetOf } from '../soft/softUtils';
import { startOfDay, addDays, sameDay, momentOf, dueMomentOf, isMeeting, clock, dayWord } from './riverUtils';

const fullDay = (d) => new Date(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });

/** River · Notes: the list (notes down the river by day) or one note in its moment (mockup: RiverNote). */
export default function RiverNotes() {
  const note = useNoteDoc();
  if (note.routeId || note.doc) return <RiverNote note={note} />;
  return <RiverNoteList onNew={() => note.startDraft()} />;
}

/* ------------------------------------------------------------------ */

function RiverNote({ note }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { doc, editorKey, patch, noteId, saved, saveStatus } = note;
  const [menu, setMenu] = useState(false);
  const menuRef = useDismiss(menu, () => setMenu(false));
  const [tagDraft, setTagDraft] = useState(null);
  const [toast, setToast] = useState('');
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2400); };

  const written = doc ? new Date(doc.createdAt) : new Date();
  const day = startOfDay(written);
  const now = new Date();

  // Everything on the river that day, for the strip
  const { data: dayTodos = [] } = useQuery({
    queryKey: ['todos', 'range', 'river-day', day.toISOString()],
    queryFn: () => todosAPI.getRange(day.toISOString(), addDays(day, 1).toISOString()).then((r) => r.data.todos || []),
    enabled: !!doc,
  });
  const { data: linked = [] } = useQuery({
    queryKey: ['todos', 'note', noteId],
    queryFn: () => todosAPI.getAll({ noteId }).then((r) => r.data.todos || []),
    enabled: !!noteId,
  });
  const { data: promiseGens = [] } = useQuery({
    queryKey: ['river', 'promises', noteId],
    queryFn: () => riverAPI.promises(noteId).then((r) => r.data.promises || []),
    enabled: !!noteId,
  });
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState('');

  const stops = useMemo(() => {
    if (!doc) return [];
    const list = dayTodos.map((t) => {
      const at = isMeeting(t) ? momentOf(t) : dueMomentOf(t);
      return { key: t.id, at, label: `${t.text} · ${clock(at)}`, kind: isMeeting(t) ? 'meet' : 'task', todo: t };
    });
    list.push({ key: 'me', at: written, me: true, label: `This note · ${clock(written)}` });
    if (sameDay(now, written)) list.push({ key: 'now', at: now, now: true, label: `Now · ${clock(now)}` });
    list.sort((a, b) => a.at - b.at);
    // Keep the six closest to this note
    while (list.length > 6) {
      const first = list[0];
      const last = list[list.length - 1];
      if (first.me || first.now) list.pop();
      else if (last.me || last.now) list.shift();
      else if (Math.abs(first.at - written) > Math.abs(last.at - written)) list.shift();
      else list.pop();
    }
    return list;
  }, [dayTodos, doc?.id, written.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!doc) {
    return (
      <>
        <RiverHeader><Link to="/" className="r-back"><ChevronLeft size={16} /> Back to the river</Link></RiverHeader>
        <div className="r-sheet" style={{ alignItems: 'center', justifyContent: 'center', flex: 1 }}><Loader2 className="r-spin" /></div>
      </>
    );
  }

  const gen = promiseGens[0];
  const items = (gen?.items || []).map((p, index) => ({ ...p, index })).filter((p) => p.status !== 'ignored');
  const meetingsUsed = linked.filter(isMeeting);
  const tasksUsed = linked.filter((t) => !isMeeting(t));

  const find = async () => {
    if (!noteId) return;
    note.forceSave();
    setFinding(true);
    setFindError('');
    try {
      await riverAPI.findPromises(noteId);
      queryClient.invalidateQueries({ queryKey: ['river', 'promises'] });
    } catch (err) {
      setFindError(err.response?.data?.error || 'Peblo could not read the note. Check Your AI.');
    } finally {
      setFinding(false);
    }
  };
  const putOnRiver = async (p) => {
    let due = p.due ? new Date(p.due) : null;
    if (!due) { due = addDays(startOfDay(), 1); due.setHours(9, 0, 0, 0); }
    const text = p.owner && p.owner.toLowerCase() !== 'you' ? `${p.text} (${p.owner})` : p.text;
    const { data } = await todosAPI.create({ text, deadline: due.toISOString(), noteId, priority: 'medium' });
    await riverAPI.setPromise(gen.id, p.index, 'added', data.todo?.id);
    queryClient.invalidateQueries({ queryKey: ['river', 'promises'] });
    queryClient.invalidateQueries({ queryKey: ['todos'] });
    flash(`On the river · ${dayWord(due)}, ${clock(due)}`);
  };
  const ignore = async (p) => {
    await riverAPI.setPromise(gen.id, p.index, 'ignored');
    queryClient.invalidateQueries({ queryKey: ['river', 'promises'] });
  };

  const edited = new Date(doc.updatedAt || doc.createdAt);
  const meta = [fullDay(written), `written ${clock(written)}`];
  if (edited - written > 10 * 60000) meta.push(`edited ${sameDay(edited, written) ? clock(edited) : dayWord(edited).toLowerCase()}`);

  const addTag = (raw) => { note.addTag(raw); setTagDraft(null); };

  return (
    <>
      <RiverHeader>
        <Link to="/" className="r-back" onClick={() => note.forceSave()}><ChevronLeft size={16} strokeWidth={2.4} /> Back to the river</Link>
        <span className="r-meta-line">{doc.isDraft ? 'New note' : meta.join(' · ')}</span>
      </RiverHeader>

      <section aria-label="Where this note sits in your day" className="r-strip">
        <div className="r-strip-line" />
        <div className="r-strip-row">
          {stops.map((s) => (s.me ? (
            <span key={s.key} className="r-stop"><span className="me">{s.label}</span></span>
          ) : (
            <button
              key={s.key}
              type="button"
              className={`r-stop${s.at > now ? ' future' : ''}`}
              onClick={() => (s.todo ? navigate('/', { state: { select: s.todo.id } }) : navigate('/'))}
            >
              <span className={`dot${s.now ? ' now' : s.kind === 'task' ? ' task' : ''}`} />
              <span className="lbl">{s.label}</span>
            </button>
          )))}
        </div>
      </section>

      <div className="r-note-grid">
        <article className="r-sheet">
          <div className="r-eyebrow">
            <span>NOTE{doc.tags[0] ? ` · ${doc.tags[0]}` : ''}{doc.isDeleted ? ' · IN TRASH' : doc.isArchived ? ' · ARCHIVED' : ''}</span>
            <span className="grow" />
            <span className={`r-saved${saveStatus === 'error' ? ' bad' : ''}`}>{saveStatus === 'saving' ? <Loader2 size={13} className="r-spin" /> : saveStatus === 'saved' ? <Check size={13} strokeWidth={2.6} /> : null}{saved}</span>
            {!doc.isDraft && (
              <div className="r-menu-wrap" ref={menuRef}>
                <button type="button" className="r-btn ghost small" aria-label="More" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>···</button>
                {menu && (
                  <div className="r-pop right" role="menu" style={{ width: 210, letterSpacing: 0, textTransform: 'none' }}>
                    {doc.isDeleted && <button type="button" role="menuitem" onClick={() => { setMenu(false); note.restore(); }}>Restore</button>}
                    {!doc.isDeleted && <button type="button" role="menuitem" onClick={() => { setMenu(false); note.archive('/'); }}>{doc.isArchived ? 'Unarchive' : 'Archive'}</button>}
                    <button type="button" role="menuitem" onClick={() => { setMenu(false); note.exportMd(); }}>Export as Markdown</button>
                    <button type="button" role="menuitem" style={{ color: 'var(--r-now-ink)' }} onClick={() => { setMenu(false); note.trash('/notes'); }}>{doc.isDeleted ? 'Delete forever' : 'Move to Trash'}</button>
                  </div>
                )}
              </div>
            )}
          </div>
          <label htmlFor="r-note-title" className="r-sr">Title</label>
          <input id="r-note-title" className="r-title-input" value={doc.title} placeholder="Untitled note" onChange={(e) => patch({ title: e.target.value })} disabled={doc.isDeleted} />
          <div className="r-note-tags">
            {doc.tags.map((t) => (
              <span key={t} className="r-tag">#{t}{!doc.isDeleted && <button type="button" aria-label={`Remove tag ${t}`} onClick={() => note.removeTag(t)}><X size={12} strokeWidth={2.6} /></button>}</span>
            ))}
            {!doc.isDeleted && (tagDraft === null ? (
              <button type="button" className="r-add-tag" onClick={() => setTagDraft('')}>+ tag</button>
            ) : (
              <input
                className="r-tag-input"
                aria-label="New tag"
                autoFocus
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(tagDraft); } if (e.key === 'Escape') setTagDraft(null); }}
                onBlur={() => (tagDraft.trim() ? addTag(tagDraft) : setTagDraft(null))}
                placeholder="tag"
              />
            ))}
          </div>
          <div className="r-body">
            <BlockEditor key={editorKey} initialContent={doc.content} onChange={(md) => patch({ content: md })} editable={!doc.isDeleted} formattingToolbar={false} />
          </div>
        </article>

        <aside className="r-side" aria-label="What this note led to">
          <section className="r-card" aria-labelledby="r-promises">
            <h2 id="r-promises" className="r-h3">{gen ? `PEBLO FOUND ${items.length} PROMISE${items.length === 1 ? '' : 'S'}` : 'PROMISES IN THIS NOTE'}</h2>
            {!gen && !finding && <p className="r-quiet small">Peblo can read this note for things people said they would do, with who and by when, and put them on the river.</p>}
            {gen && items.length === 0 && !finding && <p className="r-quiet small">Nobody promised anything in this note.</p>}
            {finding && <p className="r-quiet small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Loader2 size={14} className="r-spin" /> Reading the note…</p>}
            {findError && <p className="r-err">{findError}</p>}
            {!finding && items.map((p) => (
              <div key={p.index} className={`r-promise${p.status === 'added' ? ' added' : ''}`}>
                <span className="t">{p.text}</span>
                <span className="m">Owner {p.owner || 'you'} · {p.due ? `by ${dayWord(p.due).toLowerCase()}${new Date(p.due).getHours() ? `, ${clock(p.due)}` : ''}` : 'no date said'}</span>
                {p.status === 'added' ? (
                  <span className="m" style={{ fontWeight: 700 }}>On the river</span>
                ) : (
                  <div className="r-btns">
                    <button type="button" className="r-btn small" onClick={() => putOnRiver(p)}>Put on river · {p.due ? dayWord(p.due) : 'tomorrow'}</button>
                    <button type="button" className="r-btn ghost small" onClick={() => ignore(p)}>Ignore</button>
                  </div>
                )}
              </div>
            ))}
            {!finding && noteId && !doc.isDeleted && (
              <button type="button" className="r-btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={find}>{gen ? 'Look again' : 'Find promises'}</button>
            )}
          </section>

          <section className="r-card fill" aria-labelledby="r-used">
            <h2 id="r-used" className="r-h3">USED IN</h2>
            {linked.length === 0 && <p className="r-quiet small">Nothing on the river points here yet. Promises you put on the river, and meetings you take notes in, show up here.</p>}
            {meetingsUsed.map((t) => (
              <button key={t.id} type="button" className="r-used meet" style={{ border: 'none', font: 'inherit', cursor: 'pointer', textAlign: 'left' }} onClick={() => navigate('/', { state: { select: t.id } })}>
                <span>{t.text}</span><span className="m">{dayWord(momentOf(t))} {clock(momentOf(t))}</span>
              </button>
            ))}
            {tasksUsed.map((t) => {
              const due = dueMomentOf(t);
              return (
                <button key={t.id} type="button" className="r-used task" style={{ border: 'none', font: 'inherit', cursor: 'pointer', textAlign: 'left' }} onClick={() => navigate('/', { state: { select: t.id } })}>
                  <span style={{ textDecoration: t.completed ? 'line-through' : 'none' }}>{t.text}</span>
                  <span className={`m${due && !t.completed && sameDay(due, now) ? ' hot' : ''}`}>{t.completed ? 'done' : due ? `due ${dayWord(due).toLowerCase()} ${clock(due)}` : 'no date'}</span>
                </button>
              );
            })}
          </section>
        </aside>
      </div>
      {toast && <div className="r-toast" role="status">{toast}</div>}
    </>
  );
}

/* ------------------------------------------------------------------ */

function RiverNoteList({ onNew }) {
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const params = filter === 'archive' ? { archived: 'true' } : filter === 'trash' ? { deleted: 'true' } : filter === 'all' ? {} : { tag: filter };
  const { data: all = [] } = useQuery({
    queryKey: ['notes', 'sidebar'],
    queryFn: () => notesAPI.getAll({ sort: 'updated' }).then((r) => r.data.notes || []),
  });
  const { data: listed = [] } = useQuery({
    queryKey: ['notes', 'river', filter],
    queryFn: () => notesAPI.getAll({ sort: 'updated', ...params }).then((r) => r.data.notes || []),
  });

  const tags = useMemo(() => {
    const m = new Map();
    for (const n of all) for (const t of n.tags || []) m.set(t, (m.get(t) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [all]);

  const days = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = listed
      .filter((n) => !s || (n.title || '').toLowerCase().includes(s) || (n.content || '').toLowerCase().includes(s))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const groups = [];
    for (const n of list) {
      const d = startOfDay(n.createdAt);
      let g = groups[groups.length - 1];
      if (!g || g.d.getTime() !== d.getTime()) { g = { d, notes: [] }; groups.push(g); }
      g.notes.push(n);
    }
    return groups;
  }, [listed, q]);

  return (
    <>
      <RiverHeader>
        <div className="r-when"><h1>Notes</h1><span>{all.length} on the river · newest first</span></div>
      </RiverHeader>
      <div className="r-list-grid">
        <section className="r-list" aria-label="Notes by day">
          <div className="r-list-head">
            <h1>{filter === 'archive' ? 'Archive' : filter === 'trash' ? 'Trash' : filter === 'all' ? 'Every note' : `#${filter}`}</h1>
            <span className="grow" />
            <label htmlFor="r-note-search" className="r-sr">Search notes</label>
            <input id="r-note-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes…" />
            <button type="button" className="r-btn" onClick={onNew}>New note</button>
          </div>
          {days.length === 0 && <p className="r-quiet">{q ? 'No notes match.' : filter === 'trash' ? 'The Trash is empty.' : filter === 'archive' ? 'Nothing archived.' : 'No notes yet. Write one and it lands on the river at the time you wrote it.'}</p>}
          {days.map((g) => (
            <div key={g.d.toISOString()} className="r-day">
              <span className={`r-day-label${sameDay(g.d, new Date()) ? ' today' : ''}`}>{dayWord(g.d)}</span>
              <div className="r-day-items">
                {g.notes.map((n) => (
                  <Link key={n.id} to={`/notes/${n.id}`} className="r-row">
                    <span className="tm">{clock(n.createdAt)}</span>
                    <span style={{ minWidth: 0 }}>
                      <span className="t">{n.title || 'Untitled'}</span>
                      <span className="s" style={{ display: 'block' }}>{snippetOf(n.content, 140) || 'Empty note'}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </section>
        <aside className="r-side">
          <section className="r-card">
            <h2 className="r-h3">SHOW</h2>
            <div className="r-filters">
              <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
              {tags.slice(0, 10).map(([t, n]) => (
                <button key={t} type="button" aria-pressed={filter === t} onClick={() => setFilter(t)}>#{t} · {n}</button>
              ))}
            </div>
            <div className="r-filters">
              <button type="button" aria-pressed={filter === 'archive'} onClick={() => setFilter('archive')}>Archive</button>
              <button type="button" aria-pressed={filter === 'trash'} onClick={() => setFilter('trash')}>Trash</button>
            </div>
          </section>
          <section className="r-card">
            <h2 className="r-h3">HOW NOTES WORK HERE</h2>
            <p className="r-quiet small">Every note sits on the river at the moment you wrote it, next to the meetings and tasks around it. Open one and Peblo can find the promises in it.</p>
          </section>
        </aside>
      </div>
    </>
  );
}
