// Colours you can see: swatch picker on the selection bar, table row / cell / column fills (mockups G1a, G1b).
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch { /* retry */ } await wait(120); } return false; };
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
try {
  const md = '# Pi planning\n\nSome plain words here.\n\n| Board | Feature | Status |\n| --- | --- | --- |\n| 24 | Session setup | None |\n| 28 | Team boards | None |\n| 29 | Draft plan | None |\n';
  const note = (await api('POST', '/api/notes', { title: 'Colours', content: md, tags: [] })).note;
  await page.goto(base + '/notes/' + note.id);
  await page.locator('.bn-editor').waitFor({ timeout: 20000 });
  await wait(1200);
  // 1 select a word -> swatch picker
  const w = page.locator('.bn-editor .bn-block-content', { hasText: 'Some plain words here' }).first();
  await w.dblclick({ position: { x: 60, y: 10 } });
  const btn = page.locator('[data-test="colors"]').first();
  await btn.waitFor({ timeout: 6000 });
  await btn.click();
  const panel = page.locator('[data-testid="color-panel"]');
  check('1 the colour panel opens', await panel.isVisible());
  check('2 ten text swatches and ten highlights, as real swatches', (await panel.locator('.pbc-sw.text').count()) === 10 && (await panel.locator('.pbc-sw.bg').count()) === 10);
  check('3 no colour names written as labels', !/\bOrange\b|\bPurple\b/.test(await panel.innerText()));
  await panel.locator('[data-testid="pbc-text-green"]').click();
  check('4 the word turns green (visible shade)', await until(async () => (await page.locator('.bn-editor [data-text-color="green"], .bn-editor [data-style-type="textColor"][data-value="green"]').count()) > 0));
  const col = await page.locator('.bn-editor [data-style-type="textColor"][data-value="green"], .bn-editor [data-text-color="green"]').first().evaluate((el) => getComputedStyle(el).color);
  check('5 the green is a strong green', col === rgb('#1E8E4E'), col);
  check('6 the panel stays open for the next pick', await panel.isVisible());
  await panel.locator('[data-testid="pbc-bg-yellow"]').click();
  check('7 highlight applies too', await until(async () => (await page.locator('.bn-editor [data-background-color="yellow"], .bn-editor [data-style-type="backgroundColor"][data-value="yellow"]').count()) > 0));
  check('8 the chosen swatch shows a ring', (await panel.locator('.pbc-sw.on').count()) >= 2);
  await panel.locator('[data-testid="pbc-reset"]').click();
  check('9 reset clears both', await until(async () => (await page.locator('.bn-editor [data-style-type="textColor"][data-value="green"]').count()) === 0));
  await page.keyboard.press('Escape');

  // 2 table row fill
  const cell = page.locator('.bn-editor table tr').nth(2).locator('td').nth(1);
  await cell.hover();
  const grips = page.locator('.bn-table-handle');
  check('10 table handles appear', await until(async () => (await grips.count()) >= 1));
  // row handle sits left of the row
  const rowGrip = grips.first();
  await rowGrip.click();
  const menu = page.locator('[data-testid="table-menu"]');
  check('11 the table menu opens with the new design', await menu.isVisible());
  const title = await menu.locator('.pbt-h b').innerText();
  check('12 it names the row or column', /Row \d|Column [A-Z]/.test(title), title);
  const scopeIsRow = /Row/.test(title);
  if (scopeIsRow) {
    await menu.locator('[data-testid="pbc-bg-green"]').click();
    const row = page.locator('.bn-editor table tr').nth(2);
    check('13 every cell of the row is green', await until(async () => (await row.locator('td[data-background-color="green"]').count()) === 3));
    const bg = await row.locator('td').first().evaluate((el) => getComputedStyle(el).backgroundColor);
    check('14 and the green shows', bg === rgb('#BFEBCF'), bg + ' ' + (await row.locator('td').first().evaluate((el) => el.outerHTML.slice(0, 260))));
    check('15 other rows untouched', (await page.locator('.bn-editor table tr').nth(1).locator('td[data-background-color="green"]').count()) === 0);
    const reopen = async () => { await page.locator('.bn-editor table tr').nth(2).locator('td').nth(1).hover(); await until(async () => (await grips.count()) >= 1); await grips.first().click(); await menu.waitFor({ timeout: 6000 }); };
    await reopen();
    await menu.locator('[data-testid="tm-scope-cell"]').click();
    await menu.locator('[data-testid="pbc-bg-blue"]').click();
    check('16 a single cell can take its own colour', await until(async () => (await page.locator('.bn-editor table td[data-background-color="blue"]').count()) === 1));
    await reopen();
    await menu.locator('[data-testid="tm-ins-b"]').click();
    check('17 insert row below adds a row', await until(async () => (await page.locator('.bn-editor table tr').count()) === 5));
  } else check('13 expected the row handle first', false, title);
} catch (e) { check('crash: ' + e.message, false); }
await finish();
