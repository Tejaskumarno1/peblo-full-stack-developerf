import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { todosAPI, notesAPI, riverAPI, hubAPI } from '../api';
import { useDismiss } from './RiverShell';
import { snippetOf } from '../soft/softUtils';
import {
  momentOf, endOf, dueMomentOf, isMeeting, isAllDay, clock, clockRange, dayWord, fromNow, sameDay, tagsOfTask,
} from './riverUtils';

const pad = (n) => String(n).padStart(2, '0');
const dateValue = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeValue = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** The selected meeting or task, under the river (mockup: the drawer in RiverHome). */
export default function RiverDrawer({ selected, meetings, tasks, notes, now, aiReady, onSelect, onToggle, flash }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [moveOpen, setMoveOpen] = useState(false);
  const moveRef = useDismiss(moveOpen, () => setMoveOpen(false));
  const meeting = selected && isMeeting(selected);

  const brief = useQuery({
    queryKey: ['river', 'brief', selected?.id],
    queryFn: () => riverAPI.brief(selected.id).then((r) => r.data),
    enabled: false,
    staleTime: Infinity,
    retry: false,
  });
  const related = useQuery({
    queryKey: ['river', 'related', selected?.id],
    queryFn: () => hubAPI.search(selected.text).then((r) => (r.data.sources || []).filter((s) => s.kind === 'note').slice(0, 3)),
    enabled: !!selected && !meeting && !selected.noteId,
    staleTime: 60000,
  });

  const at = selected ? (meeting ? momentOf(selected) : dueMomentOf(selected)) : null;

  // Things on the river closest in time to the selected one
  const near = useMemo(() => {
    if (!selected || !at) return [];
    const items = [
      ...meetings.filter((t) => t.id !== selected.id).map((t) => ({ id: t.id, title: t.text, at: momentOf(t), meta: `meeting · ${clock(momentOf(t))}`, todo: t })),
      ...tasks.filter((t) => t.id !== selected.id).map((t) => ({ id: t.id, title: t.text, at: dueMomentOf(t), meta: t.completed ? 'done' : `due ${clock(dueMomentOf(t))}`, hot: !t.completed && sameDay(dueMomentOf(t), now), todo: t })),
      ...notes.map((n) => ({ id: n.id, title: n.title || 'Untitled', at: new Date(n.createdAt), meta: `note · ${clock(n.createdAt)}`, note: n })),
    ];
    return items
      .filter((x) => Math.abs(x.at - at) < 36 * 3600000)
      .sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))
      .slice(0, 4)
      .map((x) => (sameDay(x.at, at) ? x : { ...x, meta: `${x.meta.split(' · ')[0]} · ${dayWord(x.at)}` }));
  }, [selected, at, meetings, tasks, notes, now]);

  if (!selected) {
    return (
      <section className="r-drawer" aria-label="Selected">
        <div className="r-empty-drawer">
          <h2>Nothing picked</h2>
          <p className="r-quiet">Click a meeting or task on the river to see it here. Double-click an empty spot to add one at that time.</p>
        </div>
      </section>
    );
  }

  const end = meeting ? (endOf(selected) || new Date(at.getTime() + 3600000)) : null;
  const tags = tagsOfTask(selected);
  const linkedNote = selected.noteId ? notes.find((n) => n.id === selected.noteId) || selected.note : null;

  let pill;
  let pillClass = '';
  if (meeting) {
    if (at <= now && end > now) { pill = 'Selected · happening now'; pillClass = 'hot'; }
    else if (at > now) pill = `Selected · ${sameDay(at, now) ? fromNow(at) : dayWord(at)}`;
    else pill = `Selected · ${sameDay(at, now) ? 'earlier today' : dayWord(at)}`;
  } else {
    pillClass = 'task';
    if (selected.completed) pill = 'Task · done';
    else if (!at) pill = 'Task · no date';
    else if (at < now) { pill = `Task · overdue ${fromNow(at).replace(' ago', '')}`; pillClass = 'hot'; }
    else { pill = `Task · due ${fromNow(at)}`; if (at - now < 3 * 3600000) pillClass = 'hot'; }
  }

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['todos'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  // Opens a blank draft linked to this task. The note is only created (and the task linked) once
  // you type something, so clicking "Take notes" and walking away leaves nothing behind.
  const takeNotes = () => {
    if (linkedNote) { navigate(`/notes/${linkedNote.id}`); return; }
    const qs = new URLSearchParams({ new: '1', forTask: selected.id, forTaskText: selected.text });
    if (tags.length) qs.set('tag', tags.join(','));
    navigate(`/notes?${qs.toString()}`);
  };

  const removeTodo = async () => {
    if (!window.confirm(`Delete "${selected.text}"? This cannot be undone.`)) return;
    try {
      await todosAPI.delete(selected.id);
      onSelect(null);
      flash('Deleted');
    } catch (e) {
      flash(e.response?.data?.error || 'Could not delete it. Try again.');
    } finally {
      refresh();
    }
  };

  const sourceTitle = (n) => brief.data?.sources.find((s) => s.n === n);

  return (
    <section className="r-drawer" aria-labelledby="rv-sel">
      <div className="r-col">
        <span className={`r-sel-pill${pillClass ? ` ${pillClass}` : ''}`}>{pill}</span>
        <h2 id="rv-sel" className="r-sel-title">{selected.text}</h2>
        <span className="r-sel-sub">
          {meeting
            ? `${clockRange(at, end)} · ${at.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}`
            : at
              ? `Due ${isAllDay(selected) ? dayWord(at).toLowerCase() : `${dayWord(at).toLowerCase()}, ${clock(at)}`} · ${selected.priority} priority`
              : `No date yet · ${selected.priority} priority`}
        </span>
        {tags.length > 0 && <div className="r-chips">{tags.map((t) => <span key={t} className="r-tag">#{t}</span>)}</div>}
        <span className="grow" />
        <div className="r-btns">
          {meeting ? (
            <button type="button" className="r-btn" onClick={takeNotes}>{linkedNote ? 'Open meeting notes' : 'Take notes in this meeting'}</button>
          ) : (
            <button type="button" className="r-btn" onClick={() => onToggle(selected)}>{selected.completed ? 'Not done yet' : 'Mark done'}</button>
          )}
          <button type="button" className="r-btn ghost" onClick={removeTodo}>Delete</button>
          <div className="r-menu-wrap" ref={moveRef}>
            <button type="button" className="r-btn ghost" aria-expanded={moveOpen} onClick={() => setMoveOpen((v) => !v)}>Move</button>
            {moveOpen && (
              <MoveForm
                todo={selected}
                meeting={meeting}
                at={at}
                end={end}
                onDone={(when) => {
                  setMoveOpen(false);
                  refresh();
                  if (when) { flash(`Moved to ${dayWord(when).toLowerCase()}, ${clock(when)}`); onSelect(selected.id, when); }
                }}
              />
            )}
          </div>
        </div>
      </div>

      <div className="r-col scroll">
        {meeting ? (
          <>
            <h3 className="r-h3">PEBLO'S BRIEF · FROM YOUR NOTES</h3>
            {brief.isFetching && <p className="r-quiet" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Loader2 size={15} className="r-spin" /> Reading the notes that mention it…</p>}
            {!brief.isFetching && brief.error && <p className="r-err">{brief.error.response?.data?.error || 'The brief could not be written.'}</p>}
            {!brief.isFetching && brief.data && brief.data.points.length > 0 && (
              <ul className="r-points">
                {brief.data.points.map((p, i) => (
                  <li key={i}>
                    {p.text}{' '}
                    {p.cite.map((n) => sourceTitle(n) && <Link key={n} to={`/notes/${sourceTitle(n).id}`}>[{sourceTitle(n).title}]</Link>)}
                  </li>
                ))}
              </ul>
            )}
            {!brief.isFetching && brief.data && brief.data.points.length === 0 && (
              <p className="r-quiet">None of your notes mention this meeting yet. Notes you take in it will feed the next brief.</p>
            )}
            {!brief.isFetching && !brief.data && (
              <>
                <p className="r-quiet">Peblo can read the notes that mention this meeting and pull out decisions, numbers and open questions.</p>
                {aiReady
                  ? <button type="button" className="r-btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => brief.refetch()}>{brief.error ? 'Try again' : 'Brief me from my notes'}</button>
                  : <Link to="/ai/connections" className="r-btn ghost" style={{ alignSelf: 'flex-start' }}>Set up AI first</Link>}
              </>
            )}
          </>
        ) : linkedNote ? (
          <>
            <h3 className="r-h3">LINKED NOTE</h3>
            <Link to={`/notes/${linkedNote.id}`} className="r-near" style={{ alignSelf: 'stretch' }}><span className="t">{linkedNote.title || 'Untitled'}</span><span className="m">open</span></Link>
            {linkedNote.content && <p className="r-snippet">{snippetOf(linkedNote.content, 320)}</p>}
          </>
        ) : (
          <>
            <h3 className="r-h3">NOTES THAT MENTION IT</h3>
            {related.isLoading && <p className="r-quiet small">Looking…</p>}
            {related.data && related.data.length === 0 && <p className="r-quiet">No note mentions this task yet.</p>}
            {(related.data || []).map((s) => (
              <Link key={s.id} to={`/notes/${s.id}`} className="r-near" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                <span className="t">{s.title}</span>
                <span className="r-quiet small" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.snippet}</span>
              </Link>
            ))}
          </>
        )}
      </div>

      <div className="r-col">
        <h3 className="r-h3">ON THE RIVER NEAR IT</h3>
        {near.length === 0 && <p className="r-quiet">Nothing else within a day and a half.</p>}
        {near.map((x) => (x.note ? (
          <Link key={x.id} to={`/notes/${x.id}`} className="r-near"><span className="t">{x.title}</span><span className="m">{x.meta}</span></Link>
        ) : (
          <button key={x.id} type="button" className="r-near" onClick={() => onSelect(x.id, x.at)}><span className="t">{x.title}</span><span className={`m${x.hot ? ' hot' : ''}`}>{x.meta}</span></button>
        )))}
      </div>
    </section>
  );
}

/** Pick a new day and time for a meeting or task. */
function MoveForm({ todo, meeting, at, end, onDone }) {
  const base = at || new Date();
  // An all-day task keeps no clock time unless one is picked; the field starts empty for it
  const keepsAllDay = !meeting && !!todo.deadline && isAllDay(todo);
  const [day, setDay] = useState(dateValue(base));
  const [from, setFrom] = useState(keepsAllDay ? '' : timeValue(base));
  const [err, setErr] = useState('');
  const [to, setTo] = useState(end ? timeValue(end) : timeValue(new Date(base.getTime() + 3600000)));
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const [y, m, d] = day.split('-').map(Number);
    const [h, mi] = from ? from.split(':').map(Number) : [23, 59]; // no time chosen: due at the end of that day
    const when = new Date(y, m - 1, d, h, mi);
    try {
      await todosAPI.update(todo.id, meeting
        ? { deadline: when.toISOString(), startTime: from, endTime: to }
        : { deadline: when.toISOString() });
      onDone(when);
    } catch (e2) {
      setErr(e2.response?.data?.error || 'Could not move it. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    setErr('');
    try {
      await todosAPI.update(todo.id, { deadline: null, startTime: null, endTime: null });
      onDone(null);
    } catch (e2) {
      setErr(e2.response?.data?.error || 'Could not clear the date. Try again.');
    }
  };
  return (
    <form className="r-pop up r-move" onSubmit={save}>
      <label className="f">Day<input type="date" value={day} onChange={(e) => setDay(e.target.value)} required /></label>
      <div className="two">
        <label className="f">{meeting ? 'Starts' : 'Due at (optional)'}<input type="time" value={from} onChange={(e) => setFrom(e.target.value)} required={meeting} /></label>
        {meeting && <label className="f">Ends<input type="time" value={to} onChange={(e) => setTo(e.target.value)} required /></label>}
      </div>
      {err && <p className="r-err" role="alert">{err}</p>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {!meeting && <button type="button" className="r-btn ghost small" onClick={clear}>No date</button>}
        <button type="submit" className="r-btn small" disabled={busy}>Move</button>
      </div>
    </form>
  );
}
