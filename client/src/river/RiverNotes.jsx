import { useEffect, useMemo, useState } from 'react';
import LiveDot from '../components/LiveDot';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Undo2, Archive, Copy, FileDown, FileText, History, Layers, ListChecks, Pin, Share2, Sparkles, Trash2, ChevronLeft, Check, Loader2, X } from 'lucide-react';
import { notesAPI, todosAPI, riverAPI } from '../api';
import BlockEditor from '../components/BlockEditor';
import useNoteDoc from '../hooks/useNoteDoc';
import UndoToast from '../components/UndoToast';
import { RiverHeader, useDismiss } from './RiverShell';
import { snippetOf } from '../soft/softUtils';
import ShareDialog from '../soft/ShareDialog';
import VersionDiff from '../soft/VersionDiff';
import { relTime } from '../soft/softUtils';
import '../soft/dialogs.css';
import useNoteSearch from '../hooks/useNoteSearch';
import { startOfDay, addDays, sameDay, momentOf, dueMomentOf, isMeeting, clock, dayWord, fromNow } from './riverUtils';
import { parseTask } from '../utils/parseTask';
import RSelect from './RSelect';
import FolderDialog from '../soft/FolderDialog';
import TagManager from '../soft/TagManager';
import Gallery from '../soft/Gallery';
import { exportMarkdown, exportManyMarkdown, exportWord, exportPdf } from '../utils/exportNote';

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
  const navigate2 = useNavigate();
  const qc2 = useQueryClient();
  const [shareOpen, setShareOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [diffV, setDiffV] = useState(null);
  const { data: versions = [] } = useQuery({
    queryKey: ['notes', 'backups', doc?.id],
    queryFn: () => notesAPI.getBackups(doc.id).then((r) => r.data.backups || r.data || []),
    enabled: !!doc?.id && !doc?.isDraft && histOpen,
  });
  useEffect(() => {
    if (!histOpen || diffV) return undefined;
    const k = (e) => { if (e.key === 'Escape') setHistOpen(false); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [histOpen, diffV]);
  const askAbout = (text) => {
    note.forceSave?.();
    navigate2(`/ai?${new URLSearchParams({ q: text, note: doc.id, noteTitle: doc.title || 'This note' }).toString()}`);
  };
  const restoreVersion = async (v) => {
    await notesAPI.revertBackup(doc.id, v.id);
    const { data } = await notesAPI.get(doc.id);
    note.open(data.note);
    qc2.invalidateQueries({ queryKey: ['notes'] });
  };
  const menuRef = useDismiss(menu, () => setMenu(false));
  const [tagDraft, setTagDraft] = useState(null);
  const [toast, setToast] = useState('');
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2400); };
  const [ignoredActs, setIgnoredActs] = useState([]);
  const actionItems = useMemo(() => {
    const out = [];
    for (const line of String(doc?.content || '').split('\n')) {
      const m = line.match(/^\s*[-*]\s+\[ \]\s+(.+)$/);
      if (!m) continue;
      let raw = m[1].trim();
      let owner = null;
      const o = raw.match(/^([A-Z][\w'’-]*)\s*:\s+(.*)$/);
      if (o) { owner = o[1]; raw = o[2]; }
      const t = parseTask(raw);
      if (!t.text) continue;
      out.push({ key: t.text + '|' + out.length, text: t.text, owner, due: t.deadline, allDay: t.allDay, priority: t.priority });
    }
    return out;
  }, [doc?.content]);

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
  // The last time this meeting happened (same title, earlier, with notes): what those notes were and what is still open
  const meetingUsed = linked.find(isMeeting);
  const { data: prev = null } = useQuery({
    queryKey: ['river', 'last-time', meetingUsed?.id],
    enabled: !!meetingUsed,
    queryFn: async () => {
      const m = momentOf(meetingUsed);
      const r = await todosAPI.getRange(addDays(m, -120).toISOString(), m.toISOString());
      const key = meetingUsed.text.trim().toLowerCase();
      const same = (r.data.todos || [])
        .filter((t) => t.id !== meetingUsed.id && isMeeting(t) && t.noteId && t.text.trim().toLowerCase() === key && momentOf(t) < m)
        .sort((a, b) => momentOf(b) - momentOf(a))[0];
      if (!same) return null;
      const [note, gens] = await Promise.all([
        notesAPI.get(same.noteId).then((x) => x.data.note),
        riverAPI.promises(same.noteId).then((x) => x.data.promises || []).catch(() => []),
      ]);
      return { todo: same, note, open: gens.flatMap((g) => g.items || []).filter((i) => i.status === 'open') };
    },
  });
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState('');

  const stops = useMemo(() => {
    if (!doc) return [];
    // a meeting note marks the meeting itself on the strip, not the moment it was written
    const mid = meetingUsed?.id || doc.forTask?.id;
    const own = mid ? dayTodos.find((t) => t.id === mid && isMeeting(t)) : null;
    const list = dayTodos.filter((t) => !own || t.id !== own.id).map((t) => {
      const at = isMeeting(t) ? momentOf(t) : dueMomentOf(t);
      return { key: t.id, at, label: `${t.text} · ${clock(at)}`, kind: isMeeting(t) ? 'meet' : 'task', todo: t };
    });
    list.push(own ? { key: 'me', at: momentOf(own), me: true, label: `This meeting · ${clock(momentOf(own))}` } : { key: 'me', at: written, me: true, label: `This note · ${clock(written)}` });
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
  }, [dayTodos, doc?.id, written.getTime(), meetingUsed?.id, doc?.forTask?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const actTitle = (a) => (a.owner && a.owner.toLowerCase() !== 'you' ? `${a.text} (${a.owner})` : a.text);
  const acts = actionItems.filter((a) => !ignoredActs.includes(a.text)).map((a) => ({ ...a, onRiver: linked.some((t) => t.text === actTitle(a)) }));
  const actDue = (a) => {
    if (a.due) return new Date(a.due);
    const d = addDays(startOfDay(), 1);
    d.setHours(9, 0, 0, 0);
    return d;
  };
  const putAct = async (a, quiet) => {
    const due = actDue(a);
    await todosAPI.create({ text: actTitle(a), deadline: due.toISOString(), noteId, priority: a.priority || 'medium' });
    queryClient.invalidateQueries({ queryKey: ['todos'] });
    if (!quiet) flash(`On the river · ${dayWord(due)}, ${clock(due)}`);
  };
  const putAllActs = async () => {
    const todo = acts.filter((a) => !a.onRiver);
    for (const a of todo) await putAct(a, true);
    flash(`${todo.length} on the river`);
  };

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
  const who = meetingUsed && meetingUsed.meta && meetingUsed.meta.attendees;
  if (who && who.length) meta.push(`with ${who.join(', ')}`);
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
            <span className={`r-saved${saveStatus === 'error' ? ' bad' : ''}`}>{saveStatus === 'saving' ? <Loader2 size={13} className="r-spin" /> : saveStatus === 'saved' && !(doc.isDraft && /^Not saved/.test(saved)) ? <Check size={13} strokeWidth={2.6} /> : null}{saved}</span>
            {!doc.isDraft && (
              <div className="r-menu-wrap" ref={menuRef}>
                <button type="button" className="r-btn ghost small" aria-label="More" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>···</button>
                {menu && (
                  <div className="r-pop right" role="menu" style={{ width: 210, letterSpacing: 0, textTransform: 'none' }}>
                    {doc.isDeleted && <button type="button" role="menuitem" onClick={() => { setMenu(false); note.restore(); }}><Undo2 size={15} />Restore</button>}
                    {!doc.isDeleted && <button type="button" role="menuitem" onClick={() => { setMenu(false); note.archive('/'); }}><Archive size={15} />{doc.isArchived ? 'Unarchive' : 'Archive'}</button>}
                    {!doc.isDeleted && !doc.isDraft && <button type="button" role="menuitem" onClick={() => { setMenu(false); setShareOpen(true); }}><Share2 size={15} />Share link…</button>}
                    {!doc.isDraft && !doc.isDeleted && <button type="button" role="menuitem" onClick={async () => {
              setMenu(false);
              const next = !doc.meta?.pinned;
              const pinnedCount = (note.allNotes || []).filter((n) => n.meta?.pinned && !n.isDeleted && !n.isArchived).length;
              if (next && pinnedCount >= 3) { setToast('You can pin up to 3 notes. Unpin one first.'); return; }
              try { await notesAPI.update(doc.id, { meta: { pinned: next } }); note.patch({ meta: { ...(doc.meta || {}), pinned: next || undefined } }); qc2.invalidateQueries({ queryKey: ['notes'] }); setToast(next ? 'Pinned to Home' : 'Unpinned'); } catch { setToast('Could not pin it'); }
            }}><Pin size={15} />{doc.meta?.pinned ? 'Unpin from Home' : 'Pin to Home'}</button>}
            {!doc.isDraft && !doc.isDeleted && <button type="button" role="menuitem" onClick={async () => {
              setMenu(false);
              try { note.forceSave?.(); const { data } = await notesAPI.create({ title: 'Copy of ' + (doc.title || 'Untitled'), content: doc.content || '', tags: doc.tags || [] }); qc2.invalidateQueries({ queryKey: ['notes'] }); navigate2('/notes/' + data.note.id); } catch { setToast('Could not duplicate the note'); }
            }}><Copy size={15} />Duplicate</button>}
            {!doc.isDraft && !doc.isDeleted && (
              <>
                <span className="r-pop-h">History and AI</span>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); note.forceSave?.(); setHistOpen(true); }}><History size={15} />Version history</button>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); askAbout('Summarise this note in a few short bullet points.'); }}><Sparkles size={15} />Summarise with AI</button>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); askAbout('Make 8 flashcards (question and answer) from this note.'); }}><Layers size={15} />Flashcards from this note</button>
                <button type="button" role="menuitem" onClick={() => { setMenu(false); askAbout('List the tasks and to-dos hidden in this note.'); }}><ListChecks size={15} />Find tasks in this note</button>
              </>
            )}
            <span className="r-pop-h">Download</span>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); exportMarkdown(doc).then(() => setToast('Downloaded as Markdown')); }}><FileText size={15} />Markdown (.md)</button>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); exportWord(doc).then(() => setToast('Downloaded as Word')); }}><FileText size={15} />Word (.doc)</button>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); setToast('Making the PDF'); exportPdf(doc).then(() => setToast('Downloaded as PDF')).catch(() => setToast('Could not make the PDF')); }}><FileDown size={15} />PDF (.pdf)</button>
                    <button type="button" role="menuitem" style={{ color: 'var(--r-now-ink)' }} onClick={() => { setMenu(false); note.trash('/notes'); }}><Trash2 size={15} />{doc.isDeleted ? 'Delete forever' : 'Move to Trash'}</button>
                  </div>
                )}
              </div>
            )}
          </div>
          <label htmlFor="r-note-title" className="r-sr">Title</label>
          <input id="r-note-title" className="r-title-input" value={doc.title} placeholder="Untitled note" onChange={(e) => patch({ title: e.target.value })} disabled={doc.isDeleted} />
          <div className="r-note-tags">
            {doc.tags.map((t) => (
              <span key={t} className="r-tag"><button type="button" className="r-tag-go" aria-label={`Show notes tagged #${t}`} onClick={() => { note.forceSave(); navigate('/notes', { state: { filter: t } }); }}>#{t}</button>{!doc.isDeleted && <button type="button" aria-label={`Remove tag ${t}`} onClick={() => note.removeTag(t)}><X size={12} strokeWidth={2.6} /></button>}</span>
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
            {histOpen && doc?.id && !diffV && (
        <div className="pb-dlg-host">
          <div className="s-share-back" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setHistOpen(false); }} onKeyDown={(e) => { if (e.key === 'Escape') setHistOpen(false); }}>
            <div className="s-share" role="dialog" aria-label="Version history">
              <div className="s-share-head"><b>Version history</b><button type="button" aria-label="Close" onClick={() => setHistOpen(false)}>×</button></div>
              {versions.length === 0 && <p className="s-share-msg">No earlier versions yet. They are kept as you edit.</p>}
              {versions.slice(0, 12).map((v) => (
                <button key={v.id} type="button" className="s-share-go" style={{ marginTop: 6, width: '100%' }} onClick={() => setDiffV(v)}>Compare with {relTime(v.createdAt)}</button>
              ))}
            </div>
          </div>
        </div>
      )}
      {diffV && doc?.id && <div className="pb-dlg-host"><VersionDiff doc={doc} version={diffV} onClose={() => { setDiffV(null); setHistOpen(false); }} onRestore={async (v) => { setDiffV(null); setHistOpen(false); await restoreVersion(v); }} /></div>}
      {shareOpen && doc?.id && <div className="pb-dlg-host"><ShareDialog kind="note" id={doc.id} title={doc.title} onClose={() => setShareOpen(false)} /></div>}
            <BlockEditor noteId={doc.id} key={editorKey} initialContent={doc.content} onChange={(md) => patch({ content: md })} editable={!doc.isDeleted} />
          </div>
        </article>

        <aside className="r-side" aria-label="What this note led to">
          {acts.length > 0 && !doc.isDeleted && (
            <section className="r-card" aria-labelledby="r-acts">
              <h2 id="r-acts" className="r-h3">ACTION ITEMS · {acts.length} FOUND</h2>
              {acts.map((a) => (
                <div key={a.key} className={`r-promise${a.onRiver ? ' added' : ''}`}>
                  <span className="t">{a.text}</span>
                  <span className="m">Owner {a.owner || 'you'} · {a.due ? `by ${new Date(a.due).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}${a.allDay ? '' : ', ' + clock(a.due)}` : 'no date said'}</span>
                  {a.onRiver ? (
                    <span className="m" style={{ fontWeight: 700 }}>On the river</span>
                  ) : (
                    <div className="r-btns">
                      <button type="button" className="r-btn small" onClick={() => putAct(a)}>Put on river · {a.due ? dayWord(a.due) : 'tomorrow'}</button>
                      <button type="button" className="r-btn ghost small" onClick={() => setIgnoredActs((l) => [...l, a.text])}>Ignore</button>
                    </div>
                  )}
                </div>
              ))}
              {acts.filter((a) => !a.onRiver).length > 1 && (
                <button type="button" className="r-btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={putAllActs}>Put all {acts.filter((a) => !a.onRiver).length} on the river</button>
              )}
            </section>
          )}
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

          {prev && (
            <section className="r-card" aria-labelledby="r-last">
              <h2 id="r-last" className="r-h3">LAST TIME · {dayWord(momentOf(prev.todo)).toUpperCase()}</h2>
              <Link to={`/notes/${prev.note.id}`} className="r-used task"><span>{prev.note.title || 'Untitled'}</span><span className="m">open</span></Link>
              {prev.open.length > 0 && <p className="r-quiet small">{prev.open.length} promise{prev.open.length === 1 ? '' : 's'} still open: {prev.open.slice(0, 2).map((p) => p.text).join('; ')}</p>}
            </section>
          )}
          {meetingUsed && !doc.isDeleted && (
            <section className="r-card" aria-labelledby="r-after">
              <h2 id="r-after" className="r-h3">AFTER THE MEETING</h2>
              <div className="r-btns">
                <button type="button" className="r-btn ghost small" onClick={() => { navigator.clipboard?.writeText(`# ${doc.title}\n\n${doc.content}`).then(() => flash('Notes copied'), () => flash('Could not copy')); }}>Copy notes</button>
                <button type="button" className="r-btn ghost small" onClick={() => window.dispatchEvent(new CustomEvent('peblo:capture', { detail: { mode: 'meeting', text: `Follow-up: ${meetingUsed.text} ` } }))}>Schedule a follow-up</button>
                {!doc.isDraft && <button type="button" className="r-btn ghost small" onClick={() => setShareOpen(true)}>Share notes as a link</button>}
              </div>
            </section>
          )}
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
      <UndoToast toast={note.actionToast} dismiss={note.dismissActionToast} />
    </>
  );
}

