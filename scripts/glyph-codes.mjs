import { readFileSync } from 'node:fs';
const t = readFileSync('client/src/soft/SoftNotes.jsx', 'utf8').split(/\r?\n/);
const bad = /�|â€|Â·|Ã[\u0080-¿]/g;
t.forEach((l, i) => { let m; bad.lastIndex = 0; while ((m = bad.exec(l))) { const a = Math.max(0, m.index - 12), b = m.index + 8; const seg = l.slice(a, b); console.log(`${i + 1}: ${[...seg].map((c) => (c.charCodeAt(0) > 126 ? 'U+' + c.charCodeAt(0).toString(16).toUpperCase() : c)).join(' ')}`); } });
