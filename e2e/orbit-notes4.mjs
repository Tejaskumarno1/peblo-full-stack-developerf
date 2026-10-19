// Round 10: Orbit note view: templates, find and replace, outline.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const go = async (path) => {
  await page.goto(base + '/tasks');
  await page.evaluate(() => { localStorage.setItem('peblo-style', 'orbit'); localStorage.setItem('peblo-orbit-help-seen', '1'); });
  await page.goto(base + path);
  await page.waitForTimeout(1500);
};
const get = async (id) => { const r = await api('GET', '/api/notes'); return (r.notes || r).find((x) => x.id === id); };
try {
  const e = (await api('POST', '/api/notes', { title: '', content: '', tags: ['dbms'] })).note;
  await go('/notes/' + e.id);
  check('an empty note offers templates', (await page.getByRole('group', { name: 'Start from a template' }).count()) === 1);
  await page.getByRole('button', { name: 'Meeting', exact: true }).click();
  await page.waitForTimeout(800);
  check('picking a template fills the note', (await page.locator('.o-body').innerText()).includes('Action items'));
  check('..and gives it a title', (await page.locator('#o-note-title').inputValue()).startsWith('Meeting'));
  await page.waitForTimeout(2500);
  check('..and the template is saved', /Action items/.test((await get(e.id))?.content || ''));
  check('templates disappear once the note has text', (await page.getByRole('group', { name: 'Start from a template' }).count()) === 0);
  check('a note with several headings shows an outline', (await page.getByRole('navigation', { name: 'Outline' }).getByRole('button').count()) >= 3);

  const n = (await api('POST', '/api/notes', { title: 'Joins', content: '# Joins\n\nAn inner join keeps matches. The inner join is common.\n\n## Outer\n\nOuter join keeps all rows.', tags: ['dbms'] })).note;
  await go('/notes/' + n.id);
  const items = await page.getByRole('navigation', { name: 'Outline' }).getByRole('button').allInnerTexts();
  check('the outline lists the headings', items.join('|') === 'Joins|Outer', items.join('|'));
  await page.getByRole('navigation', { name: 'Outline' }).getByRole('button', { name: 'Outer' }).click();
  check('clicking an outline item does not break the page', await page.locator('.o-body').isVisible());

  await page.locator('.o-title-input').click();
  await page.keyboard.press('Control+f');
  check('Ctrl+F opens find and replace', (await page.getByRole('search').count()) === 1);
  await page.getByRole('button', { name: 'Close find' }).click();
  check('..and it can be closed', (await page.getByRole('search').count()) === 0);
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Find and replace' }).click();
  await page.getByLabel('Find', { exact: true }).fill('inner join');
  await page.waitForTimeout(300);
  check('find counts matches', (await page.getByRole('search').innerText()).includes('2 matches'));
  await page.getByLabel('Match case').check();
  await page.getByLabel('Find', { exact: true }).fill('Inner join');
  await page.waitForTimeout(300);
  check('..and can match case', (await page.getByRole('search').innerText()).includes('0 matches'));
  await page.getByLabel('Match case').uncheck();
  await page.getByLabel('Find', { exact: true }).fill('inner join');
  await page.getByLabel('Replace with').fill('left join');
  await page.getByRole('button', { name: 'Replace all' }).click();
  await page.waitForTimeout(400);
  check('..and tells how many were replaced', (await page.getByText('Replaced 2 matches').count()) === 1);
  await page.waitForTimeout(2500);
  const saved = (await get(n.id))?.content || '';
  check('replace all rewrites the note', /left join/.test(saved) && !/inner join/i.test(saved), saved);
  check('..and the editor shows the new text', (await page.locator('.o-body').innerText()).includes('left join'));
} catch (e) {
  check('script ran to the end', false, String(e).slice(0, 300));
}
await finish();
