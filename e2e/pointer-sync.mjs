// Pointer sync speed: a pointer follows the real mouse within a few frames, and a page scrolled under a still mouse updates at once.
import { boot } from './lib.mjs';

const { base, api, page, ctx, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return Date.now() - t0; } catch { /* retry */ } await wait(20); } return false; };
const ready = async (p) => { await p.locator('.bn-editor').waitFor({ timeout: 20000 }); await p.locator('[data-testid="collab-status"]').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {}); };
try {
  const filler = Array.from({ length: 60 }, (_, i) => `Filler paragraph number ${i + 1} of a long note used to test pointer sync.`).join('\n\n');
  const note = (await api('POST', '/api/notes', { title: 'Sync', content: filler, tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  const mk = async (name) => {
    const c = await ctx.browser().newContext({ viewport: { width: 1200, height: 800 } });
    await c.addInitScript((n) => { try { localStorage.setItem('peblo-guest-name', n); localStorage.setItem('peblo-guest-tour', '1'); } catch { /* ignore */ } }, name);
    const p = await c.newPage(); await p.goto(`${base}/s/note/${tok}`); await ready(p); return p;
  };
  const a = await mk('Ann'); const b = await mk('Bo');
  await wait(1200);
  const box = await a.locator('.bn-editor').boundingBox();
  await a.mouse.move(box.x + 100, 300);
  await a.mouse.move(box.x + 120, 320, { steps: 3 });
  const p = b.locator('[data-testid="peer-pointer"][data-name="Ann"]');
  check('1 Bo sees Ann', !!(await until(async () => (await p.count()) === 1)));
  await wait(300);
  const pos = async () => { if ((await p.count()) === 0) return null; const r = await p.first().boundingBox({ timeout: 500 }).catch(() => null); return r ? { x: r.x, y: r.y } : null; };
  // follow speed: a jump of 150px right must show within 150ms
  const before = await pos();
  await a.mouse.move(box.x + 120 + 150, 320);
  const t = await until(async () => { const q = await pos(); return q && Math.abs(q.x - before.x - 150) < 8; }, 1500);
  check('2 a move shows within 160ms', t !== false && t < 160, String(t));
  // scroll under a still mouse
  const y0 = (await pos()).y;
  await a.mouse.wheel(0, 700);
  const t2 = await until(async () => { const q = await pos().catch(() => null); const edge = await b.locator('[data-testid="peer-pointer-edge"][data-name="Ann"]').count(); return edge > 0 || (q && Math.abs(q.y - y0) > 100); }, 2000);
  check('3 scrolling under a still mouse updates the other screen within 300ms', t2 !== false && t2 < 300, String(t2));
} catch (e) { console.log('crash', e.message); check('no crash', false); }
await finish();