/* ------------------------------------------------------------------ */

const VIEW_KEY = 'peblo-river-notes-view';
const readView = () => { try { return localStorage.getItem(VIEW_KEY) === 'day' ? 'day' : 'recent'; } catch { return 'recent'; } };
const saveView = (v) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage blocked */ } };

/** "2 h ago" for the last day, then a plain date ("6 Oct", "6 Oct 2025"): never "Tue". */
function whenLabel(d) {
  const date = new Date(d);
  if (Date.now() - date.getTime() < 86400000) return fromNow(date);
  const opts = { day: 'numeric', month: 'short' };
  if (date.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString('en-GB', opts);
}
const GROUPS = [['month', 'Month'], ['day', 'Day'], ['tag', 'Tag'], ['letter', 'A to Z'], ['none', 'No grouping']];
const SORTS = [['edited', 'Recently edited'], ['written', 'Recently written'], ['title', 'Title A to Z'], ['oldest', 'Oldest first']];
const WHENS = [['any', 'Any time'], ['today', 'Today'], ['week', 'Past 7 days'], ['month', 'Past 30 days']];
const OPTS_KEY = 'peblo-river-notes-opts';
function readOpts() {
  const base = { group: 'month', sort: 'edited', when: 'any', pinned: false };
  try {
    const o = JSON.parse(localStorage.getItem(OPTS_KEY) || 'null');
    if (o) return { ...base, ...o };
    if (readView() === 'day') return { ...base, group: 'day', sort: 'written' };
  } catch { /* no storage */ }
  return base;
}
function saveOpts(o) { try { localStorage.setItem(OPTS_KEY, JSON.stringify(o)); } catch { /* no storage */ } }
const monthOf = (d) => new Date(d).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

/** A short piece of the note around the first word that matched. */
function matchSnippet(content, words, size = 150) {
  const text = snippetOf(content, 100000);
  const low = text.toLowerCase();
  let at = -1;
  for (const w of words) { at = low.indexOf(w); if (at >= 0) break; }
  if (at < 0) return text.slice(0, size);
  const from = Math.max(0, at - 40);
  return (from > 0 ? '…' : '') + text.slice(from, from + size) + (from + size < text.length ? '…' : '');
}
function Marked({ text, words }) {
  if (!words.length) return text;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

function NoteRow({ n, words = [], acts, basis = 'updatedAt', selecting = false, picked = false, onPick }) {
  const row = (
    <Link to={`/notes/${n.id}`} className={'r-row flat' + (selecting && picked ? ' picked' : '')} onClick={(e) => { if (selecting) { e.preventDefault(); onPick?.(); } }}>
      {selecting && <input type="checkbox" className="r-pick" aria-label={'Select ' + (n.title || 'Untitled')} checked={picked} readOnly />}
      <span className="tm">{whenLabel(n[basis])}<small>{basis === 'createdAt' ? 'written' : 'edited'}</small></span>
      <span style={{ minWidth: 0 }}>
        <span className="t"><LiveDot id={n.id} /><Marked text={n.title || 'Untitled'} words={words} /></span>
        <span className="s" style={{ display: 'block' }}>
          <Marked text={(words.length ? matchSnippet(n.content, words) : snippetOf(n.content, 140)) || 'Empty note'} words={words} />
        </span>
        {(n.tags || []).length > 0 && (
          <span className="r-row-tags">{n.tags.slice(0, 4).map((t) => <span key={t}>#{t}</span>)}</span>
        )}
      </span>
    </Link>
  );
  if (!acts) return row;
  return (
    <div className="r-rowx">
      {row}
      <div className="r-row-acts">
        {acts.map((a) => <button key={a.label} type="button" className={`r-btn ghost small${a.danger ? ' danger' : ''}`} onClick={() => a.run(n)}>{a.label}</button>)}
      </div>
    </div>
  );
}

function RiverNoteList({ onNew }) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState(() => location.state?.filter || 'all');
  const [moreTags, setMoreTags] = useState(false);
  const [opts, setOpts] = useState(readOpts);
  const { group, sort, when, pinned } = opts;
  const [collapsed, setCollapsed] = useState({});
  const [folderSel, setFolderSel] = useState('');
  const [onlyTasks, setOnlyTasks] = useState(false);
  const [onlyPics, setOnlyPics] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [picked, setPicked] = useState([]);
  const [folderOpen, setFolderOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const goNote = useNavigate();
  const [msg, setMsg] = useState('');
  const [savedQ, setSavedQ] = useState(() => { try { return JSON.parse(localStorage.getItem('peblo-saved-searches') || '[]'); } catch { return []; } });
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 3000); };
  const setOpt = (k, v) => setOpts((o) => { const n = { ...o, [k]: v }; saveOpts(n); return n; });
  const [q, setQ] = useState('');
  const params = filter === 'archive' ? { archived: 'true' } : filter === 'trash' ? { deleted: 'true' } : filter === 'all' ? {} : { tag: filter };
  const { data: all = [] } = useQuery({
    queryKey: ['notes', 'sidebar'],
    queryFn: () => notesAPI.getAll({ sort: 'updated' }).then((r) => r.data.notes || []),
  });
  const { data: listed = [] } = useQuery({
    queryKey: ['notes', 'river', filter],
    queryFn: () => notesAPI.getAll({ sort: 'updated', ...(filter === 'archive' || filter === 'trash' ? {} : { snippet: '1' }), ...params }).then((r) => r.data.notes || []),
  });

  const tags = useMemo(() => {
    const m = new Map();
    for (const n of all) for (const t of n.tags || []) m.set(t, (m.get(t) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [all]);

  const words = useMemo(() => q.trim().toLowerCase().split(/\s+/).filter(Boolean), [q]);
  const searching = words.length > 0;
  const inBin = filter === 'archive' || filter === 'trash';
  const { hits: ranked } = useNoteSearch(q, filter === 'archive' ? { archived: 'true' } : filter === 'trash' ? { deleted: 'true' } : {});

  // Search looks in titles, tags and the text of every note (the Archive and Trash only search themselves),
  // best match first: a title that starts with the word, then a title that has it, then a tag, then the text.
  const results = useMemo(() => {
    if (!searching) return [];
    if (ranked) return ranked;
    const pool = inBin ? listed : all;
    const hits = [];
    for (const n of pool) {
      const title = (n.title || '').toLowerCase();
      const tagText = (n.tags || []).join(' ').toLowerCase();
      const body = (n.content || '').toLowerCase();
      let score = 0;
      let every = true;
      for (const w of words) {
        const s = title.startsWith(w) ? 4 : title.includes(w) ? 3 : tagText.includes(w) ? 2 : body.includes(w) ? 1 : 0;
        if (!s) { every = false; break; }
        score += s;
      }
      if (every) hits.push({ n, score });
    }
    return hits.sort((a, b) => b.score - a.score || new Date(b.n.updatedAt) - new Date(a.n.updatedAt)).map((h) => h.n);
  }, [searching, words, all, listed, inBin, ranked]);

  const byId = useMemo(() => new Map(all.map((n) => [n.id, n])), [all]);
  const folders = useMemo(() => [...new Set(all.map((n) => n.meta?.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [all]);
  const hasPic = (n) => /!\[|<figure>/.test((byId.get(n.id)?.content ?? n.content) || '');
  const basis = sort === 'written' ? 'createdAt' : 'updatedAt';
  const since = when === 'today' ? startOfDay().getTime() : when === 'week' ? Date.now() - 7 * 86400000 : when === 'month' ? Date.now() - 30 * 86400000 : 0;
  const items = useMemo(() => {
    const l = listed.filter((n) => (!since || new Date(n[basis]).getTime() >= since) && (!pinned || n.meta?.pinned)
      && (!folderSel || (n.meta?.folder || '') === (folderSel === '__none' ? '' : folderSel))
      && (!onlyTasks || n.taskCount > 0) && (!onlyPics || hasPic(n)));
    const by = sort === 'title' ? (a, b) => (a.title || 'Untitled').localeCompare(b.title || 'Untitled')
      : sort === 'oldest' ? (a, b) => new Date(a.updatedAt) - new Date(b.updatedAt)
        : (a, b) => new Date(b[basis]) - new Date(a[basis]);
    return [...l].sort(by);
  }, [listed, since, pinned, sort, basis, folderSel, onlyTasks, onlyPics, byId]);
  const plain = group === 'month' && sort === 'edited' && when === 'any' && !pinned && filter === 'all' && !folderSel && !onlyTasks && !onlyPics;
  const latest = plain ? items.slice(0, 4) : [];
  const groups = useMemo(() => {
    const rest = plain ? items.slice(4) : items;
    if (group === 'none') return [{ label: '', notes: rest }];
    const key = group === 'month' ? (n) => monthOf(n[basis]).toUpperCase()
      : group === 'day' ? (n) => dayWord(startOfDay(n[basis])).toUpperCase()
        : group === 'tag' ? (n) => ((n.tags || [])[0] ? '#' + n.tags[0] : 'UNTAGGED')
          : (n) => (((n.title || '').trim()[0]) || '#').toUpperCase();
    const map = new Map();
    for (const n of rest) { const k = key(n); if (!map.has(k)) map.set(k, []); map.get(k).push(n); }
    const arr = [...map.entries()].map(([label, notes]) => ({ label, notes }));
    if (group === 'tag') arr.sort((a, b) => (a.label === 'UNTAGGED') - (b.label === 'UNTAGGED') || b.notes.length - a.notes.length);
    return arr;
  }, [items, group, basis, plain]);
  const changed = group !== 'month' || sort !== 'edited' || when !== 'any' || pinned || !!folderSel || onlyTasks || onlyPics;
  const resetOpts = () => { const n = { group: 'month', sort: 'edited', when: 'any', pinned: false }; setOpts(n); saveOpts(n); setFolderSel(''); setOnlyTasks(false); setOnlyPics(false); };
  const ck = (label) => group + ':' + label;
  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed[ck(g.label)]);
  const collapseAll = () => setCollapsed(Object.fromEntries(groups.map((g) => [ck(g.label), true])));
  const expandAll = () => setCollapsed({});
  const saveSearch = () => { const t = q.trim(); if (!t || savedQ.includes(t)) return; const n = [t, ...savedQ].slice(0, 8); setSavedQ(n); try { localStorage.setItem('peblo-saved-searches', JSON.stringify(n)); } catch { /* no storage */ } };
  const dropSearch = (t) => { const n = savedQ.filter((x) => x !== t); setSavedQ(n); try { localStorage.setItem('peblo-saved-searches', JSON.stringify(n)); } catch { /* no storage */ } };
  const full = (list) => list.map((n) => byId.get(n.id) || n);
  const togglePick = (n) => setPicked((p) => (p.includes(n.id) ? p.filter((x) => x !== n.id) : [...p, n.id]));
  const endSelect = () => { setPicked([]); setSelectMode(false); };
  const bulk = async (kind) => {
    if (!picked.length) return;
    if (kind === 'trash' && !window.confirm('Move ' + picked.length + ' note(s) to the Trash?')) return;
    if (kind === 'forever' && !window.confirm('Delete ' + picked.length + ' note(s) forever? This cannot be undone.')) return;
    try {
      for (const id of picked) {
        if (kind === 'archive' || kind === 'unarchive') await notesAPI.archive(id);
        else if (kind === 'restore') await notesAPI.restore(id);
        else await notesAPI.delete(id, kind === 'forever' ? { permanent: true } : undefined);
      }
      flash(({ archive: 'Archived', unarchive: 'Unarchived', restore: 'Restored', trash: 'Moved to the Trash', forever: 'Deleted' })[kind]);
      refresh();
    } catch { flash('Something went wrong'); }
    endSelect();
  };
  const moveTo = async (name) => {
    setFolderOpen(false);
    try {
      for (const id of picked) await notesAPI.update(id, { meta: { folder: name || '' } });
      flash(name ? 'Moved to ' + name : 'Taken out of its folder');
      refresh();
    } catch { flash('Could not move them'); }
    endSelect();
  };
  const download = async () => {
    const list = picked.length ? full(items.filter((n) => picked.includes(n.id))) : full(items);
    if (!list.length) return;
    flash('Downloading ' + list.length + ' note' + (list.length === 1 ? '' : 's'));
    try { await exportManyMarkdown(list); } catch { flash('Could not download'); }
  };
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notes'] });
  // A failed request says so (the row stays as the server has it) instead of failing silently
  const attempt = async (fn, failed) => {
    try { await fn(); } catch { flash(failed); }
    refresh();
  };
  const actions = filter === 'archive'
    ? [
        { label: 'Unarchive', run: (n) => attempt(() => notesAPI.archive(n.id), 'Could not unarchive that note. Try again.') },
        { label: 'Move to Trash', danger: true, run: (n) => attempt(() => notesAPI.delete(n.id), 'Could not move that note to the Trash. Try again.') },
      ]
    : filter === 'trash'
      ? [
          { label: 'Restore', run: (n) => attempt(() => notesAPI.restore(n.id), 'Could not restore that note. Try again.') },
          { label: 'Delete forever', danger: true, run: async (n) => { if (!window.confirm('Delete this note forever? This cannot be undone.')) return; await attempt(() => notesAPI.delete(n.id, { permanent: true }), 'Could not delete that note. Try again.'); } },
        ]
      : null;
  const emptyTrash = async () => {
    if (!window.confirm(`Delete ${listed.length} note${listed.length === 1 ? '' : 's'} in the Trash forever? This cannot be undone.`)) return;
    await attempt(async () => { for (const n of listed) await notesAPI.delete(n.id, { permanent: true }); }, 'Could not empty the Trash. Try again.');
  };
  const shownTags = moreTags || tags.findIndex(([t]) => t === filter) >= 10 ? tags : tags.slice(0, 10);
  const title = filter === 'archive' ? 'Archive' : filter === 'trash' ? 'Trash' : filter === 'all' ? 'Every note' : `#${filter}`;
  const empty = filter === 'trash' ? 'The Trash is empty.' : filter === 'archive' ? 'Nothing archived.' : 'No notes yet. Write one and it lands on the river at the time you wrote it.';

  return (
    <>
      <RiverHeader>
        <div className="r-when"><h1>Notes</h1><span>{all.length} on the river</span></div>
      </RiverHeader>
      <div className="r-list-grid">
        <section className="r-list" aria-label="Notes">
          <div className="r-list-head">
            <h1>{title}</h1>
            <span className="grow" />
            <label htmlFor="r-note-search" className="r-sr">Search notes</label>
            <input
              id="r-note-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setQ(''); }}
              placeholder="Search titles, tags and text…"
            />
            {q.trim() && <button type="button" className="r-btn ghost small" onClick={saveSearch} disabled={savedQ.includes(q.trim())}>{savedQ.includes(q.trim()) ? 'Saved' : 'Save search'}</button>}
            {filter === 'trash' && listed.length > 0 && <button type="button" className="r-btn ghost danger" onClick={emptyTrash}>Empty Trash</button>}
            <button type="button" className="r-btn" onClick={onNew}>New note</button>
          </div>

          {!searching && (
            <div className="r-toolbar" role="toolbar" aria-label="Group, sort and filter notes">
              <RSelect label="Group by" value={group} options={GROUPS} onChange={(v) => setOpt('group', v)} />
              <RSelect label="Sort" value={sort} options={SORTS} onChange={(v) => setOpt('sort', v)} />
              <RSelect label="Show" value={when} options={WHENS} onChange={(v) => setOpt('when', v)} />
              <RSelect label="Folder" value={folderSel} options={[['', 'All folders'], ...folders.map((f) => [f, f]), ['__none', 'No folder']]} onChange={setFolderSel} />
              <button type="button" className={'r-pillbtn' + (pinned ? ' on' : '')} aria-pressed={pinned} onClick={() => setOpt('pinned', !pinned)}>Pinned</button>
              <button type="button" className={'r-pillbtn' + (onlyTasks ? ' on' : '')} aria-pressed={onlyTasks} onClick={() => setOnlyTasks((v) => !v)}>With tasks</button>
              <button type="button" className={'r-pillbtn' + (onlyPics ? ' on' : '')} aria-pressed={onlyPics} onClick={() => setOnlyPics((v) => !v)}>With pictures</button>
            </div>
          )}
          {!searching && (
            <div className="r-toolbar r-toolbar2">
              {group !== 'none' && groups.length > 0 && (
                <>
                  <button type="button" className="r-pillbtn" onClick={collapseAll} disabled={allCollapsed}>Collapse all</button>
                  <button type="button" className="r-pillbtn" onClick={expandAll} disabled={!Object.values(collapsed).some(Boolean)}>Expand all</button>
                </>
              )}
              <button type="button" className={'r-pillbtn' + (selectMode ? ' on' : '')} aria-pressed={selectMode} onClick={() => { setSelectMode((v) => !v); setPicked([]); }}>{selectMode ? 'Done selecting' : 'Select'}</button>
              <button type="button" className="r-pillbtn" onClick={download} disabled={items.length === 0}>{picked.length ? 'Download ' + picked.length : 'Download shown'}</button>
              <span className="grow" />
              {msg && <span className="r-quiet small" role="status">{msg}</span>}
              <span className="r-quiet small">{items.length} note{items.length === 1 ? '' : 's'}{changed ? ' · ' : ''}{changed && <button type="button" className="r-link" onClick={resetOpts}>Reset</button>}</span>
            </div>
          )}
          {!searching && selectMode && (
            <div className="r-bulk" role="toolbar" aria-label="Actions for the selected notes">
              <b>{picked.length} selected</b>
              <button type="button" className="r-btn ghost small" onClick={() => setPicked(items.map((n) => n.id))}>All</button>
              <button type="button" className="r-btn ghost small" onClick={() => setPicked([])} disabled={!picked.length}>None</button>
              {filter !== 'trash' && <button type="button" className="r-btn ghost small" disabled={!picked.length} onClick={() => setFolderOpen(true)}>Folder</button>}
              {filter === 'trash' ? (
                <>
                  <button type="button" className="r-btn ghost small" disabled={!picked.length} onClick={() => bulk('restore')}>Restore</button>
                  <button type="button" className="r-btn ghost small danger" disabled={!picked.length} onClick={() => bulk('forever')}>Delete forever</button>
                </>
              ) : (
                <>
                  <button type="button" className="r-btn ghost small" disabled={!picked.length} onClick={() => bulk(filter === 'archive' ? 'unarchive' : 'archive')}>{filter === 'archive' ? 'Unarchive' : 'Archive'}</button>
                  <button type="button" className="r-btn ghost small danger" disabled={!picked.length} onClick={() => bulk('trash')}>Trash</button>
                </>
              )}
            </div>
          )}
          {!searching && savedQ.length > 0 && null}
          {savedQ.length > 0 && (
            <div className="r-saved-q" aria-label="Saved searches">
              <span className="r-under-h">SAVED SEARCHES</span>
              {savedQ.map((t) => <span key={t} className={t === q.trim() ? 'on' : ''}><button type="button" onClick={() => setQ(t)}>{t}</button><button type="button" className="x" aria-label={'Forget the search ' + t} onClick={() => dropSearch(t)}>×</button></span>)}
            </div>
          )}

          {searching && msg && <p className="r-err" role="alert">{msg}</p>}
          {searching ? (
            <>
              <p className="r-quiet small">
                {results.length === 0 ? 'No notes match' : `${results.length} note${results.length === 1 ? '' : 's'} match`} “{q.trim()}”
                {inBin ? ` in ${title}` : ' in every note'} · best match first · <button type="button" className="r-link" onClick={() => setQ('')}>Clear</button>
              </p>
              <div className="r-flat">{results.map((n) => <NoteRow key={n.id} n={n} words={words} acts={actions} />)}</div>
            </>
          ) : listed.length === 0 ? (
            <p className="r-quiet">{empty}</p>
          ) : items.length === 0 ? (
            <p className="r-quiet">No notes match these settings. <button type="button" className="r-link" onClick={resetOpts}>Reset</button></p>
          ) : (
            <>
              {latest.length > 0 && (
                <div>
                  <h2 className="r-h3" style={{ marginBottom: 10 }}>PICK UP WHERE YOU LEFT OFF</h2>
                  <div className="r-recent">
                    {latest.map((n) => (
                      <Link key={n.id} to={`/notes/${n.id}`} className="r-recent-card">
                        <span className="w">{whenLabel(n.updatedAt)}</span>
                        <span className="t"><LiveDot id={n.id} />{n.title || 'Untitled'}</span>
                        <span className="s">{snippetOf(n.content, 90) || 'Empty note'}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              {groups.map((g) => (
                <div key={g.label || 'all'}>
                  {g.label && (
                    <h2 className="r-h3 r-gh" style={{ margin: '4px 0 8px' }}>
                      <button type="button" aria-expanded={!collapsed[ck(g.label)]} onClick={() => setCollapsed((c) => ({ ...c, [ck(g.label)]: !c[ck(g.label)] }))}>
                        <span className="chev" aria-hidden="true">{collapsed[ck(g.label)] ? '▸' : '▾'}</span>{g.label} <span className="r-count">{g.notes.length}</span>
                      </button>
                    </h2>
                  )}
                  {!collapsed[ck(g.label)] && <div className="r-flat">{g.notes.map((n) => <NoteRow key={n.id} n={n} acts={actions} basis={basis} selecting={selectMode} picked={picked.includes(n.id)} onPick={() => togglePick(n)} />)}</div>}
                </div>
              ))}
            </>
          )}
        </section>
        <aside className="r-side">
          <section className="r-card">
            <h2 className="r-h3">SHOW</h2>
            <div className="r-filters">
              <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
              {shownTags.map(([t, n]) => (
                <button key={t} type="button" aria-pressed={filter === t} onClick={() => setFilter(t)}>#{t} · {n}</button>
              ))}
              {tags.length > 10 && <button type="button" className="r-more-tags" onClick={() => setMoreTags((v) => !v)}>{moreTags ? 'Fewer tags' : `More tags (${tags.length - 10})`}</button>}
            </div>
            <div className="r-filters">
              <button type="button" aria-pressed={filter === 'archive'} onClick={() => setFilter('archive')}>Archive</button>
              <button type="button" aria-pressed={filter === 'trash'} onClick={() => setFilter('trash')}>Trash</button>
            </div>
            <div className="r-filters">
              <button type="button" onClick={() => setTagsOpen(true)}>Manage tags</button>
              <button type="button" onClick={() => setGalleryOpen(true)}>Pictures</button>
            </div>
          </section>
          <section className="r-card">
            <h2 className="r-h3">HOW TO LOOK</h2>
            <p className="r-quiet small"><b>Group by</b> month, day, tag or letter. <b>Sort</b> by what you touched last, what you wrote last, title or oldest. <b>Show</b> only recent notes or pinned ones. Your choices are remembered. Open a note and Peblo can find the promises in it.</p>
          </section>
        </aside>
      </div>
      {tagsOpen && <div className="pb-dlg-host"><TagManager onClose={() => setTagsOpen(false)} onChanged={refresh} /></div>}
      {galleryOpen && <div className="pb-dlg-host"><Gallery notes={all} onClose={() => setGalleryOpen(false)} onOpen={(id) => { setGalleryOpen(false); goNote('/notes/' + id); }} /></div>}
      {folderOpen && <div className="pb-dlg-host"><FolderDialog folders={folders} current="" count={picked.length} onPick={moveTo} onClose={() => setFolderOpen(false)} /></div>}
    </>
  );
}
