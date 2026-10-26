// Live mouse pointers: the other person's pointer shows over the note, with their name, both ways, and goes away when they leave.
import { boot } from './lib.mjs';

const { base, api, page, ctx, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch { /* retry */ } await wait(150); } return false; };
const ready = async (p) => { await p.locator('.bn-editor').waitFor({ timeout: 20000 }); await p.locator('[data-testid="collab-status"]').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {}); };
const ptr = (p) => p.locator('[data-testid="peer-pointer"]');

try {
  const note = (await api('POST', '/api/notes', { title: 'Pointers', content: 'The quick brown fox\n\nSecond paragraph about cats.\n\nThird paragraph here.', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  await page.goto(base + '/notes/' + note.id);
  await ready(page);
  const guestCtx = await ctx.browser().newContext({ viewport: { width: 1100, height: 800 } });
  const g = await guestCtx.newPage();
  const errors = [];
  g.on('pageerror', (e) => errors.push(e.message));
  page.on('pageerror', (e) => errors.push(e.message));
  await g.goto(`${base}/s/note/${tok}`);
  await ready(g);

  check('0 no pointer before anyone moves', (await ptr(page).count()) === 0 && (await ptr(g).count()) === 0);

  // the guest points at the second paragraph; the owner sees it there, with the guest's name
  const gp = await g.locator('.bn-editor .bn-block-content', { hasText: 'Second paragraph' }).first().boundingBox();
  await g.mouse.move(gp.x + 40, gp.y + 5);
  await g.mouse.move(gp.x + 60, gp.y + 8, { steps: 4 });
  check('1 the owner sees the guest pointer', await until(async () => (await ptr(page).count()) === 1));
  const name = await ptr(page).first().getAttribute('data-name');
  check('2 it carries a name', !!name && name.length > 0, name);
  const op = await page.locator('.bn-editor .bn-block-content', { hasText: 'Second paragraph' }).first().boundingBox();
  await wait(300);
  const pb = await ptr(page).first().boundingBox();
  check('3 it sits on the same paragraph', pb && Math.abs(pb.y - (op.y + 8)) < 30 && pb.x > op.x, JSON.stringify({ pb, op }));

  // it follows the guest's mouse
  await g.mouse.move(gp.x + 120, gp.y + 8, { steps: 4 });
  await wait(400);
  const pb2 = await ptr(page).first().boundingBox();
  check('4 it moves when the guest moves', pb2 && pb && pb2.x > pb.x + 30, JSON.stringify({ pb, pb2 }));

  // the owner points; the guest sees it too (and not their own)
  const og = await page.locator('.bn-editor .bn-block-content', { hasText: 'Third paragraph' }).first().boundingBox();
  await page.mouse.move(og.x + 30, og.y + 6, { steps: 4 });
  check('5 the guest sees the owner pointer', await until(async () => (await ptr(g).count()) === 1));
  check('6 nobody sees their own pointer', (await ptr(g).count()) === 1 && (await ptr(page).count()) === 1);

  // leaving the note hides it
  await g.mouse.move(2, 2);
  check('7 it goes away when the guest leaves the note', await until(async () => (await ptr(page).count()) === 0));

  check('8 no crash', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('no crash', false, String(e && e.stack || e).slice(0, 500));
}
await finish();
