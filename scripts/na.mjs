import { readFileSync } from 'node:fs';
for (const f of ['scripts/find-glyphs.mjs', 'client/src/soft/SoftNotes.jsx']) {
  readFileSync(f, 'utf8').split(/\r?\n/).forEach((l, i) => { const m = [...l].filter((c) => c.charCodeAt(0) > 127); if (m.length) console.log(`${f}:${i + 1}  ${[...new Set(m.map((c) => 'U+' + c.charCodeAt(0).toString(16).toUpperCase()))].join(' ')}`); });
}
