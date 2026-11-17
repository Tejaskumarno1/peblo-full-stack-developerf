// Contrast sweep: reads the theme variables of Soft (soft.css --s-*), River (river.css --r-*) and Orbit (orbit.css --o-*)
// in Light, Dark and Midnight and fails when a text / background pair is below 4.5:1 (large text: 3:1), or when a
// Midnight card is not a visible step lighter than the black page.
// Pure node. Run:  node scripts/contrast-check.mjs   (exit 1 on any failure)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Variables (with `prefix`) declared in the blocks whose selector is exactly `selector`; the first declaration wins. */
function block(css, selector, prefix) {
  const out = {};
  const re = new RegExp(`(^|\\n)${esc(selector)}\\s*\\{([^}]*)\\}`, 'g');
  const decl = new RegExp(`(${esc(prefix)}[\\w-]+)\\s*:\\s*([^;]+);`, 'g');
  let m;
  while ((m = re.exec(css))) {
    const body = m[2].replace(/\/\*[\s\S]*?\*\//g, '');
    for (const d of body.matchAll(decl)) if (!(d[1] in out)) out[d[1]] = d[2].trim();
  }
  return out;
}
/** Light, dark and midnight variable sets of one style (`.soft`, `.river`, `.orbit`). */
function modes(file, scope, prefix) {
  const css = read(file);
  const light = block(css, scope, prefix);
  const dark = { ...light, ...block(css, `.theme-dark ${scope}`, prefix) };
  const midnight = { ...dark, ...block(css, `.theme-midnight ${scope}`, prefix) };
  return { light, dark, midnight };
}

// ---------- colour maths ----------
function parse(v, vars, depth = 0) {
  v = String(v).trim();
  const ref = /^var\((--[\w-]+)(?:,\s*([^)]+))?\)$/.exec(v);
  if (ref && depth < 8) return parse(vars[ref[1]] ?? ref[2], vars, depth + 1);
  let m = /^color-mix\(in srgb,\s*(.+?)\s+(\d+(?:\.\d+)?)%,\s*(.+)\)$/.exec(v);
  if (m) {
    const a = parse(m[1], vars, depth + 1), b = parse(m[3], vars, depth + 1), t = Number(m[2]) / 100;
    return [0, 1, 2].map((i) => a[i] * t + b[i] * (1 - t)).concat(1);
  }
  m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (m) { let h = m[1]; if (h.length === 3) h = [...h].map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1); }
  m = /^rgba?\(([^)]+)\)$/.exec(v);
  if (m) { const p = m[1].split(',').map((x) => parseFloat(x)); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
  throw new Error(`cannot read colour: ${v}`);
}
const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
const lum = ([r, g, b]) => { const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// ---------- the pairs ----------
// [text, background, what it is, large?]  A background may be translucent (laid over the page colour) or a color-mix().
const SOFT = [];
for (const t of ['--s-fg', '--s-fg2', '--s-fg3']) for (const f of ['--s-bg', '--s-surface', '--s-col', '--s-chip-solid', '--s-item', '--s-chip', '--s-peach', '--s-mint', '--s-butter', '--s-lilac', '--s-sky']) SOFT.push([t, f, `notes list and tiles: ${t} on ${f}`, false]);
SOFT.push(['--s-accent-ink', '--s-bg', 'accent text on the page', false]);
SOFT.push(['--s-accent-ink', '--s-surface', 'accent text on a card', false]);
SOFT.push(['--s-accent-ink', '--s-accent-soft', 'accent text on its soft fill', false]);
SOFT.push(['--s-on-accent', '--s-accent', 'text on accent buttons', false]);
SOFT.push(['--s-dock-fg', '--s-dock', 'dock icons', false]);
SOFT.push(['--s-dock-on-fg', '--s-dock-on', 'active dock item', false]);
SOFT.push(['--s-bg', '--s-fg', 'inverted pill (View when set, hover chips)', false]);
SOFT.push(['--s-local', '--s-bg', 'local / saved badge', false]);
SOFT.push(['--s-danger', '--s-bg', 'danger text on the page', false]);
SOFT.push(['--s-danger', '--s-surface', 'danger text on a card or dialog', false]);
SOFT.push(['--s-danger-fg', '--s-danger-bg', 'text on a danger button', false]);
SOFT.push(['--s-fg', '--s-butter', 'warning note text', false]);

const RIVER = [];
for (const t of ['--r-fg', '--r-fg2', '--r-fg3']) for (const f of ['--r-bg', '--r-surface', '--r-lane']) RIVER.push([t, f, `River text: ${t} on ${f}`, false]);
RIVER.push(['--r-meet-ink', '--r-meet', 'River meeting on the timeline', false]);
RIVER.push(['--r-focus-ink', '--r-focus', 'River focus block', false]);
RIVER.push(['--r-personal-ink', '--r-personal', 'River personal block', false]);
RIVER.push(['--r-meet-ink', 'color-mix(in srgb, var(--r-meet) 55%, var(--r-lane))', 'River past meeting (home timeline)', false]);
RIVER.push(['--r-focus-ink', 'color-mix(in srgb, var(--r-focus) 55%, var(--r-lane))', 'River past focus block', false]);
RIVER.push(['--r-personal-ink', 'color-mix(in srgb, var(--r-personal) 55%, var(--r-lane))', 'River past personal block', false]);
RIVER.push(['--r-meet-ink', '--r-surface', 'River links and cited sources', false]);
RIVER.push(['--r-now-ink', '--r-bg', 'River accent text on the page', false]);
RIVER.push(['--r-now-ink', '--r-surface', 'River accent text on a card', false]);
RIVER.push(['--r-on-now', '--r-now', 'River "now" pill', false]);
RIVER.push(['--r-on-ink', '--r-ink', 'River selected block and dark buttons', false]);
RIVER.push(['--r-fg', '--r-highlight', 'River highlighted text', false]);

const ORBIT = [];
for (const t of ['--o-fg', '--o-fg2', '--o-fg3']) for (const f of ['--o-bg', '--o-surface', '--o-soft', '--o-rail']) ORBIT.push([t, f, `Orbit text: ${t} on ${f}`, false]);
ORBIT.push(['--o-path-ink', '--o-surface', 'Orbit path text on a card', false]);
ORBIT.push(['--o-path-ink', '--o-path-soft', 'Orbit path text on its soft fill', false]);
ORBIT.push(['--o-weak-ink', '--o-surface', 'Orbit weak / overdue text', false]);
ORBIT.push(['--o-weak-ink', '--o-bg', 'Orbit weak text on the map', false]);
ORBIT.push(['--o-on-path', '--o-path', 'Orbit path buttons, step numbers, badges', false]);
ORBIT.push(['--o-on-ink', '--o-ink', 'Orbit dark buttons', false]);
ORBIT.push(['--o-fg', '--o-mark', 'Orbit marked text', false]);
ORBIT.push(['--o-fg', 'color-mix(in srgb, var(--o-strong) 18%, var(--o-surface))', 'Orbit status ok', false]);
ORBIT.push(['--o-fg', 'color-mix(in srgb, var(--o-weak) 18%, var(--o-surface))', 'Orbit status bad', false]);

const STYLES = [
  { name: 'Soft', sets: modes('client/src/soft/soft.css', '.soft', '--s-'), pairs: SOFT, page: '--s-bg', cards: ['--s-surface'] },
  { name: 'River', sets: modes('client/src/river/river.css', '.river', '--r-'), pairs: RIVER, page: '--r-bg', cards: ['--r-surface', '--r-lane'] },
  { name: 'Orbit', sets: modes('client/src/orbit/orbit.css', '.orbit', '--o-'), pairs: ORBIT, page: '--o-bg', cards: ['--o-surface', '--o-soft'] },
];
const MIDNIGHT_STEP = 1.12; // a card must stand out from the black page by at least this luminance ratio

let failed = 0, checked = 0;
const missing = (vars, v) => v.startsWith('--') && !(v in vars);
for (const st of STYLES) {
  for (const [mode, vars] of Object.entries(st.sets)) {
    const base = parse(vars[st.page], vars);
    for (const [t, f, what, large] of st.pairs) {
      if (missing(vars, t) || missing(vars, f)) { console.log(`FAIL  [${st.name} ${mode}] ${what}: variable missing (${missing(vars, t) ? t : f})`); failed++; continue; }
      const val = (v) => (v.startsWith('--') ? vars[v] : v);
      const bg = over(parse(val(f), vars), f === st.page ? [255, 255, 255, 1] : base);
      const fg = over(parse(val(t), vars), bg);
      const r = ratio(fg, bg), need = large ? 3 : 4.5;
      checked++;
      if (r < need) { failed++; console.log(`FAIL  [${st.name} ${mode}] ${what}  ${r.toFixed(2)}:1 < ${need}:1   (${val(t)} on ${val(f)})`); }
    }
  }
  // Midnight: cards and panels must be a visible step lighter than the page
  const mid = st.sets.midnight, page = parse(mid[st.page], mid);
  for (const c of st.cards) {
    const r = ratio(over(parse(mid[c], mid), page), page);
    checked++;
    if (r < MIDNIGHT_STEP) { failed++; console.log(`FAIL  [${st.name} midnight] ${c} is not a visible step from the page: ${r.toFixed(3)} < ${MIDNIGHT_STEP}`); }
  }
}
console.log(failed ? `\n${failed} of ${checked} checks below the minimum` : `All ${checked} contrast checks pass (Soft, River, Orbit in Light, Dark, Midnight)`);
process.exit(failed ? 1 : 0);
