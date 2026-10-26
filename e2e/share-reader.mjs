// A reader's own tools on a share link: bookmarks, "you stopped here", and changes since the last visit.
import { boot } from './lib.mjs';

const { base, api, ctx, check, finish } = await boot();
const SHOTS = 'C:/Users/tejas/peblo-e2e';
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 150)); } return false; };
const paras = (edit) => '## Intro\n\n' + Array.from({ length: 30 }, (_, i) => `Paragraph number ${i + 1} explains one normal form in detail.${edit && i === 9 ? ' This line was changed by the owner.' : ''}`).join('\n\n');

try {
  const note = (await api('POST', '/api/notes', { title: 'Reader note', content: paras(false), tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: false, expiresInDays: 1 })).token;
  const c = await ctx.browser().newContext({ viewport: { width: 1280, height: 800 } });
  const g = await c.newPage();
  const open = async () => { await g.goto(`${base}/s/note/${tok}`); await g.locator('article .doc').waitFor({ timeout: 15000 }); await g.waitForTimeout(1500); };
  await open();
  check('first visit shows no change notice', (await g.getByTestId('changes-pill').count()) === 0);

  // bookmarks
  const line = g.locator('article .doc p', { hasText: 'Paragraph number 5 ' }).first();
  await line.scrollIntoViewIfNeeded();
  await line.hover();
  await g.keyboard.press('b');
  check('B bookmarks the line under the pointer', await until(async () => (await g.locator('[data-pb-bm="1"]').count()) === 1));
  await g.screenshot({ path: `${SHOTS}/reader-1-bookmark.png` });
  await g.keyboard.press('/');
  await g.getByTestId('dock-bookmarks').click();
  check('the bookmark is listed', (await g.getByTestId('bookmark-item').count()) === 1 && /Paragraph number 5/.test(await g.getByTestId('bookmark-item').innerText()));
  await g.locator('article').evaluate((a) => { a.scrollTop = 0; });
  await g.getByTestId('bookmark-item').click();
  check('clicking it scrolls to the line', await until(async () => (await g.locator('article').evaluate((a) => a.scrollTop)) > 100));
  await g.keyboard.press('Escape');

  // my place
  await g.locator('article').evaluate((a) => { a.scrollTop = 2000; });
  await g.waitForTimeout(1500);
  await open();
  check('coming back offers the way to where I stopped', await g.getByTestId('place-pill').isVisible());
  await g.screenshot({ path: `${SHOTS}/reader-2-place.png` });
  await g.getByTestId('place-jump').click();
  check('Jump back scrolls there', await until(async () => (await g.locator('article').evaluate((a) => a.scrollTop)) > 800));
  check('bookmark survived the reload', await until(async () => (await g.locator('[data-pb-bm="1"]').count()) === 1));

  // changes since the last visit
  await api('PATCH', `/api/notes/${note.id}`, { content: paras(true) });
  await open();
  check('changes since the last visit are announced', await g.getByTestId('changes-pill').isVisible());
  check('the pill counts one change', /1 change\b/.test(await g.getByTestId('changes-pill').innerText()), await g.getByTestId('changes-pill').innerText());
  check('the changed line is marked', (await g.locator('[data-pb-chg="1"]').count()) === 1 && /changed by the owner/.test(await g.locator('[data-pb-chg="1"]').innerText()));
  await g.screenshot({ path: `${SHOTS}/reader-3-changes.png` });
  await g.getByTestId('changes-toggle').click();
  check('marks can be hidden', await g.locator('.pb-shared.no-chg').count() === 1);
  await open();
  check('the next visit has nothing new', (await g.getByTestId('changes-pill').count()) === 0);
} catch (e) { check('reader test ran without error', false, String(e)); }
await finish();
