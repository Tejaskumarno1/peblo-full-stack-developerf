// Repairs text that was UTF-8 but got read as Windows-1252 (shows up as "â€¦" for an ellipsis). Usage: node scripts/unmojibake.mjs file...
import fs from 'node:fs';
const cp = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
const byteOf = (ch) => { const c = ch.codePointAt(0); return cp[c] ?? (c < 256 ? c : -1); };
const run = /[Â-ô][\u0080-¿ŒœŠšŸŽžƒˆ˜–—‘-„†-•…‰‹›€™]{1,3}/g;
for (const f of process.argv.slice(2)) {
  const s = fs.readFileSync(f, 'utf8'); let n = 0;
  const out = s.replace(run, (m) => {
    const bytes = [...m].map(byteOf); if (bytes.some((b) => b < 0)) return m;
    try { const t = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes)); n += 1; return t; } catch { return m; }
  });
  if (n) { fs.writeFileSync(f, out); console.log(`${f}: fixed ${n}`); }
}
