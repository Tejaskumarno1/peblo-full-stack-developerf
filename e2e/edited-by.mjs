// "Priya updated this note": toast, review dialog, keep my version, small-edit switch.
import { boot } from './lib.mjs';

const { base, api, page, ctx, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch { /* retry */ } await wait(150); } return false; };
const ready = async (p) => { await p.locator('.bn-editor').waitFor({ timeout: 20000 }); await p.locator('[data-testid="collab-status"]').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {}); };

try {
  const note = (await api('POST', '/api/notes', { title: 'Edited by', content: '# Trip plan\n\nWe leave on Friday morning.\n\nPack light.', tags: [] })).note;
  const tok = (await api('POST', `/api/share/note/${note.id}`, { edit: true })).token;
  await page.goto(base + '/notes/' + note.id);
  await ready(page);
  const c = await ctx.browser().newContext({ viewport: { width: 1200, height: 800 } });
  await c.addInitScript(() => { try { localStorage.setItem('peblo-guest-name', 'Priya'); localStorage.setItem('peblo-guest-joined', '1'); } catch { /* ignore */ } });
  const g = await c.newPage();
  await g.goto(`${base}/s/note/${tok}`);
  await ready(g);
  await wait(3500);

  check('0 no toast before anyone edits', (await page.locator('[data-testid="edited-toast"]').count()) === 0);
  const para = g.locator('.bn-editor .bn-block-content', { hasText: 'Pack light' }).first();
  await para.click();
  await g.keyboard.press('End');
  await g.keyboard.type(' Bring a rain jacket and sunscreen.', { delay: 15 });
  check('1 the owner sees the toast', await until(async () => (await page.locator('[data-testid="edited-toast"]').count()) === 1, 15000));
  const t = await page.locator('[data-testid="edited-toast"]').innerText();
  check('2 it names who edited', /Priya updated this note/.test(t), t);
  check('3 it counts added words', /\d+ added, \d+ removed/.test(t) && !/0 added/.test(t), t);
  check('4 BEFORE and NOW shown', /BEFORE/.test(t) && /NOW/.test(t) && /rain jacket/.test(t), t);

  await page.locator('[data-testid="eb-compare"]').click();
  check('5 the review dialog opens', await page.locator('[data-testid="edited-dialog"]').isVisible());
  check('6 now pane shows the new words', /rain jacket/.test(await page.locator('[data-testid="eb-now"]').innerText()));
  check('7 before pane lacks them', !/rain jacket/.test(await page.locator('[data-testid="eb-before"]').innerText()));
  await page.locator('[data-testid="eb-opt-compare"]').click();
  await page.locator('[data-testid="eb-go"]').click();
  check('8 compare in detail opens the compare box', await until(async () => (await page.locator('[data-testid="compare-box"]').count()) === 1, 6000));
  check('9 labelled as edited by Priya', /Edited by Priya/.test(await page.locator('[data-testid="compare-box"]').innerText()));
  await page.locator('[data-testid="cb-close"]').click();
  check('10 closing returns to the toast', await page.locator('[data-testid="edited-toast"]').isVisible());

  await page.locator('[data-testid="eb-keep"]').click();
  check('11 keep my version saves a note', await until(async () => {
    const r = await api('GET', '/api/notes');
    return (r.notes || []).some((n) => /my version/.test(n.title || ''));
  }, 6000));
  check('12 the toast is gone after keeping', await until(async () => (await page.locator('[data-testid="edited-toast"]').count()) === 0, 4000));

  // small edit switch
  await g.keyboard.type(' Ok.', { delay: 15 });
  await until(async () => (await page.locator('[data-testid="edited-toast"]').count()) === 1, 15000);
  await page.locator('[data-testid="eb-compare"]').click();
  await page.locator('[data-testid="eb-quiet"]').check({ force: true });
  await page.locator('[data-testid="eb-later"]').click();
  check('13 Later closes the dialog, toast stays', !(await page.locator('[data-testid="edited-dialog"]').count()) && (await page.locator('[data-testid="edited-toast"]').count()) === 1);
  await page.locator('[data-testid="eb-got"]').click();
  await g.keyboard.type(' Yes.', { delay: 15 });
  await wait(5000);
  check('14 a small edit no longer asks', (await page.locator('[data-testid="edited-toast"]').count()) === 0);
  await g.keyboard.type(' ' + 'Another long sentence with many extra words so that this is certainly not a small edit anymore at all today.'.repeat(1), { delay: 5 });
  check('15 a big edit still asks', await until(async () => (await page.locator('[data-testid="edited-toast"]').count()) === 1, 15000));
} catch (e) { check('crash: ' + e.message, false); }
await finish();
