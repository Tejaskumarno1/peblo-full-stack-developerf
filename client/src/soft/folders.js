// Folders and smart folders for the Notes panel. Definitions live in the account settings (noteFolders);
// a note belongs to a normal folder through meta.folder (its name), so older notes keep working.

export const FOLDER_COLORS = [
  ['lilac', '#DDD8FF', '#B7ADFF'],
  ['peach', '#FFD9C4', '#FF9E78'],
  ['mint', '#CDEBD9', '#8FD1AE'],
  ['butter', '#FFE9A6', '#F2C94C'],
  ['sky', '#CFE5F8', '#8EC3EE'],
  ['sand', '#F4EEE5', '#CDBFAE'],
];
export const colorOf = (tone) => FOLDER_COLORS.find((c) => c[0] === tone) || FOLDER_COLORS[0];

export const RULE_FIELDS = [['tag', 'Tag'], ['edited', 'Edited'], ['folder', 'Folder'], ['tasks', 'Has tasks'], ['pics', 'Has pictures'], ['pinned', 'Pinned']];
export const EDITED = [['1', 'today'], ['7', 'last 7 days'], ['30', 'last 30 days']];
export const YESNO = [['yes', 'yes'], ['no', 'no']];
export const opOf = (f) => (f === 'edited' ? 'in' : 'is');

export const newId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** The tag a folder can also collect: the first word of its name. */
export const tagFor = (name) => String(name || '').trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9_-]/g, '');

const hasPics = (n) => /!\[|<figure>/.test(n.content || '');

export function ruleMatch(n, r) {
  switch (r.f) {
    case 'tag': return (n.tags || []).includes(r.v);
    case 'edited': return Date.now() - new Date(n.updatedAt || 0).getTime() <= Number(r.v || 7) * 86400000;
    case 'folder': return (n.meta?.folder || '') === r.v;
    case 'tasks': return (n.taskCount > 0) === (r.v !== 'no');
    case 'pics': return hasPics(n) === (r.v !== 'no');
    case 'pinned': return !!n.meta?.pinned === (r.v !== 'no');
    default: return true;
  }
}
export const smartMatch = (n, rules) => (rules || []).length > 0 && rules.every((r) => ruleMatch(n, r));

/** Does the note sit in this (normal) folder? */
export function inFolder(n, def, defs, withSub) {
  const kids = withSub ? defs.filter((d) => d.parent === def.id && !d.smart) : [];
  const names = [def.name, ...kids.map((d) => d.name)];
  if (names.includes(n.meta?.folder || '')) return true;
  const tags = [def.tag, ...kids.map((d) => d.tag)].filter(Boolean);
  return tags.some((t) => (n.tags || []).includes(t));
}

/** Every folder the notes use, with a definition for each (older folders get a default colour). */
export function withLegacy(defs, notes) {
  const out = [...defs];
  const seen = new Set(defs.filter((d) => !d.smart).map((d) => d.name));
  for (const n of notes) {
    const f = n.meta?.folder;
    if (f && !seen.has(f)) { seen.add(f); out.push({ id: `legacy-${f}`, name: f, color: 'sand', legacy: true }); }
  }
  return out;
}
