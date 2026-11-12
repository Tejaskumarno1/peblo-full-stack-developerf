// A share link with a password (mockup S27).
import { boot } from './lib.mjs';
const { base, api, ctx, check, finish } = await boot({ freshGuest: true });
try {
  const note = (await api('POST', '/api/notes', { title: 'Locked plan', content: '## Secret\n\nThe launch date is the 14th.', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: false })).token;
  const set = await api('POST', `/api/share/note/${note.id}/password`, { password: 'open-sesame' });
  check('1 owner can set a password', set.hasPassword === true);
  const raw = await fetch(`${base}/api/public/note/${tok}?sid=abcdefgh12345678`).then((r) => r.json());
  check('2 the server hides the content without it', raw.locked === true && !raw.content && !JSON.stringify(raw).includes('launch date'));
  const bad = await fetch(`${base}/api/public/note/${tok}/unlock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'nope' }) });
  check('3 a wrong password is refused', bad.status === 401);
  const g = await (await ctx.browser().newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errors = []; g.on('pageerror', (e) => errors.push(e.message));
  await g.goto(`${base}/s/note/${tok}`);
  await g.locator('[data-testid="lock-room"]').waitFor({ timeout: 20000 });
  check('4 the page asks for the password', await g.locator('[data-testid="lock-input"]').isVisible());
  await g.locator('[data-testid="lock-input"]').fill('wrong-one');
  await g.locator('[data-testid="lock-open"]').click();
  check('5 a wrong password shows an error', await g.locator('[data-testid="lock-error"]').waitFor({ timeout: 8000 }).then(() => true).catch(() => false));
  await g.locator('[data-testid="lock-input"]').fill('open-sesame');
  await g.locator('[data-testid="lock-open"]').click();
  await g.locator('article .doc').waitFor({ timeout: 20000 });
  check('6 the right password opens the page', /launch date/.test(await g.locator('article .doc').innerText()));
  await g.reload();
  await g.locator('article .doc').waitFor({ timeout: 20000 });
  check('7 a reload in the same tab stays unlocked', true);
  const off = await api('POST', `/api/share/note/${note.id}/password`, { password: '' });
  const open = await fetch(`${base}/api/public/note/${tok}?sid=abcdefgh12345678`).then((r) => r.json());
  check('8 removing the password opens the link again', off.hasPassword === false && !!open.content);
  check('9 no page errors', errors.length === 0, errors.join('|'));
} catch (e) { check('run ' + e.message, false); }
await finish();
