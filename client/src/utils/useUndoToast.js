// PEB-123: one place for "Done. Undo" messages and for deletes that wait out the undo time.
import { useEffect, useRef, useState } from 'react';

export const UNDO_MS = 6000;

/** A message with an Undo button that goes away after UNDO_MS. say(message, undoFn) */
export function useUndoToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const dismiss = () => { clearTimeout(timer.current); setToast(null); };
  const say = (msg, undo) => {
    clearTimeout(timer.current);
    setToast({ msg, undo });
    timer.current = setTimeout(() => setToast(null), UNDO_MS);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return { toast, say, dismiss };
}

/**
 * A delete that can be undone. schedule(id, label, say) hides the row at once (its id goes in `gone`)
 * and calls doDelete(id) after UNDO_MS. Undo cancels it. Leaving the screen sends it straight away.
 */
export function useDeferredDelete(doDelete) {
  const [gone, setGone] = useState([]);
  const pending = useRef(new Map());
  const del = useRef(doDelete);
  del.current = doDelete;
  useEffect(() => () => { for (const p of pending.current.values()) { clearTimeout(p.timer); p.run(); } }, []);
  const schedule = (id, label, say) => {
    setGone((g) => [...g, id]);
    const run = () => {
      pending.current.delete(id);
      return Promise.resolve(del.current(id)).catch(() => {}).then(() => setGone((g) => g.filter((x) => x !== id)));
    };
    pending.current.set(id, { timer: setTimeout(run, UNDO_MS), run });
    const short = label.length > 40 ? `${label.slice(0, 40)}...` : label;
    say(`Deleted "${short}"`, () => {
      const p = pending.current.get(id);
      if (p) { clearTimeout(p.timer); pending.current.delete(id); }
      setGone((g) => g.filter((x) => x !== id));
    });
  };
  return { gone, schedule };
}
