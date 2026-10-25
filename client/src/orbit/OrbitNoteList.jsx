import { Fragment, useMemo, useState } from 'react';
import LiveDot from '../components/LiveDot';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Network, Star, Check } from 'lucide-react';
import { notesAPI } from '../api';
import { useOrbit } from './OrbitShell';
import { topicName, levelOf, levelVar, tagsOfNote, agoText } from './orbitUtils';
import { snippetOf } from '../soft/softUtils';
import useNoteSearch from '../hooks/useNoteSearch';
import { downloadText, safeFileName } from '../utils/download';

// PEB-124/125/126/127/128/129/130/131/132/133/134/135: the Orbit "Every note" list.
const BIG_GROUP = 12; // a group with more notes than this starts folded
const PAGE_FIRST = 8;
const PAGE_MORE = 12;
const VIEW_KEY = 'peblo-orbit-notes-view';
const PIN_KEY = 'peblo-orbit-pinned';
const RECENT_KEY = 'peblo-orbit-recent';

const read = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } };

const DAY = 86400000;
const DATE_RANGES = [['any', 'Any time'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days']];

/** Wraps the part of `text` that matches `q` in <mark>. */
function Hit({ text, q }) {
  const s = (q || '').trim();
  if (!s) return text;
  const at = text.toLowerCase().indexOf(s.toLowerCase());
  if (at < 0) return text;
  return <>{text.slice(0, at)}<mark>{text.slice(at, at + s.length)}</mark>{text.slice(at + s.length)}</>;
}

/** The bit of the note around the first match, so a hit inside the body can be seen. */
function snippetFor(content, q) {
  const s = (q || '').trim().toLowerCase();
  const plain = snippetOf(content, 4000) || '';
  if (!s) return plain.slice(0, 120);
  const at = plain.toLowerCase().indexOf(s);
  if (at < 0) return plain.slice(0, 120);
  const from = Math.max(0, at - 30);
  return (from > 0 ? '…' : '') + plain.slice(from, from + 120);
}

function dateBucket(iso, now) {
  const d = new Date(iso);
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const age = Math.floor((start - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / DAY);
  if (age <= 0) return ['0', 'Today'];
  if (age === 1) return ['1', 'Yesterday'];
  if (age < 7) return ['2', 'Earlier this week'];
  if (age < 30) return ['3', 'Earlier this month'];
  return ['4', 'Older'];
}

export default function OrbitNoteList({ onNew }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const topic = params.get('topic');
  const { notes, mastery, space } = useOrbit();
  const saved = read(VIEW_KEY, {});
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(null); // null | 'archive' | 'trash'
  const [sort, setSortState] = useState(saved.sort || 'edited');
  const [groupBy, setGroupByState] = useState(saved.groupBy || 'topic');
  const [view, setViewState] = useState(saved.view || 'grid');
  const [range, setRange] = useState('any');
  const [openMap, setOpenMap] = useState({});
  const [shown, setShown] = useState({});
  const [pinned, setPinned] = useState(() => read(PIN_KEY, []));
  const [recent, setRecent] = useState(() => read(RECENT_KEY, []));
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState([]);
  const [tagDraft, setTagDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  // Saved searches are shared with the other styles (same storage key).
  const [savedQ, setSavedQ] = useState(() => read('peblo-saved-searches', []));
  const saveSearch = () => { const t = q.trim(); if (!t || savedQ.includes(t)) return; const n = [t, ...savedQ].slice(0, 8); setSavedQ(n); write('peblo-saved-searches', n); };
  const dropSearch = (t) => { const n = savedQ.filter((x) => x !== t); setSavedQ(n); write('peblo-saved-searches', n); };

  const remember = (patch) => write(VIEW_KEY, { sort, groupBy, view, ...patch });
  const setSort = (v) => { setSortState(v); remember({ sort: v }); };
  const setGroupBy = (v) => { setGroupByState(v); remember({ groupBy: v }); };
  const setView = (v) => { setViewState(v); remember({ view: v }); };

  const { data: special = [] } = useQuery({
    queryKey: ['notes', 'orbit', archived],
    queryFn: () => notesAPI.getAll({ sort: 'updated', ...(archived === 'archive' ? { archived: 'true' } : { deleted: 'true' }) }).then((r) => r.data.notes || []),
    enabled: !!archived,
  });

  const allTopics = useMemo(() => {
    const c = new Map();
    for (const n of notes) for (const t of tagsOfNote(n)) c.set(t, (c.get(t) || 0) + 1);
    return c;
  }, [notes]);

  const { hits } = useNoteSearch(q, archived === 'archive' ? { archived: 'true' } : archived === 'trash' ? { deleted: 'true' } : {});
  const filtering = !!q.trim() || !!topic || range !== 'any';
  const clearFilters = () => { setQ(''); setRange('any'); setParams({}); };

  const { groups, total } = useMemo(() => {
    const s = q.trim().toLowerCase();
    const hitIds = hits ? new Set(hits.map((h) => h.id)) : null;
    const now = Date.now();
    const key = sort === 'created' ? 'createdAt' : 'updatedAt';
    const list = (archived ? special : notes)
      .filter((n) => !topic || tagsOfNote(n).includes(topic))
      .filter((n) => range === 'any' || new Date(n.updatedAt) >= now - Number(range) * DAY)
      .filter((n) => !s || (hitIds ? hitIds.has(n.id) : (n.title || '').toLowerCase().includes(s) || (n.content || '').toLowerCase().includes(s)))
      .sort((a, b) => (sort === 'title'
        ? (a.title || 'Untitled').localeCompare(b.title || 'Untitled', undefined, { sensitivity: 'base' })
        : new Date(b[key]) - new Date(a[key])));
    const out = [];
    let rest = list;
    if (!archived) {
      const pins = list.filter((n) => pinned.includes(n.id));
      if (pins.length) { out.push({ key: 'pinned', label: 'Pinned', notes: pins }); rest = list.filter((n) => !pinned.includes(n.id)); }
    }
    if (groupBy === 'none') {
      if (rest.length) out.push({ key: 'all', label: 'All notes', notes: rest });
    } else if (groupBy === 'date') {
      const map = new Map();
      for (const n of rest) {
        const [order, label] = dateBucket(n[key], now);
        if (!map.has(order)) map.set(order, { key: `d${order}`, label, notes: [] });
        map.get(order).notes.push(n);
      }
      out.push(...[...map.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g));
    } else {
      // Each note goes under its most specific topic (the tag the fewest notes share)
      const map = new Map();
      for (const n of rest) {
        const own = tagsOfNote(n).filter((x) => x !== topic);
        const t = own.sort((a, b) => (allTopics.get(a) || 0) - (allTopics.get(b) || 0))[0] || topic || '';
        if (!map.has(t)) map.set(t, { key: t || 'none', label: t ? topicName(t) : 'Not on a topic yet', tag: t, notes: [] });
        map.get(t).notes.push(n);
      }
      out.push(...[...map.entries()].sort((a, b) => (a[0] === '') - (b[0] === '') || b[1].notes.length - a[1].notes.length).map(([, g]) => g));
    }
    return { groups: out, total: list.length };
  }, [notes, special, archived, topic, range, q, sort, groupBy, pinned, allTopics, hits]);

  const isOpen = (g) => openMap[g.key] ?? (g.notes.length <= BIG_GROUP || filtering || groupBy === 'none' || g.key === 'pinned');
  const allOpen = groups.every(isOpen);
  const setAll = (v) => setOpenMap(Object.fromEntries(groups.map((g) => [g.key, v])));

  const togglePin = (id) => {
    const next = pinned.includes(id) ? pinned.filter((x) => x !== id) : [id, ...pinned];
    setPinned(next); write(PIN_KEY, next);
  };
  const opened = (id) => {
    const next = [id, ...recent.filter((x) => x !== id)].slice(0, 8);
    setRecent(next); write(RECENT_KEY, next);
  };
  const recentNotes = recent.map((id) => notes.find((n) => n.id === id)).filter(Boolean).slice(0, 5);

  const togglePick = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const stopPicking = () => { setPicking(false); setPicked([]); setTagDraft(''); };
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['notes'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const bulk = async (label, fn) => {
    setBusy(true);
    let failed = 0;
    for (const id of picked) { try { await fn(id); } catch { failed += 1; } }
    setBusy(false);
    refresh();
    setMsg(failed ? `${label}: ${picked.length - failed} done, ${failed} failed.` : `${label}: ${picked.length} note${picked.length === 1 ? '' : 's'}.`);
    stopPicking();
  };
  const emptyTrash = async () => {
    setBusy(true);
    let failed = 0;
    const ids = special.map((n) => n.id);
    for (const id of ids) { try { await notesAPI.delete(id); } catch { failed += 1; } }
    setBusy(false);
    setConfirmEmpty(false);
    refresh();
    setMsg(failed ? `Deleted ${ids.length - failed}, ${failed} failed.` : `Trash emptied: ${ids.length} note${ids.length === 1 ? '' : 's'} deleted.`);
  };
  const bulkTag = () => {
    const t = tagDraft.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-');
    if (!t) return;
    bulk(`Added #${t} to`, (id) => {
      const n = notes.find((x) => x.id === id) || special.find((x) => x.id === id);
      const tags = Array.isArray(n?.tags) ? n.tags : [];
      return tags.includes(t) ? Promise.resolve() : notesAPI.update(id, { tags: [...tags, t] });
    });
  };
  const bulkExport = () => {
    const chosen = (archived ? special : notes).filter((n) => picked.includes(n.id));
    const text = chosen.map((n) => `# ${n.title || 'Untitled'}\n\n${n.content || ''}`).join('\n\n---\n\n');
    downloadText(chosen.length === 1 ? `${safeFileName(chosen[0].title)}.md` : 'peblo-notes.md', text, 'text/markdown');
    setMsg(`Exported ${chosen.length} note${chosen.length === 1 ? '' : 's'}.`);
    stopPicking();
  };

  const tile = (n) => (
    <div key={n.id} className={`o-tile${picked.includes(n.id) ? ' picked' : ''}`}>
      {picking ? (
        <label className="o-tile-pick">
          <input type="checkbox" checked={picked.includes(n.id)} onChange={() => togglePick(n.id)} aria-label={`Select ${n.title || 'Untitled'}`} />
        </label>
      ) : !archived && (
        <button type="button" className={`o-pin${pinned.includes(n.id) ? ' on' : ''}`} aria-pressed={pinned.includes(n.id)} aria-label={`${pinned.includes(n.id) ? 'Unpin' : 'Pin'} ${n.title || 'Untitled'}`} title={pinned.includes(n.id) ? 'Unpin' : 'Pin to the top'} onClick={() => togglePin(n.id)}>
          <Star size={15} strokeWidth={2.2} fill={pinned.includes(n.id) ? 'currentColor' : 'none'} />
        </button>
      )}
      <Link to={`/notes/${n.id}`} className="o-note-tile" onClick={(e) => { if (picking) { e.preventDefault(); togglePick(n.id); } else opened(n.id); }}>
        <span className="t"><LiveDot id={n.id} />{n.meta?.emoji ? `${n.meta.emoji} ` : ''}<Hit text={n.title || 'Untitled'} q={q} /></span>
        <span className="s">{snippetFor(n.content, q) ? <Hit text={snippetFor(n.content, q)} q={q} /> : 'Empty note'}</span>
        <span className="m">{archived === 'trash' && n.deletedAt ? `DELETED ${agoText(n.deletedAt).toUpperCase()}` : sort === 'created' ? `CREATED ${agoText(n.createdAt).toUpperCase()}` : `EDITED ${agoText(n.updatedAt).toUpperCase()}`}</span>
      </Link>
      {archived && !picking && (
        <button type="button" className="o-chip o-restore" disabled={busy} aria-label={`${archived === 'trash' ? 'Restore' : 'Unarchive'} ${n.title || 'Untitled'}`}
          onClick={async () => {
            try { await (archived === 'trash' ? notesAPI.restore(n.id) : notesAPI.archive(n.id)); setMsg(archived === 'trash' ? 'Restored.' : 'Moved back to your notes.'); refresh(); } catch (e) { console.error(e); setMsg("Couldn't do that. Try again."); }
          }}>
          {archived === 'trash' ? 'Restore' : 'Unarchive'}
        </button>
      )}
    </div>
  );

  const empty = groups.length === 0;
  return (
    <article className="o-sheet" style={{ top: 92, width: 876 }} aria-label="Notes">
      <header className="o-sheet-head">
        <span className="crumb">Notes</span>
        {topic && (<><ChevronRight size={14} strokeWidth={2.2} style={{ color: 'var(--o-fg2)' }} /><span className="topic"><i style={{ borderColor: levelVar(levelOf(mastery.get(topic)?.score)) }} />{topicName(topic)}</span></>)}
        <span className="grow" />
        <div className="o-chips">
          <button type="button" className={`o-chip${archived === 'archive' ? ' on' : ''}`} onClick={() => { stopPicking(); setArchived(archived === 'archive' ? null : 'archive'); }}>Archive</button>
          <button type="button" className={`o-chip${archived === 'trash' ? ' on' : ''}`} onClick={() => { stopPicking(); setArchived(archived === 'trash' ? null : 'trash'); }}>Trash</button>
        </div>
        <button type="button" className="o-btn ghost small" style={{ height: 44 }} onClick={() => navigate('/')}><Network size={16} strokeWidth={2.2} /> Back to map</button>
      </header>
      <div className="o-list">
        <div className="o-list-head">
          <h1>{archived === 'archive' ? 'Archive' : archived === 'trash' ? 'Trash' : topic ? topicName(topic) : 'Every note'}</h1>
          <span className="grow" />
          <label htmlFor="o-note-search" className="o-sr">Search notes</label>
          <input id="o-note-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes…" />
          {q.trim() && <button type="button" className="o-chip" onClick={saveSearch} disabled={savedQ.includes(q.trim())}>{savedQ.includes(q.trim()) ? 'Saved' : 'Save search'}</button>}
          <button type="button" className="o-btn small" style={{ height: 42 }} onClick={() => onNew(topic ? [topic] : space ? [space] : [])}>New note</button>
        </div>

        <div className="o-toolbar" role="group" aria-label="Sort, filter and view">
          <label>Sort
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort notes">
              <option value="edited">Recently edited</option>
              <option value="created">Newest first</option>
              <option value="title">Title A–Z</option>
            </select>
          </label>
          <label>Group
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} aria-label="Group notes by">
              <option value="topic">By topic</option>
              <option value="date">By date</option>
              <option value="none">No groups</option>
            </select>
          </label>
          <label>Topic
            <select value={topic || ''} onChange={(e) => setParams(e.target.value ? { topic: e.target.value } : {})} aria-label="Filter by topic">
              <option value="">All topics</option>
              {[...allTopics.keys()].sort().map((t) => <option key={t} value={t}>{topicName(t)}</option>)}
            </select>
          </label>
          <label>Date
            <select value={range} onChange={(e) => setRange(e.target.value)} aria-label="Filter by date edited">
              {DATE_RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <span className="grow" />
          <div className="o-seg" role="group" aria-label="Layout">
            <button type="button" className={view === 'grid' ? 'on' : ''} aria-pressed={view === 'grid'} onClick={() => setView('grid')}>Grid</button>
            <button type="button" className={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button>
          </div>
          {groups.length > 1 && <button type="button" className="o-chip" onClick={() => setAll(!allOpen)}>{allOpen ? 'Collapse all' : 'Expand all'}</button>}
          {!archived && <button type="button" className={`o-chip${picking ? ' on' : ''}`} aria-pressed={picking} onClick={() => (picking ? stopPicking() : setPicking(true))}>{picking ? 'Cancel' : 'Select'}</button>}
        </div>

        {savedQ.length > 0 && !archived && (
          <div className="o-saved" role="group" aria-label="Saved searches">
            <span>Saved searches</span>
            {savedQ.map((t) => (
              <span key={t} className={`o-saved-item${t === q.trim() ? ' on' : ''}`}>
                <button type="button" onClick={() => setQ(t)}>{t}</button>
                <button type="button" className="x" aria-label={`Forget the search ${t}`} onClick={() => dropSearch(t)}>×</button>
              </span>
            ))}
          </div>
        )}

        <div className="o-count" aria-live="polite">
          <span>{total} note{total === 1 ? '' : 's'}{filtering ? ' match' : ''}</span>
          {filtering && <button type="button" className="o-chip on" onClick={clearFilters}>Clear filters ×</button>}
          {msg && <span className="o-msg" role="status">{msg}</span>}
          {archived === 'trash' && special.length > 0 && !confirmEmpty && (
            <button type="button" className="o-chip danger" disabled={busy} onClick={() => setConfirmEmpty(true)}>Empty trash</button>
          )}
          {archived === 'trash' && confirmEmpty && (
            <span className="o-confirm" role="alertdialog" aria-label="Empty the trash?">
              Delete {special.length} note{special.length === 1 ? '' : 's'} forever? This can't be undone.
              <button type="button" className="o-chip danger" disabled={busy} onClick={emptyTrash}>Yes, delete forever</button>
              <button type="button" className="o-chip" onClick={() => setConfirmEmpty(false)}>Keep them</button>
            </span>
          )}
        </div>

        {picking && (
          <div className="o-bulk" role="toolbar" aria-label="Actions for selected notes">
            <b>{picked.length} selected</b>
            <button type="button" className="o-chip" onClick={() => setPicked(groups.flatMap((g) => g.notes.map((n) => n.id)))}>Select all shown</button>
            <input value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} placeholder="Add to topic…" aria-label="Topic to add" onKeyDown={(e) => { if (e.key === 'Enter' && picked.length) bulkTag(); }} />
            <button type="button" className="o-chip" disabled={!picked.length || busy || !tagDraft.trim()} onClick={bulkTag}>Add topic</button>
            <button type="button" className="o-chip" disabled={!picked.length || busy} onClick={bulkExport}>Export .md</button>
            <button type="button" className="o-chip" disabled={!picked.length || busy} onClick={() => bulk('Archived', (id) => notesAPI.archive(id))}>Archive</button>
            <button type="button" className="o-chip danger" disabled={!picked.length || busy} onClick={() => bulk('Moved to Trash', (id) => notesAPI.delete(id))}>Move to Trash</button>
          </div>
        )}

        {!filtering && !archived && !picking && recentNotes.length > 0 && (
          <section className="o-recent" aria-label="Recently opened">
            <span className="o-h3">RECENTLY OPENED</span>
            <div className="o-chips">
              {recentNotes.map((n) => <Link key={n.id} to={`/notes/${n.id}`} className="o-chip" onClick={() => opened(n.id)}>{n.title || 'Untitled'}</Link>)}
            </div>
          </section>
        )}

        {empty && (
          <div className="o-empty-list">
            {filtering ? (
              <><p className="o-quiet">No notes match{q.trim() ? ` “${q.trim()}”` : ''}.</p><button type="button" className="o-btn ghost small" onClick={clearFilters}>Clear filters</button></>
            ) : archived === 'archive' ? (
              <p className="o-quiet">Nothing archived. Archive a note from its ⋯ menu to keep it out of the way without deleting it.</p>
            ) : archived === 'trash' ? (
              <p className="o-quiet">The trash is empty. Notes you delete wait here so you can bring them back.</p>
            ) : (
              <><p className="o-quiet">No notes yet. Write your first one and tag it, like #dbms, to put it on the map.</p><button type="button" className="o-btn small" onClick={() => onNew(space ? [space] : [])}>Write a note</button></>
            )}
          </div>
        )}

        {groups.map((g) => {
          const open = isOpen(g);
          const limit = shown[g.key] || PAGE_FIRST;
          return (
            <Fragment key={g.key}>
              <section className="o-group">
                <button type="button" className="o-group-head" aria-expanded={open} onClick={() => setOpenMap((m) => ({ ...m, [g.key]: !open }))}>
                  <ChevronRight size={14} strokeWidth={2.4} className={`chev${open ? ' open' : ''}`} />
                  {groupBy === 'topic' && g.key !== 'pinned' && <i style={{ borderColor: g.tag ? levelVar(levelOf(mastery.get(g.tag)?.score)) : 'var(--o-line)' }} />}
                  {g.key === 'pinned' && <Star size={14} strokeWidth={2.2} fill="currentColor" />}
                  {g.label}
                  <span>{g.notes.length} NOTE{g.notes.length === 1 ? '' : 'S'}</span>
                </button>
                {open && <div className={`o-group-items${view === 'list' ? ' as-list' : ''}`}>{g.notes.slice(0, limit).map(tile)}</div>}
                {open && g.notes.length > limit && (
                  <button type="button" className="o-more" onClick={() => setShown((s) => ({ ...s, [g.key]: limit + PAGE_MORE }))}>
                    Show {Math.min(PAGE_MORE, g.notes.length - limit)} more · {g.notes.length - limit} left
                  </button>
                )}
              </section>
            </Fragment>
          );
        })}
      </div>
    </article>
  );
}
