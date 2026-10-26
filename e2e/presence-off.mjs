// Live cursors and "edited by" hints are off by default; one switch in the live panel turns them on and it is remembered.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot({ freshPresence: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const n = (await api('POST', '/api/notes', { title: 'Presence probe', content: 'Some text' })).note;
  await api('POST', `/api/share/note/${n.id}`, { canEdit: true });
  await page.goto(base + '/notes/' + n.id);
  await page.locator('.bn-editor').waitFor({ timeout: 20000 });
  check('1 presence class is on by default (hidden)', await page.evaluate(() => document.documentElement.classList.contains('pb-presence-off')));
  check('2 stored pref is not on', (await page.evaluate(() => localStorage.getItem('peblo-pointers'))) !== 'on');
  await page.evaluate(() => { localStorage.setItem('peblo-pointers', 'on'); window.dispatchEvent(new Event('pb-pointers-pref')); });
  await wait(200);
  check('3 turning it on removes the hide class', !(await page.evaluate(() => document.documentElement.classList.contains('pb-presence-off'))));
  await page.reload(); await page.locator('.bn-editor').waitFor({ timeout: 20000 }); await wait(500);
  check('4 choice survives reload', !(await page.evaluate(() => document.documentElement.classList.contains('pb-presence-off'))));
} catch (e) { check('no exception: ' + e.message, false); }
await finish();
