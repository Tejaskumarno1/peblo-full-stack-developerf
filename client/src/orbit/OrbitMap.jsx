import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { MousePointer2, FileText, SquareCheck, Link2, CirclePlus, X, Maximize2, Plus, Minus, LocateFixed } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { notesAPI } from '../api';
import { useOrbit, useDismiss } from './OrbitShell';
import {
  buildGraph, layoutGraph, revisionPath, minutesText, agoText, levelOf, levelVar, LEVEL_LABEL,
  tagCounts, topicName, tagsOfNote,
} from './orbitUtils';
import { dayWord } from '../river/riverUtils';
import { firstNameOf } from '../soft/softUtils';

const CARD_W = 316;

/** A font size that fits the name's longest word inside a circle of diameter d. */
function fitName(name, d) {
  const longest = Math.max(...name.split(/\s+/).map((w) => w.length), 1);
  const base = d > 100 ? 16 : 14;
  return Math.max(11, Math.min(base, Math.floor((d - 30) / (longest * 0.6))));
}

/** Orbit · Map (mockup: OrbitHome). Topics around the space, notes and tasks on them, and the revision path. */
export default function OrbitMap({ interactive }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { notes, todos, mastery, space, setSpace, selected, setSelected, pathOn, setPathOn } = useOrbit();
  const boxRef = useRef(null);
  const [size, setSize] = useState({ width: 1440, height: 900 });
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [tool, setTool] = useState(null); // 'connect' | 'topic'
  const drag = useRef(null);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const read = () => setSize({ width: el.clientWidth || 1440, height: el.clientHeight || 900 });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { setView({ x: 0, y: 0, k: 1 }); }, [space]);

  const graph = useMemo(() => buildGraph({ notes, todos, mastery, space, userName: firstNameOf(user) }), [notes, todos, mastery, space, user]);
  const lay = useMemo(() => layoutGraph(graph, size), [graph, size]);
  const path = useMemo(() => revisionPath(lay.nodes), [lay]);
  const stepOf = useMemo(() => new Map(path.steps.map((s, i) => [s.id, i + 1])), [path]);

  // Default selection: the first thing to revise, or the centre
  const sel = selected === 'center' ? null : lay.nodes.find((n) => n.id === selected) || null;
  useEffect(() => {
    if (!interactive || selected) return;
    if (path.steps[0]) setSelected(path.steps[0].id);
  }, [interactive, path.steps[0]?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- wires and the revision path ----------
  const wires = useMemo(() => {
    let d = '';
    for (const n of lay.nodes) d += `M${lay.cx} ${lay.cy} L${n.x} ${n.y} `;
    for (const l of lay.leaves) d += `M${l.fx} ${l.fy} L${l.x} ${l.y} `;
    return d;
  }, [lay]);
  const pathD = useMemo(() => {
    const pts = path.steps.map((s) => lay.nodes.find((n) => n.id === s.id)).filter(Boolean);
    if (pts.length < 2) return '';
    let d = `M${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      // bend each step away from the centre so the path reads as a route, not a spoke
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const ox = mx - lay.cx;
      const oy = my - lay.cy;
      const len = Math.hypot(ox, oy) || 1;
      const bend = Math.hypot(b.x - a.x, b.y - a.y) * 0.22;
      d += ` Q${Math.round(mx + (ox / len) * bend)} ${Math.round(my + (oy / len) * bend)} ${b.x} ${b.y}`;
    }
    return d;
  }, [path, lay]);

  // ---------- pan and zoom ----------
  const onPointerDown = (e) => {
    if (!interactive || e.button !== 0 || e.target.closest('button, a, input, .o-card, .o-tools, .o-path, .o-whole, .o-zoom')) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > 4) { d.moved = true; boxRef.current.classList.add('dragging'); }
    if (d.moved) setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    boxRef.current?.classList.remove('dragging');
    // A click on empty map clears the selection
    if (d && !d.moved && e.target.closest('.o-map') && !e.target.closest('.o-node, .o-leaf')) setSelected('center');
  };
  const zoomAt = (factor, mx = size.width / 2, my = size.height / 2) => {
    setView((v) => {
      const k = Math.min(1.8, Math.max(0.55, v.k * factor));
      const f = k / v.k;
      return { k, x: mx - (mx - v.x) * f, y: my - (my - v.y) * f };
    });
  };
  const onWheel = (e) => {
    // Ctrl + wheel is the browser's zoom gesture, which the app ignores
    if (!interactive || e.ctrlKey || e.target.closest('.o-card, .o-pop, .o-tool-tip')) return;
    const r = boxRef.current.getBoundingClientRect();
    const scale = r.width / size.width || 1;
    zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, (e.clientX - r.left) / scale, (e.clientY - r.top) / scale);
  };

  // ---------- tools ----------
  const topicTag = sel?.tag || space || null;
  const [connectQ, setConnectQ] = useState('');
  const [newTopic, setNewTopic] = useState('');
  const toolRef = useDismiss(!!tool, () => setTool(null));
  const connectable = useMemo(() => {
    if (!topicTag) return [];
    const s = connectQ.trim().toLowerCase();
    return notes.filter((n) => !tagsOfNote(n).includes(topicTag) && (!s || (n.title || '').toLowerCase().includes(s))).slice(0, 6);
  }, [notes, topicTag, connectQ]);
  const connect = async (n) => {
    await notesAPI.update(n.id, { tags: [...(n.tags || []), topicTag] });
    queryClient.invalidateQueries({ queryKey: ['notes'] });
    setTool(null);
    setConnectQ('');
  };
  const draftIn = (tags) => navigate(`/notes?new=1${tags.length ? `&tag=${encodeURIComponent(tags.join(','))}` : ''}`);

  const startQuiz = (tag) => navigate(`/quiz/${encodeURIComponent(tag)}`);

  // ---------- render ----------
  const empty = graph.topics.length === 0;
  const cardLeft = size.width - 24 - CARD_W;
  const pathLeft = 190;
  const pathWidth = Math.max(560, cardLeft - 50 - pathLeft);
  const allTags = useMemo(() => tagCounts(notes).slice(0, 6), [notes]);
  const today = new Date();

  return (
    <div
      ref={boxRef}
      className="o-map"
      style={interactive ? undefined : { pointerEvents: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => { drag.current = null; boxRef.current?.classList.remove('dragging'); }}
      onWheel={onWheel}
      aria-hidden={!interactive}
    >
      <div className="o-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, width: size.width, height: size.height }}>
        <svg className="o-wires" width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`}>
          <path d={wires} fill="none" stroke="var(--o-wire)" strokeWidth="1.6" />
          {pathOn && pathD && <path d={pathD} fill="none" stroke="var(--o-path)" strokeWidth="3" strokeDasharray="9 7" strokeLinecap="round" />}
        </svg>

        {lay.leaves.map((l, i) => (l.kind === 'note' ? (
          <Link key={`${l.from}-n-${l.note.id}-${i}`} to={`/notes/${l.note.id}`} className="o-leaf" style={{ left: l.x, top: l.y }} title={l.note.title}>
            <span className="k">N</span><span>{l.note.title || 'Untitled'}</span>
          </Link>
        ) : (
          <button
            key={`${l.from}-t-${l.todo.id}-${i}`}
            type="button"
            className={`o-leaf${l.todo.deadline && new Date(l.todo.deadline) < today ? ' hot' : ''}`}
            style={{ left: l.x, top: l.y }}
            onClick={() => navigate('/tasks')}
            title={l.todo.text}
          >
            <span className="k task">T</span><span>{l.todo.text}{l.todo.deadline ? ` · due ${dayWord(l.todo.deadline)}` : ''}</span>
          </button>
        )))}

        {/* centre */}
        <div className="o-node" style={{ left: lay.cx - 80, top: lay.cy - 80, width: 160 }}>
          <button type="button" className={`ball center${selected === 'center' ? ' sel' : ''}`} style={{ width: 160, height: 160 }} onClick={() => setSelected('center')}>
            <span className="name" style={{ fontSize: 20 }}>{graph.center.name}</span>
            <span className="meta">{graph.center.meta}</span>
          </button>
          <span className="lbl">{graph.center.ready !== null ? `${graph.center.ready}% ready overall` : space ? 'Not quizzed yet' : `${graph.topics.length} topics`}</span>
        </div>

        {lay.nodes.map((n) => {
          const step = pathOn ? stepOf.get(n.id) : null;
          const ring = n.kind === 'topic' ? levelVar(n.level) : 'var(--o-line)';
          return (
            <div key={n.id} className="o-node" style={{ left: n.x - n.d / 2, top: n.y - n.d / 2, width: n.d }}>
              <button
                type="button"
                className={`ball${selected === n.id ? ' sel' : ''}`}
                style={{ width: n.d, height: n.d, borderColor: ring }}
                onClick={() => (n.kind === 'note' ? navigate(`/notes/${n.note.id}`) : setSelected(n.id))}
                onDoubleClick={() => n.kind === 'topic' && setSpace(n.tag)}
                title={n.kind === 'topic' ? `${n.name}: double-click to open it as its own map` : n.name}
              >
                <span className="name" style={{ fontSize: fitName(n.name, n.d) }}>{n.name}</span>
                <span className="meta">{n.kind === 'topic' ? `${n.count} NOTE${n.count === 1 ? '' : 'S'}` : `${n.tasks.length} TASK${n.tasks.length === 1 ? '' : 'S'}`}</span>
              </button>
              <span className="lbl">
                <span className="d" style={{ background: ring }} />
                {n.kind === 'topic' ? `${LEVEL_LABEL[n.level]}${n.score !== null ? ` · ${n.score}%` : ''}` : `edited ${agoText(n.note.updatedAt)}`}
              </span>
              {step && <span className="step">{step}</span>}
            </div>
          );
        })}
      </div>

      {interactive && empty && (
        <div className="o-pill o-empty-map">
          <h2>Your map is empty</h2>
          <p className="o-quiet">Tag your notes, like #dbms and #normalization, and every tag becomes a topic here. Notes that share tags sit together.</p>
          <button type="button" className="o-btn" onClick={() => draftIn([])}>Write a note</button>
        </div>
      )}

      {interactive && (
        <>
          <nav aria-label="Map tools" className="o-pill o-tools" ref={toolRef}>
            <button type="button" className="o-tool" aria-label="Select" aria-pressed={!tool} onClick={() => setTool(null)}><MousePointer2 size={18} strokeWidth={2.2} /></button>
            <button type="button" className="o-tool" aria-label={topicTag ? `New note in ${topicName(topicTag)}` : 'New note'} title="New note here" onClick={() => draftIn([...new Set([space, sel?.tag].filter(Boolean))])}><FileText size={18} strokeWidth={2.2} /></button>
            <button type="button" className="o-tool" aria-label="New task" title="New task here" onClick={() => window.dispatchEvent(new CustomEvent('peblo:capture', { detail: { mode: 'task', tag: topicTag } }))}><SquareCheck size={18} strokeWidth={2.2} /></button>
            <button type="button" className="o-tool" aria-label="Put a note on this topic" title="Put a note on this topic" aria-pressed={tool === 'connect'} onClick={() => setTool(tool === 'connect' ? null : 'connect')}><Link2 size={18} strokeWidth={2.2} /></button>
            <button type="button" className="o-tool" aria-label="New topic" title="New topic" aria-pressed={tool === 'topic'} onClick={() => setTool(tool === 'topic' ? null : 'topic')}><CirclePlus size={18} strokeWidth={2.2} /></button>
            {tool === 'connect' && (
              <div className="o-tool-tip">
                {topicTag ? (
                  <>
                    <label htmlFor="o-connect">Put a note on {topicName(topicTag)}</label>
                    <input id="o-connect" autoFocus value={connectQ} onChange={(e) => setConnectQ(e.target.value)} placeholder="Find a note…" />
                    <div className="o-items">
                      {connectable.map((n) => (
                        <button key={n.id} type="button" className="o-item" onClick={() => connect(n)}><span className="k">N</span><span className="t">{n.title || 'Untitled'}</span></button>
                      ))}
                      {connectable.length === 0 && <span className="o-quiet" style={{ fontSize: 13 }}>No other notes match.</span>}
                    </div>
                  </>
                ) : <span className="o-quiet" style={{ fontSize: 13 }}>Pick a topic on the map first.</span>}
              </div>
            )}
            {tool === 'topic' && (
              <form className="o-tool-tip" onSubmit={(e) => { e.preventDefault(); const t = newTopic.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-'); if (t) draftIn([...new Set([space, t].filter(Boolean))]); }}>
                <label htmlFor="o-new-topic">New topic{space ? ` in ${topicName(space)}` : ''}</label>
                <input id="o-new-topic" autoFocus value={newTopic} onChange={(e) => setNewTopic(e.target.value)} placeholder="e.g. functional dependencies" />
                <span className="o-quiet" style={{ fontSize: 12.5 }}>Starts a note with this tag. The topic shows up once the note is saved.</span>
                <button type="submit" className="o-btn small" disabled={!newTopic.trim()}>Start a note</button>
              </form>
            )}
          </nav>

          <div className="o-pill o-zoom" role="group" aria-label="Zoom">
            <button type="button" className="o-tool" aria-label="Zoom in" onClick={() => zoomAt(1.15)}><Plus size={18} /></button>
            <button type="button" className="o-tool" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.15)}><Minus size={18} /></button>
            <button type="button" className="o-tool" aria-label="Back to the middle" onClick={() => setView({ x: 0, y: 0, k: 1 })}><LocateFixed size={18} /></button>
          </div>

          {!empty && (
            <SelectedCard
              left={cardLeft}
              node={sel}
              center={graph.center}
              topics={lay.nodes}
              todos={todos}
              space={space}
              path={path}
              mastery={mastery}
              onClose={() => setSelected('center')}
              onOpenSpace={(tag) => setSpace(tag)}
              onQuiz={startQuiz}
              onNote={(tags) => draftIn(tags)}
            />
          )}

          <section aria-label="Your whole map" className="o-pill o-whole" style={{ left: cardLeft, top: size.height - 240 }}>
            <span className="o-h3">YOUR WHOLE MAP</span>
            {allTags.slice(0, 5).map(([t, n], i) => {
              const d = 12 + Math.min(n, 8) * 3;
              return (
                <button key={t} type="button" className={`dotb${space === t ? ' on' : ''}`} style={{ left: 14 + i * 58, top: 34, width: 56 }} onClick={() => setSpace(space === t ? null : t)} title={`Open ${topicName(t)}`}>
                  <span style={{ height: 40, display: 'flex', alignItems: 'center' }}><i style={{ width: d, height: d }} /></span>
                  <span>{topicName(t)}</span>
                </button>
              );
            })}
            <div className="o-legend" aria-label="Rings">
              <span><i style={{ borderColor: 'var(--o-weak)' }} />Weak</span>
              <span><i style={{ borderColor: 'var(--o-ok)' }} />Getting there</span>
              <span><i style={{ borderColor: 'var(--o-strong)' }} />Strong</span>
            </div>
          </section>

          {!empty && (
            <div className="o-path" style={{ left: pathLeft, top: size.height - 88, width: pathWidth }}>
              <button type="button" role="switch" aria-checked={pathOn} aria-label="Show revision path" className="o-switch" onClick={() => setPathOn(!pathOn)}><span /></button>
              <div className="what">
                <b>Revision path</b>
                <span>{graph.center.due ? `${dayWord(graph.center.due.deadline)} · about ${minutesText(path.minutes)}` : path.steps.length ? `About ${minutesText(path.minutes)}` : 'Nothing weak right now'}</span>
              </div>
              <span className="sep" />
              {path.steps.length ? (
                <ol>
                  {path.steps.map((s, i) => (
                    <li key={s.id}><button type="button" onClick={() => setSelected(s.id)}><span className="n">{i + 1}</span>{s.name}</button></li>
                  ))}
                </ol>
              ) : <span className="empty">Every topic here is strong. Quiz one anyway to keep it that way.</span>}
              {path.steps[0] && (
                <button type="button" className="start" onClick={() => startQuiz(path.steps[0].tag)}>Start · {path.steps[0].score === null || path.steps[0].score < 50 ? 35 : 20} min</button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The card on the right: the selected topic, or the space itself. */
function SelectedCard({ left, node, center, topics, todos, space, path, mastery, onClose, onOpenSpace, onQuiz, onNote }) {
  const navigate = useNavigate();
  const now = new Date();

  if (node && node.kind === 'topic') {
    const m = mastery.get(node.tag);
    const level = levelOf(node.score);
    const missed = m?.missed || [];
    let noticed;
    if (m && m.lastTotal) {
      const wrong = m.lastTotal - m.lastCorrect;
      noticed = wrong === 0
        ? `You got all ${m.lastTotal} right last time. One more quiz in a few days will make it stick.`
        : `Last quiz you missed ${wrong} of ${m.lastTotal}${missed[0] ? `, mostly on ${missed[0].concept}${missed[1] ? ` and ${missed[1].concept}` : ''}` : ''}. A 10-minute drill on ${missed[0] ? 'that' : 'it'} should close the gap.`;
    } else {
      noticed = `You haven't quizzed this yet. ${Math.min(10, Math.max(3, node.count * 2))} questions from its ${node.count} note${node.count === 1 ? '' : 's'} will show where you stand.`;
    }
    const items = [
      ...node.notes.slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, node.tasks.length ? 2 : 3).map((n) => ({ id: n.id, kind: 'N', title: n.title || 'Untitled', meta: agoText(n.updatedAt), to: `/notes/${n.id}` })),
      ...node.tasks.slice(0, 1).map((t) => ({ id: t.id, kind: 'T', title: t.text, meta: t.deadline ? `due ${dayWord(t.deadline)}` : 'no date', hot: t.deadline && new Date(t.deadline) - now < 2 * 86400000, to: '/tasks' })),
    ];
    return (
      <aside aria-label="Selected topic" className="o-pill o-card" style={{ left, top: 92 }}>
        <div className="head">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <span className="o-eyebrow">TOPIC · {node.count} NOTE{node.count === 1 ? '' : 'S'} · {node.tasks.length} TASK{node.tasks.length === 1 ? '' : 'S'}</span>
            <h2>{node.name}</h2>
          </div>
          <div style={{ display: 'flex' }}>
            {node.tag !== space && <button type="button" className="o-x" aria-label={`Open ${node.name} as its own map`} title="Open as its own map" onClick={() => onOpenSpace(node.tag)}><Maximize2 size={16} strokeWidth={2.2} /></button>}
            <button type="button" className="o-x" aria-label="Close" onClick={onClose}><X size={18} strokeWidth={2.2} /></button>
          </div>
        </div>
        <div className="o-mastery">
          <div className="row">
            <b>{node.score !== null ? `${node.score}% mastered · ${LEVEL_LABEL[level].toLowerCase()}` : 'Not quizzed yet'}</b>
            <span>{m ? `quizzed ${agoText(m.updatedAt)}` : `${node.count} note${node.count === 1 ? '' : 's'} to learn from`}</span>
          </div>
          <div className="o-bar" role="img" aria-label={node.score !== null ? `${node.score} percent mastered` : 'Not quizzed yet'}><div style={{ width: `${node.score ?? 0}%`, background: levelVar(level) }} /></div>
        </div>
        <div className="o-noticed"><b>Peblo noticed</b><span>{noticed}</span></div>
        <div className="o-items">
          {items.map((it) => (
            <Link key={it.id} to={it.to} className="o-item">
              <span className={`k${it.kind === 'T' ? ' task' : ''}`}>{it.kind}</span>
              <span className="t">{it.title}</span>
              <span className={`m${it.hot ? ' hot' : ''}`}>{it.meta}</span>
            </Link>
          ))}
        </div>
        <div className="o-btns">
          <button type="button" className="o-btn wide" onClick={() => onQuiz(node.tag)}>Quiz this · 10 Q</button>
          <button type="button" className="o-btn ghost" onClick={() => navigate(`/notes?topic=${encodeURIComponent(node.tag)}`)}>Open notes</button>
        </div>
      </aside>
    );
  }

  // The space (or whole map) itself
  const tags = space ? [space] : [];
  const spaceTasks = todos
    .filter((t) => !t.completed && t.deadline && (!space || (Array.isArray(t.todoTags) && t.todoTags.includes(space))))
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
    .slice(0, 3);
  const weakest = path.steps[0];
  return (
    <aside aria-label="This map" className="o-pill o-card" style={{ left, top: 92 }}>
      <div className="head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <span className="o-eyebrow">{space ? `SPACE · ${topics.length} ${center.noteMode ? 'NOTES' : 'TOPICS'}` : `WHOLE MAP · ${topics.length} TOPICS`}</span>
          <h2>{center.name}</h2>
        </div>
        {space && <button type="button" className="o-x" aria-label="Back to the whole map" title="Back to the whole map" onClick={() => onOpenSpace(null)}><X size={18} strokeWidth={2.2} /></button>}
      </div>
      <div className="o-mastery">
        <div className="row">
          <b>{center.ready !== null ? `${center.ready}% ready overall` : 'Not quizzed yet'}</b>
          <span>{center.due ? `${dayWord(center.due.deadline).toLowerCase()}` : ''}</span>
        </div>
        <div className="o-bar"><div style={{ width: `${center.ready ?? 0}%`, background: levelVar(levelOf(center.ready)) }} /></div>
      </div>
      <div className="o-noticed">
        <b>Peblo noticed</b>
        <span>
          {center.due
            ? `${center.due.text} is ${dayWord(center.due.deadline).toLowerCase()}. ${weakest ? `Start with ${weakest.name}${weakest.score !== null ? `, your weakest at ${weakest.score}%` : ', which you haven\'t quizzed yet'}.` : 'Everything here is strong.'}`
            : weakest ? `${weakest.name} is ${weakest.score !== null ? `your weakest topic at ${weakest.score}%` : 'not quizzed yet'}. Follow the revision path below, one topic at a time.` : 'Every topic is strong. Quiz one now and then to keep it that way.'}
        </span>
      </div>
      <div className="o-items">
        {spaceTasks.length === 0 && <span className="o-quiet" style={{ fontSize: 13 }}>Nothing due{space ? ' in this space' : ''}.</span>}
        {spaceTasks.map((t) => (
          <Link key={t.id} to="/tasks" className="o-item">
            <span className="k task">T</span><span className="t">{t.text}</span>
            <span className={`m${new Date(t.deadline) - now < 2 * 86400000 ? ' hot' : ''}`}>due {dayWord(t.deadline)}</span>
          </Link>
        ))}
      </div>
      <div className="o-btns">
        {weakest
          ? <button type="button" className="o-btn wide" onClick={() => onQuiz(weakest.tag)}>Quiz {weakest.name}</button>
          : <button type="button" className="o-btn wide" onClick={() => navigate('/tasks')}>See what's due</button>}
        <button type="button" className="o-btn ghost" onClick={() => onNote(tags)}>New note</button>
      </div>
      {center.noteMode && <p className="o-quiet" style={{ fontSize: 13 }}>Give these notes smaller tags too (like #normalization) and they will group into topics here.</p>}
    </aside>
  );
}
