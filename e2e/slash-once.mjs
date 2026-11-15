// The slash menu lists each item once and each group heading once, with and without a query.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const read = () => page.evaluate(() => ({
  titles: [...document.querySelectorAll('.bn-suggestion-menu-item .bn-mt-suggestion-menu-item-title')].map((e) => e.textContent.trim()),
  labels: [...document.querySelectorAll('.bn-suggestion-menu-label')].map((e) => e.textContent.trim()),
  menus: document.querySelectorAll('.bn-suggestion-menu').length,
}));
try {
  const n = (await api('POST', '/api/notes', { title: 'Slash probe', content: 'Hello' })).note;
  await page.goto(base + '/notes/' + n.id);
  await page.locator('.bn-editor').waitFor({ timeout: 20000 });
  await wait(1500);
  await page.locator('.bn-block-content').first().click();
  await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await page.locator('.bn-suggestion-menu').waitFor({ timeout: 5000 });
  await wait(600);
  let r = await read();
  const dup = (a) => a.filter((x, i) => a.indexOf(x) !== i);
  check('one menu on screen', r.menus === 1, r.menus);
  check('no item appears twice', dup(r.titles).length === 0, dup(r.titles).join(', '));
  check('no group heading appears twice', dup(r.labels).length === 0, r.labels.join(' | '));
  check('Media heading appears once', r.labels.filter((l) => /^media$/i.test(l)).length === 1, r.labels.join(' | '));
  check('Dictate listed once', r.titles.filter((t) => t === 'Dictate').length === 1);
  console.log('items', r.titles.length, 'labels', r.labels.join(' | '));
  await page.keyboard.type('d'); await wait(500);
  r = await read();
  check('typing narrows the list', r.titles.length > 0 && r.titles.length < 49, r.titles.length);
  check('narrowed list has no duplicates', dup(r.titles).length === 0 && dup(r.labels).length === 0, r.titles.join(', '));
  // recent picks move to the top and are not listed again below
  await page.evaluate(() => localStorage.setItem('peblo-slash-recent', JSON.stringify(['Pictures', 'Bullet List', 'Presentation'])));
  await page.keyboard.press('Escape'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await wait(300);
  await page.keyboard.type('/');
  await page.locator('.bn-suggestion-menu').waitFor({ timeout: 5000 }); await wait(600);
  r = await read();
  check('with recent picks no item appears twice', dup(r.titles).length === 0, dup(r.titles).join(', '));
  check('Recent heading once, first', r.labels[0] === 'Recent' && r.labels.filter((l) => l === 'Recent').length === 1, r.labels.join(' | '));
} catch (e) { console.log('ERROR', e.stack || e); check('no exception', false, e.message); }
await finish();
