// Listen bar and translate menu (mockup S26).
import { boot } from './lib.mjs';
const { base, api, ctx, check, finish } = await boot({ freshGuest: true });
try {
  const note = (await api('POST', '/api/notes', { title: 'Listen page', content: '# One\n\nFirst paragraph with some words in it.\n\n# Two\n\nSecond paragraph with more words.', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: false })).token;
  const gc = await ctx.browser().newContext({ viewport: { width: 1366, height: 800 } });
  const g = await gc.newPage();
  const errors = []; g.on('pageerror', (e) => errors.push(e.message));
  await g.goto(`${base}/s/note/${tok}`);
  await g.locator('[data-testid="join-anon"]').click({ timeout: 8000 }).catch(() => {});
  await g.locator('[data-testid="tt-listen"]').waitFor({ timeout: 20000 });
  await g.locator('[data-testid="tt-listen"]').click();
  check('1 listen bar opens', await g.locator('[data-testid="listen-bar"]').isVisible());
  check('2 it shows play controls, speed and time', await g.locator('[data-testid="lb-play"]').isVisible() && /1x|1.25x/.test(await g.locator('[data-testid="lb-rate"]').innerText()));
  await g.locator('[data-testid="lb-rate"]').click();
  check('3 speed changes', /1.25x/.test(await g.locator('[data-testid="lb-rate"]').innerText()));
  await g.locator('[data-testid="lb-close"]').click();
  check('4 closing stops listening', (await g.locator('[data-testid="listen-bar"]').count()) === 0);
  await g.locator('[data-testid="tt-translate"]').click();
  check('5 translate menu lists the languages', await g.locator('[data-testid="tr-menu"]').isVisible() && await g.locator('[data-testid="tr-hi"]').isVisible() && await g.locator('[data-testid="tr-te"]').isVisible());
  await g.locator('[data-testid="tr-original"]').click();
  check('6 original closes the menu', (await g.locator('[data-testid="tr-menu"]').count()) === 0);
  const r = await g.evaluate(async (t) => { const x = await fetch(`/api/public/note/${t}/translate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: 'abcdefghijklmnop', lang: 'xx' }) }); return x.status; }, tok);
  check('7 an unknown language is refused', r === 400);
  check('8 no page errors', errors.length === 0, errors.join('|'));
} catch (e) { check('run ' + e.message, false); }
await finish();
