// 5 Nov fixes: no replacement glyphs anywhere, the full-screen outline never sits over the writing column, the folder sheet's Create / Cancel stay reachable.
import { execFileSync } from 'node:child_process';
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot({ freshPresence: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const BAD = '�';
try {
  let clean = true; let said = '';
  try { execFileSync('node', ['scripts/find-glyphs.mjs', '--check'], { encoding: 'utf8' }); } catch (e) { clean = false; said = String(e.stdout || '').slice(0, 300); }
  check('1 no replacement or garbled characters in the source files', clean, said);

  const n = (await api('POST', '/api/notes', { title: 'Pi planning', content: '# Session setup\n\nSome words in the first section.\n\n## Team boards\n\nMore words here.\n\n## Post PI\n\nEnd.', tags: [] })).note;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + '/notes');
  await page.locator('.s-notes, .np').first().waitFor({ timeout: 20000 });
  await wait(1200);
  const text = await page.evaluate(() => document.body.innerText + [...document.querySelectorAll('[placeholder],[title],[aria-label]')].map((e) => (e.getAttribute('placeholder') || '') + (e.getAttribute('title') || '') + (e.getAttribute('aria-label') || '')).join(' '));
  check('2 the notes screen shows no replacement characters', !text.includes(BAD), (text.match(/.{0,20}�.{0,10}/) || [''])[0]);

  await page.goto(base + '/notes/' + n.id);
  await page.locator('.bn-editor').waitFor({ timeout: 20000 });
  await wait(1200);
  const text2 = await page.evaluate(() => document.body.innerText);
  check('3 the open note shows no replacement characters', !text2.includes(BAD));
  check('3b the More button is an icon, not three glyphs', (await page.locator('button.s-outline.round[aria-label="More"] svg').count()) === 1);

  // outline vs writing column in full screen, every width, with and without the drawer
  await page.evaluate(() => { try { localStorage.setItem('peblo-fs-width', 'full'); } catch {} });
  await page.reload(); await page.locator('.bn-editor').waitFor({ timeout: 20000 });
  await page.locator('button[aria-label="Full screen"]').click();
  await page.locator('[data-testid="fs-bar"]').waitFor(); await wait(1000);
  const gap = () => page.evaluate(() => { const o = document.querySelector('.fsx-outline'); const e = document.querySelector('.bn-editor'); if (!o || !e || getComputedStyle(o).display === 'none') return { skip: true }; return { or: Math.round(o.getBoundingClientRect().right), el: Math.round(e.getBoundingClientRect().left) }; });
  for (const w of [1920, 1440, 1280]) {
    await page.setViewportSize({ width: w, height: 900 }); await wait(500);
    const a = await gap();
    check(`4 ${w}px, drawer open: the outline ends before the writing column starts`, a.skip || a.or <= a.el, JSON.stringify(a));
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-testid="fs-more"], [aria-label="More options"], .fsx-dots').first().click({ timeout: 3000 }).catch(() => {});
  await wait(600);
  const b = await gap();
  check('5 drawer closed: still no overlap', b.skip || b.or <= b.el, JSON.stringify(b));

  // the folder sheet over the bulk-action bar: Create and Cancel must be reachable (phone and desktop)
  for (const [w, h] of [[390, 800], [1280, 800]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(base + '/notes'); await page.locator('.np').first().waitFor({ timeout: 20000 }); await wait(1000);
    await page.locator('button[aria-label="Select notes"]').click();
    await page.locator('.np').getByText('Pi planning').first().click(); await wait(300);
    await page.locator('.np-actions button', { hasText: 'Move' }).first().click(); await wait(300);
    await page.locator('.np-sheet .np-fo.new').click(); await wait(400);
    for (const name of ['Cancel', 'Create folder']) {
      const btn = page.locator('.np-sheet.nf .np-btns button', { hasText: name });
      const hit = await btn.evaluate((el) => { const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, top: !!t && (t === el || el.contains(t)) }; });
      check(`6 ${w}px: "${name}" is on screen and not covered`, hit.inView && hit.top, JSON.stringify(hit));
    }
  }
} catch (e) { check('crash: ' + e.message, false); }
await finish();
