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
