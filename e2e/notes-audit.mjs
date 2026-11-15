// Captures every Notes screen (desktop and phone) into D:/Peblo/_shots/audit for the review board.
import { boot } from './lib.mjs';
import fs from 'node:fs';
const OUT = 'D:/Peblo/_shots/audit'; fs.mkdirSync(OUT, { recursive: true });
const b = await boot({ noteLayout: 'cards' });
const { page } = b;
const snap = async (n) => { await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/${n}.png` }); console.log('shot', n); };
const tryDo = async (n, f) => { try { await f(); } catch (e) { console.log('skip', n, e.message.split('\n')[0]); } };
try {
  const mk = (title, tags, content = '') => b.api('POST', '/api/notes', { title, content, tags });
  const long = JSON.stringify([{ type: 'heading', props: { level: 2 }, content: 'Today' }, { type: 'paragraph', content: 'Three hooks for the campus series. Record on Friday and post on Saturday.' }, { type: 'checkListItem', content: 'Write hooks' }, { type: 'checkListItem', content: 'Pick a thumbnail' }, { type: 'bulletListItem', content: 'Music: soft lo-fi' }]);
  for (const [t, tags] of [['Instagram reel ideas', ['content']], ['Orbit stories', ['work']], ['Pi planning', ['work']], ['Exam revision plan', ['exams']], ['Travel list', ['travel']], ['Money tracker', ['money']], ['Peblo roadmap', ['peblo', 'work']], ['Untagged scribble', []]]) await mk(t, tags, long);
  await page.goto(`${b.base}/notes`); await page.waitForTimeout(1500);
  await snap('d01-date-cards');
  await tryDo('card-open', async () => { await page.locator('.np-card.gcard').first().click(); await snap('d02-date-card-open'); await page.locator('.s-note-row').first().click(); await snap('d03-note-editor'); });
  await tryDo('editor-slash', async () => { await page.locator('.bn-editor').click(); await page.keyboard.type('/'); await snap('d04-slash-menu'); await page.keyboard.press('Escape'); await page.keyboard.press('Backspace'); });
  await tryDo('editor-hash', async () => { await page.keyboard.type('#'); await snap('d05-hash-menu'); await page.keyboard.press('Escape'); await page.keyboard.press('Backspace'); });
  await tryDo('toolbar', async () => { await page.locator('.bn-block-content').first().dblclick(); await snap('d06-format-toolbar'); });
  await tryDo('view', async () => { await page.getByRole('button', { name: /Back to dates/ }).click().catch(() => {}); await page.getByRole('button', { name: /View options/ }).click(); await snap('d07-view-options'); await page.keyboard.press('Escape'); });
  await tryDo('tag', async () => { await page.getByRole('button', { name: /View options/ }).click(); await page.getByRole('radio', { name: 'Tag', exact: true }).click(); await page.keyboard.press('Escape'); await snap('d08-tag-cards'); await page.locator('.np-card.gcard').first().click(); await snap('d09-tag-card-open'); });
  await tryDo('select', async () => { await page.getByRole('button', { name: 'Back to tags' }).click().catch(() => {}); await page.getByRole('button', { name: 'Select notes' }).click(); await snap('d10-select-mode'); await page.getByRole('button', { name: 'Cancel' }).click(); });
  await tryDo('folders', async () => { await page.getByRole('tab', { name: /Folders/ }).click(); await snap('d11-folders'); });
  await tryDo('foldnew', async () => { await page.getByRole('button', { name: 'New folder' }).click(); await snap('d12-new-folder'); await page.keyboard.press('Escape'); });
  await tryDo('trash', async () => { await page.getByRole('button', { name: 'Trash' }).first().click(); await snap('d13-trash'); await page.getByRole('button', { name: 'Trash' }).first().click(); });
  await tryDo('tags', async () => { await page.getByRole('button', { name: 'Tags' }).first().click(); await snap('d14-tags-panel'); await page.keyboard.press('Escape'); });
  await tryDo('search', async () => { await page.getByLabel('Search notes').fill('orbit'); await snap('d15-search'); await page.getByLabel('Search notes').fill(''); });
  await tryDo('sections', async () => { await page.evaluate(() => { const o = JSON.parse(localStorage.getItem('peblo-settings') || '{}'); o.noteLayout = 'sections'; localStorage.setItem('peblo-settings', JSON.stringify(o)); }); await page.goto(`${b.base}/notes`); await page.waitForTimeout(1200); await page.getByRole('button', { name: /View options/ }).click(); await page.getByRole('radio', { name: 'Date', exact: true }).click(); await page.keyboard.press('Escape'); await snap('d16-folded-sections'); });
  await tryDo('classic', async () => { await page.evaluate(() => { const o = JSON.parse(localStorage.getItem('peblo-settings') || '{}'); o.noteLayout = 'classic'; localStorage.setItem('peblo-settings', JSON.stringify(o)); }); await page.goto(`${b.base}/notes`); await page.waitForTimeout(1200); await snap('d17-classic-list'); });
  await tryDo('settings', async () => { await page.goto(`${b.base}/settings/notes`); await snap('d18-settings-layout'); });
  await tryDo('dark', async () => { await page.evaluate(() => { const o = JSON.parse(localStorage.getItem('peblo-settings') || '{}'); o.noteLayout = 'cards'; localStorage.setItem('peblo-settings', JSON.stringify(o)); }); await page.goto(`${b.base}/notes`); await page.getByRole('button', { name: /theme/i }).click(); await snap('d19-dark-cards'); await page.getByRole('button', { name: /theme/i }).click(); });
  // phone
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto(`${b.base}/notes`); await snap('p01-phone-cards');
  await tryDo('p', async () => { await page.locator('.np-card.gcard').first().click(); await snap('p02-phone-open'); await page.locator('.s-note-row').first().click(); await snap('p03-phone-editor'); await page.getByRole('button', { name: /^Ask/ }).click(); await snap('p04-phone-ask-sheet'); await page.getByRole('button', { name: 'Close' }).click(); await page.getByRole('button', { name: 'Back to notes' }).click(); await page.getByRole('button', { name: /View options/ }).click(); await snap('p05-phone-view'); });
  await page.goto(`${b.base}/settings/notes`); await snap('p06-phone-settings');
} catch (e) { console.log('ERR', e.message); }
await b.finish();
