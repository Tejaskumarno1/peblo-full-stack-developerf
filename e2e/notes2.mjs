// Notes batch 2: full-size picture, upload notices, tables, word count, typewriter focus, text size/width, outline, duplicate, find, saved searches.
import { boot, REPO } from './lib.mjs';
import path from 'path';

const { base, api, page, check, finish, token } = await boot();
const shot = (n) => page.screenshot({ path: path.join(REPO, '.shots', n + '.png') });
const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
try {
  const up = await (await fetch(base + '/api/media', { method: 'POST', headers: { 'Content-Type': 'image/webp', Authorization: `Bearer ${token}` }, body: WEBP })).json();
  const cols = Array.from({ length: 14 }, (_, i) => `Column number ${i + 1} header`);
  const table = `| ${cols.join(' | ')} |\n| ${cols.map(() => '---').join(' | ')} |\n| ${cols.map((_, i) => `a value that is fairly long ${i}`).join(' | ')} |`;
  const content = `# First heading\n\nThe roadmap is the plan for the quarter.\n\n![pic](${up.url}#pw=200)\n\n## Second heading\n\nMore text about the roadmap here, and a roadmap again.\n\n${table}\n`;
  const N = (await api('POST', '/api/notes', { title: 'Batch two', content, tags: ['b2'] })).note;
  await page.goto(base + `/notes/${N.id}`);
  await page.locator('.bn-editor').waitFor({ timeout: 12000 });
  await page.waitForTimeout(1000);

  // word count
  const stats = await page.locator('.s-note-stats').textContent();
  check('the note shows words, characters and reading time', /\d+ words? · \d+ characters · \d+ min read/.test(stats || ''), stats);
  check('the count ignores the picture address', Number((stats.match(/(\d+) characters/) || [])[1]) < content.length - 25, stats);

  // outline card
  const items = await page.locator('.s-outline-card .s-outl-item').allTextContents();
  check('the side panel lists the headings as an outline', items.length === 2 && /First heading/.test(items[0]), items.join('|'));

  // table does not break the page
  const tbl = await page.evaluate(() => {
    const el = document.querySelector('.bn-block-content[data-content-type="table"]');
    if (!el) return null;
    const wrap = el.closest('.tableWrapper') || el;
    return { ox: getComputedStyle(wrap).overflowX, pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 2, w: wrap.scrollWidth, c: wrap.clientWidth };
  });
  check('a wide table scrolls inside the note instead of widening the page', tbl && !tbl.pageOverflow && (tbl.ox === 'auto' || tbl.ox === 'scroll' || tbl.w <= tbl.c + 1), JSON.stringify(tbl));

  // full-size picture
  const pic = page.locator('.bn-visual-media-wrapper img').first();
  await pic.scrollIntoViewIfNeeded();
  await pic.dblclick();
  check('double-clicking a picture opens it full size', await page.locator('.pb-lightbox img').waitFor({ timeout: 3000 }).then(() => true).catch(() => false));
  await shot('notes2-lightbox');
  await page.keyboard.press('Escape');
  check('Esc closes the full-size picture', await page.locator('.pb-lightbox').count() === 0);

  // upload notices
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pb-upload', { detail: { state: 'error', message: 'big.png is still over 6 MB after shrinking' } })));
  check('a failed upload says why', /over 6 MB/.test((await page.locator('.pb-notice.error').textContent().catch(() => '')) || ''));

  // find in note
  await page.locator('.bn-editor').click();
  await page.keyboard.press('Control+f');
  check('Ctrl+F opens a find bar inside the note', await page.locator('.pb-find input').waitFor({ timeout: 3000 }).then(() => true).catch(() => false));
  await page.locator('.pb-find input').fill('roadmap');
  await page.waitForTimeout(300);
  const fn = await page.locator('.pb-find .n').textContent();
  check('find counts the matches', /1 of 3/.test(fn || ''), fn);
  const hl = await page.evaluate(() => CSS.highlights.get('pb-find')?.size ?? 0);
  check('matches are highlighted in the text', hl === 3, hl);
  await page.keyboard.press('Enter');
  check('Enter goes to the next match', /2 of 3/.test((await page.locator('.pb-find .n').textContent()) || ''));
  await shot('notes2-find');
  await page.keyboard.press('Escape');
  check('Esc closes find and clears the highlights', (await page.locator('.pb-find').count()) === 0 && (await page.evaluate(() => CSS.highlights.size)) === 0);

  // menu: text size, width, typewriter, duplicate
  const menu = async () => { if (!(await page.locator('.s-note-bar .s-menu').count())) await page.locator('.s-note-bar .s-menu-wrap > button').click(); };
  await menu();
  await page.locator('.s-menu button', { hasText: 'Text size' }).click();
  check('Text size changes the note text size', (await page.locator('.s-note-body').getAttribute('data-font')) === 'l');
  await menu();
  await page.locator('.s-menu button', { hasText: 'Page width' }).click();
  check('Page width can be set to narrow', (await page.locator('.s-notes').getAttribute('data-width')) === 'narrow');
  const bw = await page.evaluate(() => document.querySelector('.s-note-body .block-editor-container').getBoundingClientRect().width);
  check('a narrow page limits the writing width', bw <= 690, bw);
  await menu();
  await page.locator('.s-menu button', { hasText: 'Typewriter focus' }).click();
  await page.locator('.bn-block-content[data-content-type="paragraph"]').first().click();
  await page.waitForTimeout(500);
  const ops = await page.evaluate(() => { const o = [...document.querySelectorAll('.pb-focus .bn-block-outer')].map((el) => getComputedStyle(el).opacity); return { dim: o.filter((x) => Number(x) < 0.5).length, bright: o.filter((x) => Number(x) === 1).length }; });
  check('typewriter focus keeps the current block bright and fades the rest', ops.dim > 0 && ops.bright > 0, JSON.stringify(ops));
  await shot('notes2-typewriter');
  await menu();
  await page.locator('.s-menu button', { hasText: 'Typewriter focus' }).click();
  await menu();
  await page.locator('.s-menu button', { hasText: 'Duplicate note' }).click();
  await page.waitForURL((u) => !u.pathname.endsWith(N.id), { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);
  const titles = await page.locator('.s-note-row .t').allTextContents();
  check('Duplicate note makes a copy and opens it', titles.some((t) => /Copy of Batch two/.test(t)) && !page.url().endsWith(N.id), titles.join('|'));
  const copy = (await api('GET', '/api/notes?search=Copy of Batch two')).notes.find((n) => /^Copy of/.test(n.title));
  check('the copy has the same text and tags', copy && copy.content.includes('Second heading') && (copy.tags || []).includes('b2'));

  // saved searches
  await page.locator('.s-nsearch input').fill('roadmap');
  await page.waitForTimeout(700);
  await page.locator('.s-nsearch button.save').click();
  check('a search can be saved', (await page.locator('.s-saved-searches span').count()) === 1);
  await page.locator('.s-nsearch input').fill('');
  await page.locator('.s-saved-searches span button').first().click();
  check('clicking a saved search runs it again', (await page.locator('.s-nsearch input').inputValue()) === 'roadmap');
  await page.reload();
  await page.locator('.s-saved-searches').waitFor({ timeout: 8000 }).catch(() => {});
  check('saved searches are still there after reload', (await page.locator('.s-saved-searches span').count()) === 1);
} catch (e) {
  console.log('FAIL  test crashed:', e.message);
  try { await shot('notes2-crash'); } catch {}
  process.exitCode = 1;
}
await finish();
