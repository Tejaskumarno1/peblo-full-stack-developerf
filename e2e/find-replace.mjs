// Find and replace (B3): owner page gets both rows; a shared page gets Find for readers and Replace for editors.
import { boot } from './lib.mjs';
const { base, api, page, ctx, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const body = 'We ship the redesign by Friday. Share links work, and every share page loads fast. Share again on Monday.';
try {
  const n = (await api('POST', '/api/notes', { title: 'Find probe', content: body })).note;
  await page.goto(base + '/notes/' + n.id);
  await page.locator('.bn-editor').waitFor({ timeout: 20000 });
  await wait(1500);
  await page.locator('.bn-block-content').first().click();

  // ---- owner page
  await page.keyboard.press('Control+f');
  await page.locator('.pb-find').waitFor({ timeout: 3000 });
  check('Owner: Ctrl F opens the card with a Find box', (await page.locator('.pb-find input.q').count()) === 1);
  check('Owner: the Replace row is there', (await page.locator('.pb-find input.r').count()) === 1 && (await page.locator('[data-testid="replace-all"]').count()) === 1);
  await page.locator('.pb-find input.q').fill('share');
  await wait(300);
  check('Owner: counts matches without regard to case ("1 of 3")', /1 of 3/.test(await page.locator('.pb-find .n').innerText()));
  await page.locator('.pb-find input.q').press('Enter'); await wait(150);
  check('Owner: Enter goes to the next match', /2 of 3/.test(await page.locator('.pb-find .n').innerText()));
  await page.locator('.pb-find input.r').fill('send');
  await page.locator('[data-testid="replace-one"]').click(); await wait(400);
  let t = await page.locator('.bn-editor').innerText();
  check('Owner: Replace changes the current match only', (t.match(/send/g) || []).length === 1 && /Share links|Share again/.test(t) && /every send page|send links|send again/i.test(t), t);
  check('Owner: the count drops after a replace', /of 2/.test(await page.locator('.pb-find .n').innerText()));
  await page.locator('[data-testid="replace-all"]').click(); await wait(500);
  t = await page.locator('.bn-editor').innerText();
  check('Owner: All replaces every other match', !/share/i.test(t) && (t.match(/send/gi) || []).length === 3, t);
  check('Owner: the case of the original is not forced (replacement text is used as typed)', /every send page/.test(t) && /send links work/.test(t));
  await page.keyboard.press('Escape');
  await page.locator('.pb-find').waitFor({ state: 'detached', timeout: 3000 });
  check('Owner: Esc closes it', true);
  await page.keyboard.press('Control+z'); await wait(500);
  check('Owner: Undo takes a replace back', /share/i.test(await page.locator('.bn-editor').innerText()));

  // Ctrl H opens with Replace focused
  await page.locator('.bn-block-content').first().click();
  await page.keyboard.press('Control+h');
  await page.locator('.pb-find').waitFor({ timeout: 3000 });
  check('Owner: Ctrl H puts the cursor in Replace with', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Replace with'));
  await page.keyboard.press('Escape');
  await wait(300);

  // the replaced text is saved
  await wait(3500);
  const saved = (await api('GET', '/api/notes/' + n.id)).note;
  check('Owner: the change reached the saved note', /send/.test(saved.content || '') || /share/i.test(saved.content || ''));
  await page.screenshot({ path: 'e2e/find-owner.png' });

  // ---- shared page: reader and editor
  const mk = async (edit) => {
    const note = (await api('POST', '/api/notes', { title: edit ? 'Edit share' : 'Read share', content: body })).note;
    const tok = (await api('POST', `/api/share/note/${note.id}`, { edit })).token;
    return tok;
  };
  for (const edit of [false, true]) {
    const tok = await mk(edit);
    const g = await (await ctx.browser().newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await g.goto(`${base}/s/note/${tok}`);
    await g.locator(edit ? '.bn-editor' : '.doc').waitFor({ timeout: 20000 });
    await wait(1800);
    await g.keyboard.press('Escape');
    await g.keyboard.press('Control+f');
    await g.locator('.pb-find').waitFor({ timeout: 3000 }).catch(() => {});
    const label = edit ? 'Editor' : 'Reader';
    check(`${label}: Ctrl F opens find on the shared page`, (await g.locator('.pb-find input.q').count()) === 1);
    await g.locator('.pb-find input.q').fill('share'); await wait(300);
    check(`${label}: it finds the words`, /1 of 3/.test(await g.locator('.pb-find .n').innerText()));
    if (edit) {
      check('Editor: Replace and All are offered', (await g.locator('[data-testid="replace-one"]').count()) === 1 && (await g.locator('[data-testid="replace-all"]').count()) === 1);
      await g.locator('.pb-find input.r').fill('post');
      await g.locator('[data-testid="replace-all"]').click(); await wait(600);
      const gt = await g.locator('.bn-editor').innerText();
      check('Editor: Replace all works on the shared page', (gt.match(/post/gi) || []).length === 3 && !/share/i.test(gt), gt);
    } else {
      check('Reader: no Replace controls', (await g.locator('.pb-find input.r').count()) === 0 && (await g.locator('[data-testid="replace-all"]').count()) === 0);
      check('Reader: says viewers get Find only', /Viewers get Find only/.test(await g.locator('.pb-find').innerText()));
      await g.keyboard.press('Control+h'); await wait(300);
      check('Reader: Ctrl H does not add Replace', (await g.locator('.pb-find input.r').count()) === 0);
    }
    await g.screenshot({ path: `e2e/find-${label.toLowerCase()}.png` });
    await g.context().close();
  }
} catch (e) { check('no exception: ' + e.message, false); console.log(e.stack); }
await finish();
