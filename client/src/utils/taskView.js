// Searching, filtering, sorting and grouping a list of tasks. Shared by the Tasks screens of every style,
// so the same words mean the same thing in Soft, River and Orbit.
// `h` supplies what differs per style: whenOf(t) -> Date|null, tagsOf(t) -> string[], isMeeting(t) -> boolean.

export const RANK = { high: 0, medium: 1, low: 2 };
export const PRIORITY_LABEL = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' };
export const SHOW_OPTIONS = [['open', 'Open'], ['overdue', 'Overdue'], ['nodate', 'No date'], ['meetings', 'Meetings'], ['done', 'Done'], ['all', 'Everything']];
export const GROUP_OPTIONS = [['due', 'When it is due'], ['priority', 'Priority'], ['tag', 'Tag'], ['none', 'No grouping']];
export const SORT_OPTIONS = [['due', 'Due soonest'], ['priority', 'Priority'], ['newest', 'Newest'], ['az', 'A to Z']];

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };

export function isOverdue(t, h, now = new Date()) {
  const w = h.whenOf(t);
  return !t.completed && !h.isMeeting(t) && !!w && w < now;
}

/** show: open | overdue | nodate | meetings | done | all; q: words to find in the text or tags. */
export function filterTasks(all, { show = 'open', q = '' } = {}, h, now = new Date()) {
  const needle = String(q).trim().toLowerCase();
  return all.filter((t) => {
    if (show === 'open' && t.completed) return false;
    if (show === 'done' && !t.completed) return false;
    if (show === 'overdue' && !isOverdue(t, h, now)) return false;
    if (show === 'meetings' && !h.isMeeting(t)) return false;
    if (show === 'nodate' && (t.deadline || t.completed)) return false;
    if (needle && !(String(t.text).toLowerCase().includes(needle) || h.tagsOf(t).some((g) => String(g).toLowerCase().includes(needle)))) return false;
    return true;
  });
}

export function sortTasks(list, sort, h) {
  const due = (t) => (h.whenOf(t) ? h.whenOf(t).getTime() : Infinity);
  return [...list].sort((a, b) => {
    if (sort === 'priority') return (RANK[a.priority] ?? 1) - (RANK[b.priority] ?? 1) || due(a) - due(b);
    if (sort === 'newest') return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    if (sort === 'az') return String(a.text).localeCompare(String(b.text));
    return due(a) - due(b);
  });
}

/** -> [{ key, label, items }] in display order. by: due | priority | tag | none. */
export function groupTasks(list, by, h, now = new Date()) {
  const map = new Map();
  const put = (key, label, rank, t) => { if (!map.has(key)) map.set(key, { key, label, rank, items: [] }); map.get(key).items.push(t); };
  const today = startOfDay(now);
  list.forEach((t) => {
    if (by === 'none') return put('all', 'All tasks', 0, t);
    if (by === 'priority') return put(t.priority || 'medium', PRIORITY_LABEL[t.priority] || PRIORITY_LABEL.medium, RANK[t.priority] ?? 1, t);
    if (by === 'tag') {
      const tags = h.tagsOf(t);
      if (!tags.length) return put('~none', 'No tag', 999, t);
      return tags.forEach((g) => put(`t:${g}`, `#${g}`, 0, t));
    }
    const w = h.whenOf(t);
    if (!w) return put('nodate', 'No date', 900, t);
    const days = Math.round((startOfDay(w) - today) / 86400000);
    if (days < 0 && !t.completed) return put('late', 'Overdue', 0, t);
    if (days < 0) return put('past', 'Earlier', 800, t);
    if (days === 0) return put('today', 'Today', 1, t);
    if (days === 1) return put('tomorrow', 'Tomorrow', 2, t);
    if (days < 7) return put('week', 'This week', 3, t);
    return put('later', 'Later', 4, t);
  });
  return [...map.values()].sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
}
