/**
 * NoteContextPanel: the right column beside an open note.
 * Ask about the note, quick AI actions, linked tasks, backlinks and history.
 */
import { memo, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Sparkles, ListChecks, Layers, Link2, History, Plus } from 'lucide-react';
import { todosAPI } from '../../api';
import { parseTask } from '../../utils/parseTask';

function dueLabel(t) {
  if (!t.deadline) return t.priority === 'high' ? 'High' : '';
  const d = new Date(t.deadline);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - today.getTime()) / 86400000);
  const when = diff === 0 ? 'due today' : diff === 1 ? 'due tomorrow' : diff < 0 ? 'overdue' : `due ${d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}`;
  return (t.priority === 'high' ? 'High · ' : '') + when;
}

function NoteContextPanel({ note, noteTitle, notes, isDraft, onSummarise, onGetTasks, onSelectNote, onHistory }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState('');
  const [taskDraft, setTaskDraft] = useState('');
  const noteId = !isDraft ? note?.id : null;

  const { data: tasks = [] } = useQuery({
    queryKey: ['todos', 'note', noteId],
    queryFn: () => todosAPI.getAll({ noteId }).then((r) => r.data.todos || []),
    enabled: !!noteId,
  });

  const backlinks = useMemo(() => {
    const title = (noteTitle || note?.title || '').trim();
    if (!title || title.length < 4 || !notes?.length) return [];
    const needle = title.toLowerCase();
    return notes
      .filter((n) => n.id !== note?.id && !n.isDeleted && (n.content || '').toLowerCase().includes(needle))
      .slice(0, 6);
  }, [notes, note?.id, note?.title, noteTitle]);

  const ask = (q) => {
    const text = q.trim();
    if (!text || !noteId) return;
    const params = new URLSearchParams({ q: text, note: noteId, noteTitle: noteTitle || note?.title || 'This note' });
    navigate(`/ai?${params.toString()}`);
  };

  const toggle = async (t) => {
    queryClient.setQueryData(['todos', 'note', noteId], (old) => (old || []).map((x) => (x.id === t.id ? { ...x, completed: !x.completed } : x)));
    try {
      await todosAPI.update(t.id, { completed: !t.completed });
    } finally {
      queryClient.invalidateQueries({ queryKey: ['todos'] });
    }
  };

  const addTask = async (e) => {
    e.preventDefault();
    if (!taskDraft.trim() || !noteId) return;
    const p = parseTask(taskDraft);
    setTaskDraft('');
    await todosAPI.create({ text: p.text || taskDraft.trim(), priority: p.priority, tags: p.tags, deadline: p.deadline ? p.deadline.toISOString() : null, noteId });
    queryClient.invalidateQueries({ queryKey: ['todos'] });
  };

  const open = tasks.filter((t) => !t.completed);
  const done = tasks.filter((t) => t.completed);

  return (
    <aside className="nc" aria-label="About this note">
      <section className="nc-card nc-ask">
        <form onSubmit={(e) => { e.preventDefault(); ask(question); }} className="nc-ask-row">
          <Sparkles size={14} className="nc-spark" aria-hidden="true" />
          <label htmlFor="nc-ask" className="sr-only">Ask about this note</label>
          <input id="nc-ask" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={isDraft ? 'Save the note to ask about it' : 'Ask about this note'} disabled={isDraft} />
          <button type="submit" className="nc-send" disabled={!question.trim() || isDraft} aria-label="Ask"><ArrowUp size={14} /></button>
        </form>
        <div className="nc-actions">
          <button type="button" className="pb-chip" onClick={onSummarise} disabled={isDraft}><Sparkles size={12} /> Summarise</button>
          <button type="button" className="pb-chip" onClick={onGetTasks} disabled={isDraft}><ListChecks size={12} /> Get tasks</button>
          <button type="button" className="pb-chip" onClick={() => ask('Make 8 flashcards (question and answer) from this note.')} disabled={isDraft}><Layers size={12} /> Flashcards</button>
        </div>
      </section>

      <section className="nc-section">
        <h3>Linked tasks {tasks.length > 0 && <span className="pb-muted">{open.length}/{tasks.length}</span>}</h3>
        {open.map((t) => (
          <label key={t.id} className="nc-task">
            <input type="checkbox" className="pb-check" checked={false} onChange={() => toggle(t)} />
            <span className="nc-task-body">
              <span className="t">{t.text}</span>
              {dueLabel(t) && <span className={`m${t.priority === 'high' ? ' high' : ''}`}>{dueLabel(t)}</span>}
            </span>
          </label>
        ))}
        {done.slice(0, 3).map((t) => (
          <label key={t.id} className="nc-task done">
            <input type="checkbox" className="pb-check" checked onChange={() => toggle(t)} />
            <span className="nc-task-body"><span className="t">{t.text}</span></span>
          </label>
        ))}
        {!isDraft && (
          <form onSubmit={addTask} className="nc-add">
            <Plus size={13} aria-hidden="true" />
            <label htmlFor="nc-add" className="sr-only">Add a task linked to this note</label>
            <input id="nc-add" value={taskDraft} onChange={(e) => setTaskDraft(e.target.value)} placeholder="Add a task, e.g. revise tomorrow !high" />
          </form>
        )}
      </section>

      <section className="nc-section">
        <h3>Backlinks {backlinks.length > 0 && <span className="pb-muted">{backlinks.length}</span>}</h3>
        {backlinks.length === 0 ? (
          <p className="nc-empty">No other note mentions “{noteTitle || note?.title || 'this note'}” yet.</p>
        ) : backlinks.map((n) => (
          <button key={n.id} type="button" className="nc-link" onClick={() => onSelectNote(n)}>
            <Link2 size={12} aria-hidden="true" /> <span>{n.title || 'Untitled'}</span>
          </button>
        ))}
      </section>

      {!isDraft && (
        <section className="nc-foot">
          <span className="pb-muted">Created {new Date(note.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          <button type="button" className="pb-link" onClick={onHistory}><History size={12} /> History</button>
        </section>
      )}
    </aside>
  );
}

export default memo(NoteContextPanel);
