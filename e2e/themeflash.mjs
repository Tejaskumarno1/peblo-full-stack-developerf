// PEB-102: the saved theme is applied before the app's script runs, so a dark theme has no light first frame.
import { boot } from './lib.mjs';
const { base, page, ctx, check, finish } = await boot();
const firstFrame = async (theme, style) => {
  await page.goto(base + '/tasks');
  await page.evaluate(([t, s]) => { localStorage.setItem('peblo-theme', t); localStorage.setItem('peblo-style', s); }, [theme, style]);
  // Stop the app's scripts from ever running: what is left is exactly what the first frame looks like.
  await page.route('**/*.js', (r) => r.abort());
  await page.goto(base + '/tasks', { waitUntil: 'domcontentloaded' });
  const out = await page.evaluate(() => {
    const cs = getComputedStyle(document.body);
    return { cls: document.documentElement.className, style: document.documentElement.getAttribute('data-style'), bg: cs.backgroundColor, scheme: document.documentElement.style.colorScheme };
  });
  await page.unroute('**/*.js');
  return out;
};
const lum = (rgb) => { const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(rgb) || []; return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255; };
try {
  for (const style of ['studio', 'soft', 'river', 'orbit', 'console']) {
    const d = await firstFrame('dark', style);
    check(`${style}: dark theme is on in the first frame`, d.cls.includes('theme-dark') && d.style === style && lum(d.bg) < 0.25, d);
  }
  const m = await firstFrame('midnight', 'studio');
  check('midnight theme is on in the first frame', m.cls.includes('theme-midnight') && lum(m.bg) < 0.1, m);
  const l = await firstFrame('light', 'studio');
  check('light theme stays light', !l.cls.includes('theme-dark') && lum(l.bg) > 0.8, l);
  await page.emulateMedia({ colorScheme: 'dark' });
  const sys = await firstFrame('system', 'studio');
  check('"follow system" is dark when the system is dark', sys.cls.includes('theme-dark'), sys);
} catch (e) { console.error(e); process.exitCode = 1; }
await finish();
