// Request edit access (mockup S28) and the end-of-page reactions strip.
import { boot } from './lib.mjs';
const { base, api, ctx, check, finish } = await boot({ freshGuest: true });
try {
  const note = (await api('POST', '/api/notes', { title: 'Ask page', content: '# Hello\n\nSome words here ' + 'x '.repeat(40), tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: false })).token;
  const gc = await ctx.browser().newContext({ viewport: { width: 1366, height: 800 } });
  const g = await gc.newPage();
  const errors = []; g.on('pageerror', (e) => errors.push(e.message));
  await g.goto(`${base}/s/note/${tok}`);
  await g.locator('[data-testid="join-anon"]').click({ timeout: 8000 }).catch(() => {});
  await g.locator('[data-testid="request-edit"]').scrollIntoViewIfNeeded({ timeout: 20000 });
  check('1 viewer sees the end-of-page strip with request access', await g.locator('[data-testid="endcap"]').isVisible());
  await g.locator('[data-testid="end-react-like"]').click();
  await g.waitForTimeout(400);
  check('2 reaction on the strip counts', /1/.test(await g.locator('[data-testid="end-react-like"]').innerText()));
  await g.locator('[data-testid="request-edit"]').click();
  await g.locator('[data-testid="er-msg"]').fill('I would like to fix two numbers.');
  await g.locator('[data-testid="er-send"]').click();
  check('3 request is sent', await g.locator('[data-testid="edit-request-sent"]').waitFor({ timeout: 8000 }).then(() => true, () => false));
  const st = await api('GET', `/api/share/note/${note.id}/live`);
  check('4 the owner is told with the message', st.editRequest?.message?.includes('fix two numbers'), JSON.stringify(st.editRequest));
  await api('POST', `/api/share/note/${note.id}`, { edit: true });
  const st2 = await api('GET', `/api/share/note/${note.id}/live`);
  check('5 allowing edit clears the request', !st2.editRequest);
  check('6 no page errors', errors.length === 0, errors.join('|'));
} catch (e) { check('run ' + e.message, false); }
await finish();
