import { getSpace, SPACE_EVENT } from '../api/space';
import { getLastNoteWrite } from '../api/client';

/*
 * Live refresh from the server (notes_changed / todos_changed / reconnects), kept out of AuthContext.
 * - Events carry { space } (null = Personal). An event for another space than the one on screen is ignored.
 *   An event with no payload (older server, AI tools) always counts.
 * - notes_changed refetches the notes at most once per 5 s (trailing). The echo of this client's own save (the cache was
 *   already patched in place) never refetches at once: it waits for the end of the window, so a change from another
 *   device is late, never lost.
 * - notes_changed refetches the notes at most once per 5 s (trailing). The echo of this client's own save (the cache was
 *   already patched in place) never refetches at once: it waits for the end of the window, so a change from another
 *   device is late, never lost.
 * - After the socket reconnects, whatever was missed meanwhile is refetched: notes, todos, notifications.
 * - A space change in ANOTHER window (storage event on 'peblo-space', see api/space.js) forgets what was loaded
 *   for the old space, so no old-space data stays on screen. A change made in this window is handled by useSwitchSpace.
 */
export function eventIsForThisSpace(payload, current = getSpace()) {
  if (!payload || typeof payload !== 'object' || !('space' in payload)) return true;
  return (payload.space || null) === (current || null);
}

export function attachSocketSync(socket, queryClient) {
  let seenSpace = getSpace() || null;
  let connectedOnce = false;

  const onTodos = (p) => {
    if (!eventIsForThisSpace(p)) return;
    queryClient.invalidateQueries({ queryKey: ['todos'] });
    queryClient.invalidateQueries({ queryKey: ['team-note-tasks'] });
    window.dispatchEvent(new Event('todo-updated'));
  };
  let lastRefetch = 0; let timer = null;
  const refetchNotes = () => { timer = null; lastRefetch = Date.now(); queryClient.invalidateQueries({ queryKey: ['notes'] }); };
  const onNotes = (p) => {
    if (!eventIsForThisSpace(p)) return;
    if (timer) return;
    const sinceOwn = Date.now() - getLastNoteWrite();
    const wait = Math.max(5000 - (Date.now() - lastRefetch), sinceOwn < 3000 ? 5000 - sinceOwn : 0, 0);
    if (wait <= 0) refetchNotes(); else timer = setTimeout(refetchNotes, wait);
  };
  const onConnect = () => {
    if (connectedOnce) {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      queryClient.invalidateQueries({ queryKey: ['todos'] });
      queryClient.invalidateQueries({ queryKey: ['team-note-tasks'] });
      window.dispatchEvent(new Event('todo-updated'));
      window.dispatchEvent(new Event('pb-notifications-changed'));
    }
    connectedOnce = true;
  };
  socket.on('todos_changed', onTodos);
  socket.on('notes_changed', onNotes);
  socket.on('connect', onConnect);

  // api/space.js turns another window's change into SPACE_EVENT (this window's own switch fires it too). Reset only when
  // the space really differs from what this window last saw. Nothing is written back to storage, so nothing loops;
  // a reset that useSwitchSpace also does for its own switch is harmless.
  const onSpace = () => {
    const now = getSpace() || null;
    if (now === seenSpace) return;
    seenSpace = now;
    queryClient.resetQueries();
  };
  window.addEventListener(SPACE_EVENT, onSpace);

  return () => {
    clearTimeout(timer);
    socket.off('todos_changed', onTodos);
    socket.off('notes_changed', onNotes);
    socket.off('connect', onConnect);
    window.removeEventListener(SPACE_EVENT, onSpace);
  };
}
