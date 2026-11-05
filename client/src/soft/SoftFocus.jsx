import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronUp, ChevronDown, Pause, Play } from 'lucide-react';
import { notesAPI, todosAPI } from '../api';
import TaskSteps from '../components/TaskSteps';
import { timeOf, dayChip, daysFromToday, tagsOf } from './softUtils';
import './focus.css';

const BlockEditor = lazy(() => import('../components/BlockEditor'));
const SPRINT = 25 * 60;
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const hm = (min) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`);

/** One task in focus: the task, its steps and a timer on the left, its own working note on the right. */
export default function SoftFocus() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: todos = [], isLoading } = useQuery({ queryKey: ['todos', 'all'], queryFn: () => todosAPI.getAll().then((r) => r.data.todos || []) });
  const task = todos.find((t) => t.id === id);

  // today's open tasks (a repeating task once), in the order of the board
  const queue = useMemo(() => {
    const seen = new Set();
    const open = todos.filter((t) => !t.completed && t.deadline && daysFromToday(t.deadline) <= 0).sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
    const out = open.filter((t) => { if (!t.seriesId) return true; if (seen.has(t.seriesId)) return false; seen.add(t.seriesId); return true; });
    if (task && !out.some((t) => t.id === task.id)) out.push(task);
    return out;
  }, [todos, task]);
  const at = queue.findIndex((t) => t.id === id);

  const [steps, setSteps] = useState([]);
  const [left, setLeft] = useState(SPRINT);
  const [running, setRunning] = useState(true);
  const [noteId, setNoteId] = useState(null);
  const [saved, setSaved] = useState('');
  const elapsed = useRef(0); // seconds not yet added to the task
  const taskRef = useRef(null);
  taskRef.current = task;

  useEffect(() => { setSteps(task?.meta?.subtasks || []); setNoteId(task?.noteId || null); setLeft(SPRINT); setRunning(true); }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(() => { queryClient.invalidateQueries({ queryKey: ['todos'] }); queryClient.invalidateQueries({ queryKey: ['dashboard'] }); }, [queryClient]);
  // time is added to the task when the timer stops
  const flush = useCallback(async () => {
    const t = taskRef.current;
    const secs = elapsed.current;
    elapsed.current = 0;
    if (!t || secs < 30) return;
    const add = Math.max(1, Math.round(secs / 60));
    const today = new Date(); const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const log = { ...(t.meta?.timeLog || {}) }; log[day] = (log[day] || 0) + add;
    try { await todosAPI.update(t.id, { meta: { spentMin: (t.meta?.spentMin || 0) + add, timeLog: log } }); refresh(); } catch { /* the time is lost, not the task */ }
  }, [refresh]);

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => {
      elapsed.current += 1;
      setLeft((v) => { if (v <= 1) { setRunning(false); return 0; } return v - 1; });
    }, 1000);
    return () => clearInterval(timer);
  }, [running]);
  useEffect(() => { if (!running) flush(); }, [running, flush]);
  useEffect(() => () => { flush(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (t) => navigate(t ? `/tasks/focus/${t.id}` : '/tasks');
  const exit = async () => { await flush(); navigate('/tasks'); };
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('[role="dialog"]')) exit(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const saveSteps = async (next) => {
    setSteps(next);
    try { await todosAPI.update(id, { meta: { subtasks: next } }); refresh(); } catch { /* shown on next load */ }
  };
  const done = async () => {
    await flush();
    try { await todosAPI.update(id, { completed: true, scope: 'this' }); } catch { return; }
    refresh();
    go(queue.find((t) => t.id !== id) || null);
  };
  const snooze = async () => {
    await flush();
    const prev = task.deadline ? new Date(task.deadline) : null;
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(prev ? prev.getHours() : 9, prev ? prev.getMinutes() : 0, 0, 0);
    try { await todosAPI.update(id, { deadline: tomorrow.toISOString(), scope: 'this' }); } catch { return; }
    refresh();
    go(queue.find((t) => t.id !== id) || null);
  };
  const skip = async () => { await flush(); go(queue[(at + 1) % queue.length] && queue.length > 1 ? queue[(at + 1) % queue.length] : null); };

  // the working note: the linked note, or one made when the person first types
  const { data: note, isLoading: noteLoading } = useQuery({
    queryKey: ['focus-note', noteId],
    queryFn: () => notesAPI.get(noteId).then((r) => r.data.note || r.data),
    enabled: !!noteId,
    staleTime: 60000,
  });
  const { data: back = [] } = useQuery({
    queryKey: ['focus-back', noteId],
    queryFn: () => notesAPI.backlinks(noteId).then((r) => r.data.backlinks || []),
    enabled: !!noteId,
  });
  const [showBack, setShowBack] = useState(false);
  const saveTimer = useRef(null);
  const creating = useRef(false);
  const onNote = (md) => {
    clearTimeout(saveTimer.current);
    setSaved('Saving');
    saveTimer.current = setTimeout(async () => {
      try {
        if (noteId) await notesAPI.update(noteId, { content: md });
        else if (md.trim() && !creating.current) {
          creating.current = true;
          const made = (await notesAPI.create({ title: taskRef.current?.text || 'Task note', content: md })).data;
          const nid = (made.note || made).id;
          await todosAPI.update(id, { noteId: nid });
          setNoteId(nid);
          refresh();
          creating.current = false;
        }
        setSaved('Saved');
      } catch { setSaved('Not saved'); creating.current = false; }
    }, 700);
  };
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  if (isLoading) return <div className="s-focus"><p className="s-empty">Loading</p></div>;
  if (!task) return (
    <div className="s-focus"><div className="s-focus-bar"><button type="button" className="ib" aria-label="Back" onClick={() => navigate('/tasks')}><ChevronLeft size={16} /></button><b>Focus on one task</b></div><p className="s-empty" style={{ padding: 24 }}>That task is not here any more. <Link to="/tasks">Back to Tasks</Link></p></div>
  );

  const spent = task.meta?.spentMin || 0;
  const est = task.meta?.estimateMin;
  return (
    <div className="s-focus" data-testid="task-focus">
      <div className="s-focus-bar">
        <button type="button" className="ib" aria-label="Back" onClick={exit}><ChevronLeft size={16} strokeWidth={2.4} /></button>
        <b>Focus on one task</b>
        {queue.length > 0 && <span className="chip">Task {Math.max(at, 0) + 1} of {queue.length} today</span>}
        <span className="grow" />
        <button type="button" className="ib" aria-label="Previous task" disabled={queue.length < 2} onClick={() => go(queue[(at - 1 + queue.length) % queue.length])}><ChevronUp size={16} strokeWidth={2.4} /></button>
        <button type="button" className="ib" aria-label="Next task" disabled={queue.length < 2} onClick={() => go(queue[(at + 1) % queue.length])}><ChevronDown size={16} strokeWidth={2.4} /></button>
        <button type="button" className="s-focus-exit" onClick={exit}>Exit <kbd>Esc</kbd></button>
      </div>

      <section className="s-focus-left" aria-label="Task">
        <div className="s-focus-title">
          <input type="checkbox" className="s-check" checked={!!task.completed} onChange={done} aria-label={`Mark "${task.text}" done`} />
          <h1>{task.text}</h1>
        </div>
        <div className="s-focus-chips">
          {task.deadline && <span className="chip">{dayChip(task.deadline)}{timeOf(task) ? ` ${timeOf(task)}` : ''}</span>}
          {task.priority === 'high' && <span className="chip">High</span>}
          {tagsOf(task).map((g) => <span key={g} className="chip">#{g}</span>)}
          {est ? <span className="chip">Est. {hm(est)}</span> : null}
        </div>

        <div className="s-focus-card">
          <TaskSteps steps={steps} onChange={saveSteps} label="Steps" taskText={task.text} taskDetails={task.meta?.details || ""} />
        </div>

        <div className="s-focus-card" data-testid="focus-timer">
          <div className="lab">Timer</div>
          <div className="s-focus-time">
            <span className="n">{mmss(left)}</span>
            <span className="t">{left === 0 ? 'Sprint done. Time has been added to this task.' : 'of a 25 minute sprint. Time is added to this task when you stop.'}</span>
            <button type="button" className="ib on" aria-label={running ? 'Pause' : 'Start'} onClick={() => { if (left === 0) setLeft(SPRINT); setRunning((r) => !r); }}>{running ? <Pause size={14} fill="#fff" /> : <Play size={14} fill="#fff" />}</button>
          </div>
          <div className="t">Logged so far: {spent ? hm(spent) : 'nothing yet'}{spent && Object.keys(task.meta?.timeLog || {}).length > 1 ? ` over ${Object.keys(task.meta.timeLog).length} days` : ''}</div>
        </div>

        <div className="s-focus-actions">
          <button type="button" className="go" onClick={done}>Mark done</button>
          <button type="button" onClick={snooze}>Snooze</button>
          <button type="button" onClick={skip} disabled={queue.length < 2}>Skip</button>
        </div>
      </section>

      <section className="s-focus-right" aria-label="Working note">
        <div className="s-focus-notehead">
          <span className="lab">Working note</span>
          {note?.title && noteId && <Link className="chip" to={`/notes/${noteId}`}>{note.title}</Link>}
          <span className="grow" />
          <span className="chip">{noteId ? (saved || 'Saved') : 'Created when you first type'}</span>
        </div>
        <h2 className="s-focus-notetitle">{note?.title || task.text}</h2>
        <div className="s-focus-editor">
          {noteId && noteLoading ? <p className="s-empty small">Loading the note</p> : (
            <Suspense fallback={<p className="s-empty small">Loading editor</p>}>
              <BlockEditor key={noteId || 'new'} noteId={noteId || undefined} initialContent={note?.content || ''} onChange={onNote} />
            </Suspense>
          )}
        </div>
        {back.length > 0 && (
          <div className="s-focus-back">
            Mentioned in {back.length} other note{back.length === 1 ? '' : 's'}: {back.slice(0, 3).map((b) => b.title || 'Untitled').join(', ')} ·{' '}
            <button type="button" onClick={() => setShowBack((v) => !v)}>{showBack ? 'Hide' : 'Show'}</button>
            {showBack && <span className="list">{back.map((b) => <Link key={b.id} to={`/notes/${b.id}`}>{b.title || 'Untitled'}</Link>)}</span>}
          </div>
        )}
      </section>
    </div>
  );
}
