// Pure helpers for the Notes list: grouping by tag (N42) and what a row shows (N45).

/** Tags that name a place, not a topic: they never make a group of their own. */
const SKIP = new Set(['inbox']);
export const topicTags = (n) => (n.tags || []).filter((t) => !SKIP.has(t));

/**
 * Groups notes by tag. A note with several tags appears under each of them; a note with no tag (other than inbox) goes under
 * "untagged". Biggest group first. Returns [{ tag, notes }].
 */
export function groupByTag(notes) {
  const m = new Map();
  const put = (t, n) => { if (!m.has(t)) m.set(t, []); m.get(t).push(n); };
  for (const n of notes) {
    const tags = [...new Set(topicTags(n))];
    if (tags.length === 0) put('untagged', n);
    else for (const t of tags) put(t, n);
  }
  return [...m.entries()]
    .sort((a, b) => b[1].length - a[1].length || (a[0] === 'untagged') - (b[0] === 'untagged') || a[0].localeCompare(b[0]))
    .map(([tag, list]) => ({ tag, notes: list }));
}

/** The "also in #x, #y" hint for a note shown under `tag` (empty when it has no other tag). */
export const alsoIn = (n, tag) => [...new Set(topicTags(n))].filter((t) => t !== tag);

/** Every note once, in order of first appearance (a note listed under several tag groups is one note when selecting). */
export function uniqueNotes(notes) {
  const seen = new Set();
  return notes.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
}

/** Up to `max` tags a row shows (never the inbox tag). */
export const rowTags = (n, max = 2) => topicTags(n).slice(0, max);

const fmt = (d) => {
  const t = new Date(d || 0);
  return !d || Number.isNaN(t.getTime()) ? '' : t.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
/** The row's tooltip: when the note was created and last edited. */
export const rowTitle = (n) => [n.createdAt && `Created ${fmt(n.createdAt)}`, n.updatedAt && `Edited ${fmt(n.updatedAt)}`].filter(Boolean).join(' · ');
/** Which time a row shows: the created time when the list is sorted by created, otherwise the edited time. */
export const rowStamp = (n, sort) => (sort === 'created' && n.createdAt ? { label: 'Created', at: n.createdAt } : { label: '', at: n.updatedAt });
