import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ListChecks, Users } from 'lucide-react';
import api from '../api/client';
import { useSpaceMembers } from './spaces';
import Toast from '../components/Toast';
import './teamshare.css';

/** On a note that was shared into a team (mockups T05, T06): who shared it, what you can do, and the progress of its to-do list. When the last task is finished the note is Done. */
export default function TeamNoteStrip({ doc }) {
  const share = doc?.meta?.teamShare;
  const { people } = useSpaceMembers();
  const qc = useQueryClient();
  const { data: todos = [] } = useQuery({
    queryKey: ['team-note-tasks', doc?.id], enabled: !!share && !!doc?.id, refetchInterval: 8000,
    queryFn: () => api.get('/todos', { params: { noteId: doc.id } }).then((r) => r.data.todos || []),
  });
  const total = todos.length;
  const done = todos.filter((t) => t.completed).length;
  const finished = total > 0 && done === total;
  const was = useRef(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!share) return undefined;
    let t;
    if (was.current === false && finished) {
      setToast({ last: todos[todos.length - 1], total });
      qc.invalidateQueries({ queryKey: ['notes'] });
      t = setTimeout(() => setToast(null), 8000);
    }
    if (total > 0) was.current = finished;
    return () => clearTimeout(t);
  }, [finished, total]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!share) return null;
  const who = people.find((p) => p.id === doc.userId)?.name;
  const undo = async () => {
    const last = toast?.last; setToast(null);
    if (!last) return;
    try { await api.patch(`/todos/${last.id}`, { completed: false }); await qc.invalidateQueries({ queryKey: ['team-note-tasks', doc.id] }); await qc.invalidateQueries({ queryKey: ['notes'] }); } catch { /* stays as it is */ }
  };
  return (
    <>
      <div className={`ts-strip${finished ? ' done' : ''}`} data-testid="ts-strip">
        <span><Users size={13} /> Shared{who ? <> by <b>{who}</b></> : ''}. {share.level === 'view' ? 'Can view' : 'Can edit'}</span>
        {total > 0 && (finished
          ? <span className="ts-tag done" data-testid="ts-done"><Check size={11} /> Done</span>
          : <span className="ts-tag todo" data-testid="ts-progress"><ListChecks size={11} /> To-do {done} of {total}</span>)}
        {total > 0 && <span className="ts-bar"><i style={{ width: `${(done / total) * 100}%` }} /></span>}
      </div>
      {toast && <Toast><div className="s-toast s-move-toast" role="status" data-testid="ts-done-toast"><Check size={14} /> Note tagged Done. All {toast.total} tasks finished.<button type="button" onClick={undo}>Undo</button></div></Toast>}
    </>
  );
}
