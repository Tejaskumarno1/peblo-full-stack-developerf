// River phase 1: Archive/Trash actions, clickable tags, more tags, phone layout, callout styling.
import { boot, REPO } from './lib.mjs';
import path from 'path';

const { base, api, page, check, finish } = await boot();
const shot = (n) => page.screenshot({ path: path.join(REPO, '.shots', n + '.png') });
const tagsOf = (i) => ['t' + i];
try {
  await page.goto(base + '/');
  await page.evaluate(() => localStorage.setItem('peblo-style', 'river'));

  const mk = async (title, extra = {}) => (await api('POST', '/api/notes', { title, content: 'body of ' + title, tags: ['rv'], ...extra })).note;
  const keep = await mk('Keeper', { content: 'A callout:\n\n> 💡 remember this', tags: ['rv', 'plan'] });
  const arch = await mk('To Archive');
  const t1 = await mk('Trash One');
  const t2 = await mk('Trash Two');
  const t3 = await mk('Trash Three');
  await api('POST', `/api/notes/${arch.id}/archive`);
  for (const n of [t1, t2, t3]) await api('DELETE', `/api/notes/${n.id}`);
  for (let i = 0; i < 12; i++) await mk('Tagged ' + i, { tags: tagsOf(i) });

  // Archive: unarchive from the list
  await page.goto(base + '/notes');
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByText('To Archive').first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Unarchive' }).first().click();
  await page.waitForTimeout(1200);
  check('archive: unarchive removes the row', (await page.getByText('To Archive').count()) === 0);

  // Trash: restore, delete forever, empty
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await page.getByText('Trash One').first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Restore' }).first().click();
  await page.waitForTimeout(1200);
  check('trash: restore removes the row', (await page.getByRole('button', { name: 'Restore' }).count()) === 2);
  await page.getByRole('button', { name: 'Delete forever' }).first().click();
  await page.waitForTimeout(1200);
  check('trash: delete forever removes one', (await page.getByRole('button', { name: 'Delete forever' }).count()) === 1);
  await page.getByRole('button', { name: 'Empty Trash' }).click();
  await page.waitForTimeout(1500);
  check('trash: empty trash clears the list', await page.getByText('The Trash is empty.').isVisible());
  await shot('river1-trash');

  // More tags
  await page.getByRole('button', { name: 'All', exact: true }).click();
  const more = page.getByRole('button', { name: /More tags/ });
  check('tags: a more tags control shows when there are over 10', await more.waitFor({ timeout: 6000 }).then(() => true).catch(() => false));
  await more.click();
  check('tags: all tags show after expanding', (await page.locator('.r-filters button', { hasText: '#t11' }).count()) === 1);

  // Clickable tag chips in a note
  await page.goto(base + `/notes/${keep.id}`);
  await page.locator('.bn-editor').waitFor({ timeout: 12000 });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Show notes tagged #plan' }).click();
  await page.waitForTimeout(1500);
  const body = await page.locator('body').innerText();
  check('tag chip: opens the list filtered to that tag', /#plan/.test(body) && /Keeper/.test(body) && !/Tagged 3/.test(body), body.slice(0, 200));

  // Callout styling
  await page.goto(base + `/notes/${keep.id}`);
  await page.locator('[data-callout]').first().waitFor({ timeout: 12000 });
  const co = await page.evaluate(() => {
    const el = document.querySelector('.r-body [data-callout]');
    const bq = el.querySelector('blockquote');
    return { left: getComputedStyle(el).borderLeftWidth, bq: bq ? getComputedStyle(bq).borderLeftWidth : 'none' };
  });
  check('callout: a single left bar', co.left === '4px' && (co.bq === '0px' || co.bq === 'none'), JSON.stringify(co));

  // Phone width
  await page.setViewportSize({ width: 420, height: 800 });
  await page.waitForTimeout(600);
  const over = await page.evaluate(() => {
    const r = document.querySelector('.r-sheet').getBoundingClientRect();
    return { right: r.right, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
  });
  check('phone: note page fits 420px', over.right <= 421 && over.sw <= over.cw + 1, JSON.stringify(over));
  await shot('river1-phone-note');
  await page.goto(base + '/notes');
  await page.locator('#r-note-search').waitFor({ timeout: 12000 });
  await page.waitForTimeout(600);
  const over2 = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, list: document.querySelector('.r-list').getBoundingClientRect().right }));
  check('phone: notes list fits 420px', over2.list <= 421 && over2.sw <= over2.cw + 1, JSON.stringify(over2));
  await shot('river1-phone-list');
} catch (e) { check('no crash', false, String(e).slice(0, 300)); await shot('river1-fail').catch(() => {}); }
await finish();
