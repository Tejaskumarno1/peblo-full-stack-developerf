// Lists every source line holding the replacement character (U+FFFD) or common mojibake, so none reach the app.
// Built from code points so this file stays plain ASCII. Run with --check to fail (exit 1) when anything is found.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const roots = ['client/src', 'client/index.html', 'server/src']; // the e2e files may name the character on purpose
const exts = /\.(jsx?|mjs|css|html|ts|md)$/;
const ch = (...n) => String.fromCharCode(...n);
const bad = new RegExp([ch(0xFFFD), ch(0xE2, 0x20AC), ch(0xC2, 0xB7), ch(0xC3) + '[' + ch(0x80) + '-' + ch(0xBF) + ']'].join('|'));
const out = [];
const walk = (p) => {
  const s = statSync(p, { throwIfNoEntry: false }); if (!s) return;
  if (s.isDirectory()) { if (/node_modules|dist|generated/.test(p)) return; readdirSync(p).forEach((n) => walk(join(p, n))); return; }
  if (!exts.test(p)) return;
  readFileSync(p, 'utf8').split(/\r?\n/).forEach((l, i) => { if (bad.test(l)) out.push(`${p.replace(/\\/g, '/')}:${i + 1}  ${l.trim().slice(0, 140)}`); });
};
roots.forEach(walk);
console.log(out.join('\n'));
console.log(`\n${out.length} line(s)`);
process.exit(process.argv.includes('--check') && out.length ? 1 : 0);
