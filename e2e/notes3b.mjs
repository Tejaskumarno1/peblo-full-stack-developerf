// Notes batch 2/3 in the River and Orbit styles: ranked search, share dialog, callouts, slash templates, mentions.
import { boot, REPO } from './lib.mjs';
import path from 'path';

const { base, api, page, check, finish } = await boot();
const shot = (n) => page.screenshot({ path: path.join(REPO, '.shots', n + '.png') });
try {
  const zebra = (await api('POST', '/api/notes', { title: 'Zebra Project', content: 'Stripes and planning for the big project.\n\n> 💡 remember the stripes', tags: ['b3'] })).note;
  await api('POST', '/api/notes', { title: 'Giraffe', content: 'Tall animals.', tags: ['b3'] });
  await api('POST', '/api/notes', { title: 'Mentioner', content: 'We discussed the zebra project over lunch.', tags: ['b3'] });

  for (const style of ['river', 'orbit']) {
    await page.goto(base + '/');
    await page.evaluate((s) => localStorage.setItem('peblo-style', s), style);
    await page.goto(base + '/notes');
    const box = page.locator(style === 'river' ? '#r-note-search' : '#o-note-search');
    await box.waitFor({ timeout: 12000 });
    await box.fill('project zebra'); // words in another order: the old substring filter found nothing
    await page.waitForTimeout(1200);
    const body = await page.locator('body').innerText();
    check(`${style}: search finds words in any order`, /Zebra Project/.test(body) && (style === 'orbit' ? /2 notes match/.test(body) : !/Giraffe/.test(body)), body.slice(0, 160));
    await box.fill('');

    await page.goto(base + `/notes/${zebra.id}`);
    await page.locator('.bn-editor').waitFor({ timeout: 12000 });
    await page.waitForTimeout(800);
    check(`${style}: callouts show`, (await page.locator('[data-callout="tip"]').count()) === 1);
    check(`${style}: unlinked mentions are offered`, await page.locator('.peblo-mentions').waitFor({ timeout: 6000 }).then(() => true).catch(() => false));
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: /Share link/ }).click();
    const dlg = page.getByRole('dialog', { name: /share/i });
    check(`${style}: the share dialog opens`, await dlg.waitFor({ timeout: 5000 }).then(() => true).catch(() => false));
    await shot(`notes3b-${style}-share`);
    const vis = await dlg.evaluate((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { w: r.width, bg: cs.backgroundColor }; }).catch(() => ({}));
    check(`${style}: the share dialog is styled`, vis.w > 250 && vis.bg !== 'rgba(0, 0, 0, 0)', JSON.stringify(vis));
    await page.keyboard.press('Escape');
  }
} catch (e) { check('no crash', false, String(e).slice(0, 300)); await shot('notes3b-fail').catch(() => {}); }
await finish();
