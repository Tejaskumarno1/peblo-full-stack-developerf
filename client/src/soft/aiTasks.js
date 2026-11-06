/** The list items in an answer (bullets or numbers), cleaned of markdown, so they can be offered as tasks. */
export function taskLines(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = /^\s*(?:[-*]|\d{1,2}[.)])\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const t = m[1].replace(/\*\*|__|`/g, '').replace(/\[(\d+)\]/g, '').replace(/\s+/g, ' ').trim();
    if (t.length >= 3 && t.length <= 140) out.push(t);
  }
  return out.slice(0, 12);
}
