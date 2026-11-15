// Contrast sweep for Soft: reads the --s-* variables in client/src/soft/soft.css (light, dark, midnight) and fails when a
// text / background pair used by the notes list and tiles is below 4.5:1 (large or bold-large text: 3:1).
// Pure node. Run:  node scripts/contrast-check.mjs   (exit 1 on any failure)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'client/src/soft/soft.css'), 'utf8');

/** Variables declared in the first block whose selector is exactly `selector`. */
function block(selector) {
  const out = {};
  const re = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
  let m;
  while ((m = re.exec(css))) for (const d of m[2].matchAll(/(--s-[\w-]+)\s*:\s*([^;]+);/g)) if (!(d[1] in out)) out[d[1]] = d[2].trim();
  return out;
}
const light = block('.soft');
const dark = { ...light, ...block('.theme-dark .soft') };
const midnight = { ...dark, ...block('.theme-midnight .soft') };
const MODES = { light, dark, midnight };

// ---------- colour maths ----------
function parse(v, vars, over, depth = 0) {
  v = String(v).trim();
  const ref = /^var\((--s-[\w-]+)\)$/.exec(v);
  if (ref && depth < 8) return parse(vars[ref[1]], vars, over, depth + 1);
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (m) { let h = m[1]; if (h.length === 3) h = [...h].map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1); }
  m = /^rgba?\(([^)]+)\)$/.exec(v);
  if (m) { const p = m[1].split(',').map((x) => parseFloat(x)); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
  throw new Error(`cannot read colour: ${v}`);
}
const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
const lum = ([r, g, b]) => { const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// ---------- the pairs ----------
// [text variable, background variable, what it is, large?]  Backgrounds may be translucent: they are laid over --s-bg.
const TEXT = ['--s-fg', '--s-fg2', '--s-fg3'];
const FILLS = ['--s-bg', '--s-surface', '--s-col', '--s-chip-solid', '--s-item', '--s-chip', '--s-peach', '--s-mint', '--s-butter', '--s-lilac', '--s-sky'];
const PAIRS = [];
for (const t of TEXT) for (const f of FILLS) PAIRS.push([t, f, `notes list and tiles: ${t} on ${f}`, false]);
PAIRS.push(['--s-accent-ink', '--s-bg', 'accent text on the page', false]);
PAIRS.push(['--s-accent-ink', '--s-surface', 'accent text on a card', false]);
PAIRS.push(['--s-accent-ink', '--s-accent-soft', 'accent text on its soft fill', false]);
PAIRS.push(['--s-on-accent', '--s-accent', 'text on accent buttons', false]);
PAIRS.push(['--s-dock-fg', '--s-dock', 'dock icons', false]);
PAIRS.push(['--s-dock-on-fg', '--s-dock-on', 'active dock item', false]);
PAIRS.push(['--s-bg', '--s-fg', 'inverted pill (View when set, hover chips)', false]);
PAIRS.push(['--s-local', '--s-bg', 'local / saved badge', false]);
PAIRS.push(['--s-danger', '--s-bg', 'danger text on the page', false]);
PAIRS.push(['--s-danger', '--s-surface', 'danger text on a card or dialog', false]);
PAIRS.push(['--s-danger-fg', '--s-danger-bg', 'text on a danger button', false]);
PAIRS.push(['--s-fg', '--s-butter', 'warning note text', false]);

let failed = 0, checked = 0;
for (const [mode, vars] of Object.entries(MODES)) {
  const base = parse(vars['--s-bg'], vars);
  for (const [t, f, what, large] of PAIRS) {
    if (!(t in vars) || !(f in vars)) { console.log(`FAIL  [${mode}] ${what}: variable missing (${!(t in vars) ? t : f})`); failed++; continue; }
    const bg = over(parse(vars[f], vars), f === '--s-bg' ? [255, 255, 255, 1] : base);
    const fg = over(parse(vars[t], vars), bg);
    const r = ratio(fg, bg), need = large ? 3 : 4.5;
    checked++;
    if (r < need) { failed++; console.log(`FAIL  [${mode}] ${what}  ${r.toFixed(2)}:1 < ${need}:1   (${vars[t]} on ${vars[f]})`); }
  }
}
console.log(failed ? `\n${failed} of ${checked} pairs below the minimum` : `All ${checked} contrast pairs pass (light, dark, midnight)`);
process.exit(failed ? 1 : 0);
