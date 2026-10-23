// Notes batch 5: picture crop (saved in the note), caption kept, gallery of all pictures.
import { boot, REPO } from './lib.mjs';
import path from 'path';

const { base, api, page, check, finish, token } = await boot();
const shot = (n) => page.screenshot({ path: path.join(REPO, '.shots', n + '.png') });
const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
try {
  const up = await (await fetch(base + '/api/media', { method: 'POST', headers: { 'Content-Type': 'image/webp', Authorization: `Bearer ${token}` }, body: WEBP })).json();
  const n = (await api('POST', '/api/notes', { title: 'Picture note', content: `Intro text.\n\n![A zebra at dawn](${up.url}#pw=300&ar=1)\n\nOutro.\n`, tags: ['b5'] })).note;
  await api('POST', '/api/notes', { title: 'No pictures', content: 'Just words.', tags: ['b5'] });

  await page.goto(base + `/notes/${n.id}`);
  await page.locator('.bn-editor').waitFor({ timeout: 12000 });
  await page.waitForTimeout(1200);
  const sq = await page.evaluate(() => { const i = document.querySelector('.bn-block-content[data-crop] img.bn-visual-media'); if (!i) return null; const r = i.getBoundingClientRect(); return { w: r.width, h: r.height }; });
  check('a note saved with a square crop shows it square', sq && sq.w > 50 && Math.abs(sq.w - sq.h) < 3, JSON.stringify(sq));

  const l = page.locator('.bn-visual-media-wrapper img').first();
  const b = await l.boundingBox();
  await page.mouse.click(b.x + 6, b.y + 6);
  await page.waitForTimeout(500);
  await page.locator('.bn-toolbar button[data-test="cropto16:9"]').first().click();
  await page.waitForTimeout(2500);
  const saved = (await api('GET', `/api/notes/${n.id}`)).note.content;
  check('choosing 16:9 saves the crop in the note', /ar=1\.778/.test(saved), saved);
  check('the picture caption is kept', /A zebra at dawn/.test(saved), saved);
  const r2 = await page.evaluate(() => { const i = document.querySelector('.bn-block-content[data-crop] img.bn-visual-media'); const r = i.getBoundingClientRect(); return r.width / r.height; });
  check('the picture is now wide', Math.abs(r2 - 1.778) < 0.08, String(r2));
  await page.locator('.bn-toolbar button[data-test="cropto1"]').first().isVisible().catch(() => false);

  // gallery
  await page.goto(base + '/notes');
  await page.locator('.s-note-row').first().waitFor({ timeout: 12000 });
  await page.locator('.s-notes-foot').getByRole('button', { name: 'Pictures' }).click();
  const items = page.locator('.s-gal-item');
  await items.first().waitFor({ timeout: 5000 });
  check('the gallery shows the picture from the note', (await items.count()) === 1 && /A zebra at dawn/.test(await items.first().innerText()));
  await shot('notes5-gallery');
  await items.first().click();
  await page.waitForTimeout(800);
  check('clicking a picture opens its note', page.url().endsWith(`/notes/${n.id}`));
} catch (e) { check('no crash', false, String(e).slice(0, 300)); await shot('notes5-fail').catch(() => {}); }
await finish();
