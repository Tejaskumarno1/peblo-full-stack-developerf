import { smartMatch } from './folders.js';

/** Note count of every folder in one pass over the notes (same rules as `inFolder` / `smartMatch`). Returns Map<folder id, count>. */
export function folderCounts(notes, defs, withSub) {
  const counts = new Map(defs.map((d) => [d.id, 0]));
  const byName = new Map(); // folder name -> ids of the normal folders that hold notes with that name (itself, or as a sub-folder)
  const byTag = new Map(); // collecting tag -> ids
  const add = (m, k, id) => { if (!k) return; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(id); };
  const smart = [];
  for (const d of defs) {
    if (d.smart) { smart.push(d); continue; }
    const kids = withSub ? defs.filter((k) => k.parent === d.id && !k.smart) : [];
    for (const x of [d, ...kids]) { add(byName, x.name, d.id); add(byTag, x.tag, d.id); }
  }
  for (const n of notes) {
    const own = n.meta?.folder || '';
    const hit = new Set();
    if (own) (byName.get(own) || []).forEach((id) => hit.add(id)); // a note in a folder belongs to that folder only
    else for (const t of n.tags || []) (byTag.get(t) || []).forEach((id) => hit.add(id)); // a tag collects only notes with no folder
    hit.forEach((id) => counts.set(id, counts.get(id) + 1));
    for (const d of smart) if (smartMatch(n, d.smart, d.smartMode)) counts.set(d.id, counts.get(d.id) + 1);
  }
  return counts;
}
