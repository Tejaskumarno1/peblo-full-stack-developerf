import { readFileSync } from 'node:fs';
const t = readFileSync('client/src/soft/SoftNotes.jsx', 'utf8').split(/\r?\n/);
[50, 610, 646, 669, 727, 740, 852].forEach((n) => console.log(`${n}: ${t[n - 1].replace(/�/g, '<?>').slice(0, 520)}\n`));
console.log(t.slice(0, 40).filter((l) => /lucide/.test(l)).join('\n'));
