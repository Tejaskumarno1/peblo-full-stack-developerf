// Notes: typing # offers tags (existing and new), picking one writes it in the text and adds it to the note. Toolbar and menus share the page palette.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  await api('POST', '/api/notes', { title: 'Exam prep', content: 'x', tags: ['exams'] });
  const made = await api('POST', '/api/notes', { title: 'Plan', content: '' });
  const id = made?.note?.id || made?.id;
  await page.goto(base + '/notes/' + id);
  const ed = page.locator('.bn-editor').first();
  await ed.waitFor({ timeout: 10000 });
  await ed.click();
  await page.keyboard.type('Revise #ex');
  const menu = page.locator('.bn-suggestion-menu');
  await menu.waitFor({ timeout: 5000 });
  await wait(700);
  const txt = await menu.innerText();
  check('# opens a tag menu with the matching tag and a create row', /#exams/.test(txt) && /Create tag #ex/.test(txt), txt.slice(0, 200));
  await page.screenshot({ path: 'D:/Peblo/_shots/notes-hash.png' });
  await page.keyboard.press('Enter');
  await wait(900);
  check('picking writes the tag in the text', /#exams/.test(await ed.innerText()));
  const n = await api('GET', '/api/notes/' + id);
  const tags = (n.note || n).tags || [];
  check('the tag is added to the note', tags.includes('exams'), JSON.stringify(tags));
  await page.keyboard.type(' and #zz');
  await menu.waitFor({ timeout: 5000 });
  check('a new tag can be created', /Create tag #zz/.test(await menu.innerText()));
  await page.keyboard.press('Escape');
  // toolbar palette: select text, the bar is on the card surface and the block menu is not grey
  await page.keyboard.press('Home'); await page.keyboard.down('Shift'); await page.keyboard.press('End'); await page.keyboard.up('Shift'); await wait(600);
  const bar = page.locator('.bn-toolbar, .bn-formatting-toolbar').first();
  await bar.waitFor({ timeout: 5000 });
  const bg = await bar.evaluate((e) => getComputedStyle(e).backgroundColor);
  check('toolbar sits on the white card surface', /rgb\(255, 255, 255\)/.test(bg), bg);
  await page.screenshot({ path: 'D:/Peblo/_shots/notes-toolbar.png' });
} catch (e) { check('no crash', false, String(e).slice(0, 300)); }
await finish();
