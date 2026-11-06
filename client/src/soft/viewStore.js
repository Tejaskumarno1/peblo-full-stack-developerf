// Saved task views: a name plus the search, filter, group and sort that were on screen.
export const VIEWS_KEY = 'peblo-task-views';
export const FIELDS = ['q', 'pill', 'lg', 'ls'];

export function loadViews(storage = globalThis.localStorage) {
  try {
    const a = JSON.parse(storage.getItem(VIEWS_KEY) || '[]');
    return Array.isArray(a) ? a.filter((v) => v && v.id && v.name) : [];
  } catch { return []; }
}
export function storeViews(views, storage = globalThis.localStorage) {
  try { storage.setItem(VIEWS_KEY, JSON.stringify(views)); } catch { /* ignore */ }
}
export const snapshot = (s) => ({ q: s.q || '', pill: s.pill || 'all', lg: s.lg || 'when', ls: s.ls || 'due' });
export const sameView = (a, b) => FIELDS.every((k) => (a[k] || '') === (b[k] || ''));
export const uniqueName = (name, views, exceptId) => {
  const base = name.trim() || 'Untitled view';
  const taken = new Set(views.filter((v) => v.id !== exceptId).map((v) => v.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n += 1;
  return `${base} ${n}`;
};
export const addView = (views, name, snap, id = `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`) =>
  [...views, { id, name: uniqueName(name, views), ...snapshot(snap) }];
export const renameView = (views, id, name) => views.map((v) => (v.id === id ? { ...v, name: uniqueName(name, views, id) } : v));
export const updateView = (views, id, snap) => views.map((v) => (v.id === id ? { ...v, ...snapshot(snap) } : v));
export const duplicateView = (views, id) => {
  const v = views.find((x) => x.id === id);
  return v ? addView(views, `${v.name} copy`, v) : views;
};
export const removeView = (views, id) => views.filter((v) => v.id !== id);

const PILL = { all: 'All', inbox: 'Inbox', today: 'Today', upcoming: 'Upcoming', overdue: 'Overdue', high: 'High priority', waiting: 'Waiting', someday: 'Someday' };
const GROUP = { none: 'No grouping', when: 'Date', list: 'List', tag: 'Tag', priority: 'Priority' };
const SORT = { due: 'Due soonest', priority: 'Priority', newest: 'Newest', az: 'A to Z', manual: 'Manual' };
/** Short chips saying what a view remembers. */
export function describe(v) {
  const out = [];
  if (v.q) out.push(`Search: ${v.q}`);
  if (v.pill && v.pill !== 'all') out.push(`Filter: ${PILL[v.pill] || v.pill}`);
  out.push(`Group: ${GROUP[v.lg] || v.lg}`);
  out.push(`Sort: ${SORT[v.ls] || v.ls}`);
  return out;
}
