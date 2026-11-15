/*
 * A local copy of text that has not reached the server yet (audit R23/R25).
 * Kept in localStorage under `peblo-unsaved:<noteId>` while a note has unsaved changes, and removed once the save succeeds.
 * `base` is a short hash of the saved text the person started from, so the next open can tell "the server still has the old
 * text, restore mine" (auto) from "the server moved on meanwhile" (ask first). Never holds more than one copy per note.
 */
const PREFIX = 'peblo-unsaved:';
const MAX = 4_000_000; // characters; localStorage is about 5 MB per origin

export function hashText(s) {
  let h = 5381;
  const t = String(s ?? '');
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return `${t.length}:${h}`;
}

export function writeUnsaved(id, { content, title, baseContent }) {
  try {
    if (!id || id === '__draft__' || typeof content !== 'string' || content.length > MAX) return false;
    const prev = readUnsaved(id);
    // keep the first base: it describes what the server had when the person started typing
    const base = prev && prev.base ? prev.base : hashText(baseContent);
    localStorage.setItem(PREFIX + id, JSON.stringify({ content, title: title ?? null, base, at: Date.now() }));
    return true;
  } catch { return false; }
}

export function readUnsaved(id) {
  try {
    if (!id) return null;
    const raw = localStorage.getItem(PREFIX + id);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && typeof v.content === 'string' ? v : null;
  } catch { return null; }
}

/** Remove the copy. With `content`, only when the stored copy is exactly that text (a newer copy must survive). */
export function clearUnsaved(id, content) {
  try {
    if (!id) return;
    if (typeof content === 'string') { const v = readUnsaved(id); if (v && v.content !== content) return; }
    localStorage.removeItem(PREFIX + id);
  } catch { /* storage blocked */ }
}

/** 'none' | 'auto' (server text is what the copy started from) | 'ask' (the server text changed since). */
export function decideRestore(copy, serverContent) {
  if (!copy) return 'none';
  if (copy.content === serverContent) return 'none'; // the server already has it
  return copy.base === hashText(serverContent) ? 'auto' : 'ask';
}
