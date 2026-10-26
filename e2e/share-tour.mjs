// First-visit quick tour on a share link: shown once, skippable, never again.
import { boot } from './lib.mjs';

const { base, api, ctx, check, finish } = await boot();
const SHOTS = 'C:/Users/tejas/peblo-e2e';
try {
  const note = (await api('POST', '/api/notes', { title: 'Tour note', content: '# Tour\n\nHello there', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: false })).token;
  const c = await ctx.browser().newContext({ viewport: { width: 1280, height: 800 } });
  const g = await c.newPage();
  await g.goto(`${base}/s/note/${tok}`);
  const tour = g.getByTestId('guest-tour');
  await tour.waitFor({ timeout: 8000 });
  check('a first visit shows the tour', /1 of 3/.test(await tour.innerText()));
  await g.screenshot({ path: `${SHOTS}/tour-1.png` });
  await g.getByTestId('tour-next').click();
  check('Next moves to step 2', /2 of 3/.test(await tour.innerText()));
  await g.getByTestId('tour-next').click();
  check('last step says Got it', /Got it/.test(await g.getByTestId('tour-next').innerText()));
  await g.getByTestId('tour-next').click();
  check('finishing closes the tour', (await tour.count()) === 0);
  await g.reload();
  await g.locator('article .doc').waitFor({ timeout: 15000 });
  await g.waitForTimeout(2200);
  check('it does not come back', (await g.getByTestId('guest-tour').count()) === 0);
  const c2 = await ctx.browser().newContext({ viewport: { width: 390, height: 780 } });
  const p = await c2.newPage();
  await p.goto(`${base}/s/note/${tok}`);
  await p.getByTestId('guest-tour').waitFor({ timeout: 8000 });
  await p.getByTestId('tour-skip').click();
  check('Skip closes it on a phone', (await p.getByTestId('guest-tour').count()) === 0);
  await p.reload();
  await p.waitForTimeout(2200);
  check('skipping is remembered', (await p.getByTestId('guest-tour').count()) === 0);
} catch (e) { check('tour test ran without error', false, String(e)); }
await finish();
