// Folders and smart folders for the Notes panel. Definitions live in the account settings (noteFolders);
// a note belongs to a normal folder through meta.folder (its name), so older notes keep working.

// [key, light background, light icon/dot colour]. The dark variants are derived (see `darkTone`) so every colour stays readable in
// the dark and midnight themes: a pastel chip on a dark page glared, and its dark icon on a dark chip was hard to see.
export const FOLDER_COLORS = [
  ['lilac', '#DDD8FF', '#B7ADFF'],
  ['peach', '#FFD9C4', '#FF9E78'],
  ['mint', '#CDEBD9', '#8FD1AE'],
  ['butter', '#FFE9A6', '#F2C94C'],
  ['sky', '#CFE5F8', '#8EC3EE'],
  ['sand', '#F4EEE5', '#CDBFAE'],
  ['rose', '#FBD3DF', '#F08CAD'],
  ['coral', '#FFD0CC', '#F2837A'],
  ['teal', '#C7ECEA', '#6FCBC4'],
  ['lime', '#E1F0B8', '#B0D45A'],
  ['plum', '#EBD0F0', '#C58AD6'],
  ['slate', '#DCE1E8', '#9AA7B8'],
];
export const colorOf = (tone) => FOLDER_COLORS.find((c) => c[0] === tone) || FOLDER_COLORS[0];

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (a) => `#${a.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => hex(rgb(a).map((v, i) => v * t + rgb(b)[i] * (1 - t)));
const lum = (h) => { const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; const [r, g, b] = rgb(h); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
/** WCAG contrast ratio of two #rrggbb colours. */
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** The icon colour on the light chip: the accent darkened until it reads on its pastel. */
export const lightInk = (tone) => mix(colorOf(tone)[2], '#000000', 0.42);
const DARK_PAGE = '#1A1620';
/** Dark and midnight variant of a folder colour: a deep tint of the accent as the chip, the light pastel as the icon on it. */
export function darkTone(tone) {
  const [, bg, fg] = colorOf(tone);
  return { bg: mix(fg, DARK_PAGE, 0.3), fg: bg, dot: fg };
}
/** CSS variables for one folder colour; the classes `.fc` / `.fc-dot` in notespanel.css pick the light or dark pair. */
export function toneVars(tone) {
  const [, bg, fg] = colorOf(tone);
  const d = darkTone(tone);
  return { '--fc-bg': bg, '--fc-fg': lightInk(tone), '--fc-dbg': d.bg, '--fc-dfg': d.fg, '--fc-dot': fg, '--fc-ddot': fg };
}

export const RULE_FIELDS = [['tag', 'Tag'], ['text', 'Text contains'], ['edited', 'Edited'], ['folder', 'Folder'], ['tasks', 'Has tasks'], ['pics', 'Has pictures'], ['pinned', 'Pinned']];
export const EDITED = [['1', 'today'], ['7', 'last 7 days'], ['30', 'last 30 days']];
export const YESNO = [['yes', 'yes'], ['no', 'no']];
export const opOf = (f) => (f === 'edited' ? 'in' : f === 'text' ? 'contains' : 'is');
export const MATCH_MODES = [['all', 'All of the rules'], ['any', 'Any of the rules']];

export const newId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** The tag a folder can also collect: the first word of its name. */
export const tagFor = (name) => String(name || '').trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9_-]/g, '');

const hasPics = (n) => (typeof n.hasPics === 'boolean' ? n.hasPics : /!\[|<figure>/.test(n.content || '')); // the light list sends hasPics, not the text

export function ruleMatch(n, r) {
  switch (r.f) {
    case 'tag': return (n.tags || []).includes(r.v);
    case 'text': { // the title or the start of the text (the light list carries `snippet`, the full note `content`)
      const q = String(r.v || '').trim().toLowerCase();
      if (!q) return false;
      return `${n.title || ''}
${typeof n.snippet === 'string' ? n.snippet : n.content || ''}`.toLowerCase().includes(q);
    }
    case 'edited': return Date.now() - new Date(n.updatedAt || 0).getTime() <= Number(r.v || 7) * 86400000;
    case 'folder': return (n.meta?.folder || '') === r.v;
    case 'tasks': return (n.taskCount > 0) === (r.v !== 'no');
    case 'pics': return hasPics(n) === (r.v !== 'no');
    case 'pinned': return !!n.meta?.pinned === (r.v !== 'no');
    default: return true;
  }
}
/** A smart folder holds a note when all of its rules match (mode 'all', the default) or any one of them does (mode 'any'). */
export const smartMatch = (n, rules, mode = 'all') => (rules || []).length > 0 && (mode === 'any' ? rules.some((r) => ruleMatch(n, r)) : rules.every((r) => ruleMatch(n, r)));

/** Does the note sit in this (normal) folder? */
export function inFolder(n, def, defs, withSub) {
  const kids = withSub ? defs.filter((d) => d.parent === def.id && !d.smart) : [];
  const names = [def.name, ...kids.map((d) => d.name)];
  const own = n.meta?.folder || '';
  if (own) return names.includes(own); // a note that was put in a folder belongs to that folder only
  // only a note with no folder of its own can be collected by a tag
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
