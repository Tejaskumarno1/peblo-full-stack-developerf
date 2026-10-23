// Orbit note templates, find/replace and outline helpers (pure functions, unit-tested).

export const TEMPLATES = [
  {
    id: 'lecture', name: 'Lecture notes', title: 'Lecture: ',
    content: '## Topic\n\n## Key ideas\n\n- \n\n## Examples\n\n## Questions to follow up\n\n- \n\n## Summary\n\n',
  },
  {
    id: 'cornell', name: 'Cornell', title: 'Cornell notes: ',
    content: '## Cues and questions\n\n- \n\n## Notes\n\n\n## Summary\n\n',
  },
  {
    id: 'daily', name: 'Daily log', title: 'Daily log',
    content: '## Today I did\n\n- \n\n## What I learned\n\n- \n\n## Tomorrow\n\n- \n\n',
  },
  {
    id: 'meeting', name: 'Meeting', title: 'Meeting: ',
    content: '## Attendees\n\n- \n\n## Agenda\n\n- \n\n## Decisions\n\n- \n\n## Action items\n\n- [ ] \n\n',
  },
];

/** Headings (levels 1-3) of a markdown note, skipping fenced code. */
export function outlineOf(md) {
  const out = [];
  let fence = false;
  for (const line of String(md || '').split('\n')) {
    if (/^\s*```/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const m = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2].replace(/[*_`]/g, '').trim() });
  }
  return out;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Number of matches of `find` in `text`. */
export function countMatches(text, find, { matchCase = false } = {}) {
  if (!find) return 0;
  return (String(text || '').match(new RegExp(esc(find), matchCase ? 'g' : 'gi')) || []).length;
}

/** Replace every match; returns { text, count }. */
export function replaceAll(text, find, repl, { matchCase = false } = {}) {
  const count = countMatches(text, find, { matchCase });
  if (!count) return { text: String(text || ''), count: 0 };
  return { text: String(text).replace(new RegExp(esc(find), matchCase ? 'g' : 'gi'), () => repl), count };
}
