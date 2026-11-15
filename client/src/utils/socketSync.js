import { getSpace, SPACE_EVENT } from '../api/space';

/*
 * Live refresh from the server (notes_changed / todos_changed / reconnects), kept out of AuthContext.
 * - Events carry { space } (null = Personal). An event for another space than the one on screen is ignored.
 *   An event with no payload (older server, AI tools) always counts.
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
  const onNotes = (p) => {
    if (!eventIsForThisSpace(p)) return;
    queryClient.invalidateQueries({ queryKey: ['notes'] });
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
    socket.off('todos_changed', onTodos);
    socket.off('notes_changed', onNotes);
    socket.off('connect', onConnect);
    window.removeEventListener(SPACE_EVENT, onSpace);
  };
}
