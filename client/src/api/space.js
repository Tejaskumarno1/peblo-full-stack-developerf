// Which space the person is working in: null is Personal. Kept in localStorage so every window agrees and a reload keeps it.
const KEY = 'peblo-space';
export const SPACE_EVENT = 'peblo:space';

export function getSpace() {
  try { return localStorage.getItem(KEY) || null; } catch { return null; }
}

export function setSpace(id) {
  try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch { /* storage blocked: Personal */ }
  window.dispatchEvent(new Event(SPACE_EVENT));
}

// Another window or tab changed the space: tell this one through the same event. We only listen here and never write
// back to storage, so two windows cannot ping-pong. (The storage event does not fire in the window that made the change.)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === null) window.dispatchEvent(new Event(SPACE_EVENT));
  });
}
