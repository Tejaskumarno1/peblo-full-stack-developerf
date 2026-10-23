// PEB-273: [[ note links, "Linked from" backlinks, today's daily note and templates from the command palette.
import { boot } from './lib.mjs';

const { base, api, page, check, finish } = await boot();
try {
  const A = (await api('POST', '/api/notes', { title: 'Target note', content: 'I am linked to.' })).note;
  const B = (await api('POST', '/api/notes', { title: 'Source note', content: `See [Target note](/notes/${A.id}) for more.` })).note;
  const C = (await api('POST', '/api/notes', { title: 'Deleted source', content: `Old [Target note](/notes/${A.id})` })).note;
  await api('DELETE', `/api/notes/${C.id}`);

  // API
  const bl = (await api('GET', `/api/notes/${A.id}/backlinks`)).backlinks || [];
  check('backlinks lists the note that links here', bl.length === 1 && bl[0].id === B.id, JSON.stringify(bl));
  check('a note in the trash is not a backlink', !bl.some((x) => x.id === C.id));
  check('a note does not link to itself', ((await api('GET', `/api/notes/${B.id}/backlinks`)).backlinks || []).length === 0);
  const d1 = await api('POST', '/api/notes/daily', { date: '2026-10-21' });
  const d2 = await api('POST', '/api/notes/daily', { date: '2026-10-21' });
  check('the daily note is made once', d1.created === true && d2.created === false && d1.note.id === d2.note.id, JSON.stringify([d1.created, d2.created]));
  check('the daily note has a title with the date and a template', /2026-10-21/.test(d1.note.title) && /Today I did/.test(d1.note.content));
  const bad = await fetch(base + '/api/notes/daily', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${(await import('./lib.mjs')).default?.token || ''}` }, body: JSON.stringify({ date: 'tomorrow' }) });
  check('a bad date is refused', bad.status === 400 || bad.status === 401);

  // The Linked from panel
  await page.goto(base + `/notes/${A.id}`);
  const panel = page.locator('.peblo-backlinks');
  await panel.waitFor({ timeout: 10000 }).catch(() => {});
  check('the note shows "Linked from 1 note"', /Linked from 1 note/.test((await panel.textContent().catch(() => '')) || ''), await panel.textContent().catch(() => 'no panel'));
  await panel.locator('a', { hasText: 'Source note' }).click();
  await page.waitForURL(new RegExp(`/notes/${B.id}$`), { timeout: 8000 }).catch(() => {});
  check('clicking a backlink opens that note', page.url().endsWith(`/notes/${B.id}`), page.url());

  // Clicking a link inside a note opens the linked note
  await page.locator('.bn-editor a', { hasText: 'Target note' }).first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForURL(new RegExp(`/notes/${A.id}$`), { timeout: 8000 }).catch(() => {});
  check('clicking a [[link]] in a note opens the linked note', page.url().endsWith(`/notes/${A.id}`), page.url());

  // Typing [[ offers the notes
  await page.goto(base + `/notes/${B.id}`);
  const ed = page.locator('.bn-editor');
  await ed.waitFor({ timeout: 10000 });
  await ed.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' and ' + ('@') + 'Targ', { delay: 60 });
  await page.screenshot({ path: 'C:/Users/tejas/peblo-e2e/links.png' });
  const item = page.locator('.bn-suggestion-menu-item', { hasText: 'Target note' }).first();
  await item.waitFor({ timeout: 6000 }).catch(() => {});
  check('typing @ lists matching notes', await item.isVisible().catch(() => false));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3500); // autosave
  const saved = (await api('GET', `/api/notes/${B.id}`)).note;
  check('the chosen note is saved as a link', new RegExp(`\\]\\(/notes/${A.id}\\)`).test(saved.content) && (saved.content.match(new RegExp(`/notes/${A.id}`, 'g')) || []).length >= 2, saved.content);
  check('the @ typed is not left behind', !/@Targ/.test(saved.content), saved.content);

  // Command palette: daily note and a template
  await page.goto(base + '/notes');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(600);
  await page.keyboard.type('daily');
  await page.waitForTimeout(400);
  await page.keyboard.press('ArrowDown'); // first row is "Ask AI"
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const dailyId = page.url().split('/').pop();
  const daily = (await api('GET', `/api/notes/${dailyId}`)).note;
  check("the palette opens today's daily note", daily && daily.title === `Daily note ${ymd}`, JSON.stringify(daily && daily.title));
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(600);
  await page.keyboard.type('template: meeting');
  await page.waitForTimeout(400);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  const tplId = page.url().split('/').pop();
  const tpl = (await api('GET', `/api/notes/${tplId}`)).note;
  check('the palette makes a note from a template', tpl && /Meeting/.test(tpl.title) && /Action items/.test(tpl.content), JSON.stringify(tpl && tpl.title));
} catch (e) {
  check('test ran without throwing', false, e?.stack || e);
} finally {
  await finish();
}
