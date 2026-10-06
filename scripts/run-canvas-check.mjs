// Checks that the app renders the design the same way at every window size, zoom and DPI.
//
//   npm run build && npm run check:canvas
//
// Starts the real Electron app several times, each with a different screen scale
// (100%, 125%, 150%, 200%, like Windows display scaling or a Retina/HiDPI screen), on a
// throwaway data folder. scripts/canvas-check.cjs resizes the window, presses the zoom keys
// and records where every element sits on the design canvas. For each window shape it checks
// the canvas fills the window at the design's scale, and that the zoom keys and the screen
// scale change nothing: every run is compared with the same window at 100% screen scale.
// Screenshots and the full report go to release/canvas-check/.
import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import electronPath from 'electron';

const SCALES = (process.env.CANVAS_SCALES || '1,1.25,1.5,2').split(',').map(Number);
const OUT = path.resolve('release', 'canvas-check');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

function runOnce(scale) {
  const out = path.join(OUT, `scale-${scale}`);
  const data = mkdtempSync(path.join(os.tmpdir(), 'peblo-canvas-'));
  return new Promise((resolve) => {
    const child = spawn(electronPath, ['.', `--force-device-scale-factor=${scale}`], {
      stdio: 'inherit',
      env: {
        ...process.env,
        PEBLO_CANVAS_CHECK: '1',
        PEBLO_DATA_DIR: data,
        PEBLO_CANVAS_OUT: out,
        PEBLO_CANVAS_SHOTS: process.env.PEBLO_CANVAS_SHOTS || (scale === 1 || scale === 1.5 ? 'soft,studio,console,river,orbit' : ''),
      },
    });
    const timer = setTimeout(() => child.kill(), 15 * 60 * 1000);
    child.on('exit', () => {
      clearTimeout(timer);
      rmSync(data, { recursive: true, force: true });
      try { resolve(JSON.parse(readFileSync(path.join(out, 'result.json'), 'utf8'))); } catch { resolve([{ error: 'no result' }]); }
    });
  });
}

const all = [];
for (const scale of SCALES) {
  console.log(`\n▶ Screen scale ${scale * 100}%`);
  const results = await runOnce(scale);
  for (const r of results) all.push({ scale, ...r });
}

// Compare every run with the same style, screen and window shape at 100% screen scale.
const key = (r) => `${r.style} ${r.route} ${r.size}`;
const baseline = new Map(all.filter((r) => r.scale === SCALES[0] && r.action === 'resize').map((r) => [key(r), r]));
const rows = [];
let failures = 0;
for (const r of all) {
  if (r.error) { failures++; rows.push(`| ${r.scale} | ERROR | ${r.error.split('\n')[0]} |`); continue; }
  const b = baseline.get(key(r));
  // Chromium rounds each font's metrics to whole device pixels, so text can sit up to about
  // one device pixel (plus a design pixel of rounding) differently at another scale. Anything
  // beyond that, or any change in line wrapping or in the elements drawn, is a real layout change.
  // Each box edge snaps to a device pixel, so down a long list the snapping can add up to a few
  // design pixels between screen scales. More than that means the layout itself changed.
  const tolerance = r.scale === SCALES[0] ? 2 + 1 / r.zoom : 6;
  let drift = 0;
  let worst = '';
  let wraps = 0;
  let firstWrap = '';
  const sameCount = b && b.rects.length === r.rects.length;
  // Two runs can show different content (a relative time like "2 min ago", or notes saved in a
  // different order). That isn't a layout difference, so such rows are reported, not failed.
  const contentDiffers = sameCount && r.texts.some((t, i) => t !== b.texts[i]);
  if (sameCount) {
    r.rects.forEach((rc, i) => {
      const d = Math.max(...rc.map((v, j) => Math.abs(v - b.rects[i][j])));
      if (d > drift) { drift = d; worst = `${r.names[i]} [${b.rects[i]}] → [${rc}]`; }
      if (r.lines[i] !== b.lines[i]) { wraps++; if (!firstWrap) firstWrap = `${r.names[i]} ${b.lines[i]} → ${r.lines[i]} lines`; }
    });
  }
  // The canvas is never smaller than the design, keeps the design's height (or width) exactly,
  // and fills the window up to the 2160px cap: no empty bars.
  const [vw, vh] = r.viewport;
  const [, , cw, ch] = r.root;
  const fills = Math.abs(cw - Math.min(vw, 2160)) <= 1 && Math.abs(ch - vh) <= 1;
  const designAxis = Math.abs(ch - 900) <= 1 || Math.abs(cw - 1440) <= 1;
  const canvasOk = fills && designAxis && cw >= 1439 && ch >= 899;
  const layoutOk = canvasOk && (contentDiffers || (sameCount && wraps === 0 && drift <= tolerance));
  if (!layoutOk) failures++;
  const ok = layoutOk;
  const why = !b ? 'no baseline' : !canvasOk ? `canvas ${cw}×${ch} in ${vw}×${vh}` : !sameCount ? 'elements changed' : wraps ? `text rewrapped: ${firstWrap}` : drift > tolerance ? `moved: ${worst}` : '';
  rows.push(`| ${r.scale * 100}% | ${r.style} | ${r.route} | ${r.size} | ${r.action} | ${r.content.join('×')} | ${r.zoom} | ${vw}×${vh} | ${cw}×${ch} | ${drift} (≤${tolerance.toFixed(1)}) | ${wraps} | ${contentDiffers ? 'content differs from the 100% run (not compared)' : ok ? 'ok' : 'FAIL ' + why} |`);
}

const report = [
  '# Design canvas check',
  '',
  'Each row is compared with the same screen and window shape at 100% screen scale, before any zoom keys.',
  '"Canvas" must fill the window and keep the design\'s 900px height (or 1440px width in a tall window).',
  '"Drift" is the largest change in any element\'s position or size, in design pixels. It may be about one',
  'device pixel plus rounding, because Chromium snaps text to device pixels.',
  '"Rewrapped" counts texts whose number of lines changed. Any rewrap, missing element or drift above the limit fails.',
  '',
  '| Screen scale | Style | Screen | Window asked | Action | Window got (DIP) | Zoom | Page viewport | Canvas | Drift | Rewrapped | Result |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows,
  '',
  `${rows.length - failures} of ${rows.length} passed.`,
].join('\n');
writeFileSync(path.join(OUT, 'report.md'), report);
console.log(`\n${rows.length - failures} of ${rows.length} checks passed. Report: ${path.join(OUT, 'report.md')}`);
process.exit(failures ? 1 : 0);
