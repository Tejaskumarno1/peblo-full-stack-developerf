// Block menu (B5), keyboard shortcuts list in Settings (B2), Alt Up / Alt Down move a block.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const order = () => page.locator('.bn-block-content[data-content-type="paragraph"], .bn-block-content[data-content-type="heading"]').allInnerTexts().then((a) => a.map((s) => s.trim()).filter(Boolean));
async function openMenu(n) {
  const blk = page.locator('.bn-block-content').nth(n);
  await blk.hover();
  await page.locator('.bn-side-menu .bn-button, .bn-side-menu button').last().waitFor({ timeout: 5000 });
  const handle = page.locator('[data-test="dragHandle"]');
  await handle.click();
  await page.locator('.pb-block-menu').waitFor({ timeout: 4000 });
}
try {
  const n = (await api('POST', '/api/notes', { title: 'Block menu probe', content: 'First block.\n\nSecond block with the handle.\n\nThird block.' })).note;
  await page.goto(base + '/notes/' + n.id);
  await page.locator('.bn-editor').waitFor({ timeout: 20000 });
  await wait(1800);

  await openMenu(1);
  const txt = (await page.locator('.pb-block-menu').innerText()).replace(/\s+/g, ' ');
  for (const w of ['Turn into', 'Colour', 'Highlight', 'Align', 'Duplicate', 'Move up or down', 'Delete']) check(`Menu has "${w}"`, txt.includes(w), txt);
  check('Menu: six text colours', (await page.locator('[data-testid="bm-colour-row"] .sw').count()) === 6);
  check('Menu: five highlight colours', (await page.locator('[data-testid="bm-highlight-row"] .sw').count()) === 5);
  check('Menu: no separate colour panel (colours sit inside the menu)', (await page.locator('.bn-color-picker-dropdown').count()) === 0);
  await page.screenshot({ path: 'e2e/block-menu.png' });

  await page.locator('[data-testid="bm-red"]').click(); await wait(300);
  check('Colour: the block turns red', (await page.locator('.bn-block-outer').nth(1).locator('.bn-block').first().getAttribute('data-text-color')) === 'red' || (await page.locator('.bn-block-content').nth(1).getAttribute('data-text-color')) === 'red');
  await page.keyboard.press('Escape'); await openMenu(1);
  await page.locator('[data-testid="bm-mint"]').click(); await wait(300);
  check('Highlight: the block gets a green background', (await page.locator('.bn-block-content').nth(1).getAttribute('data-background-color')) === 'green' || (await page.locator('.bn-block').nth(1).getAttribute('data-background-color')) === 'green');
  await page.keyboard.press('Escape'); await openMenu(1);
  await page.locator('[data-testid="bm-align-center"]').click(); await wait(300);
  check('Align: centre', (await page.locator('.bn-block-content').nth(1).getAttribute('data-text-alignment')) === 'center');
  await page.keyboard.press('Escape'); await openMenu(1);
  await page.locator('.pb-block-menu >> text=Duplicate').click(); await wait(400);
  let o = await order();
  check('Duplicate: a second copy follows', o.filter((s) => s === 'Second block with the handle.').length === 2, o.join(' | '));
  await page.keyboard.press('Escape'); await wait(200);

  await openMenu(0);
  await page.locator('[data-testid="bm-down"]').click(); await wait(400);
  o = await order();
  check('Move down: first block went one place down', o[0] !== 'First block.' && o[1] === 'First block.', o.join(' | '));
  await page.keyboard.press('Escape'); await wait(200);

  await openMenu(0);
  await page.locator('.pb-block-menu >> text=Turn into').hover();
  await page.locator('.bn-menu-dropdown >> text=Heading 2').click(); await wait(400);
  check('Turn into: the block became a heading', (await page.locator('.bn-block-content[data-content-type="heading"]').count()) === 1);
  await page.keyboard.press('Escape'); await wait(200);

  await openMenu(0);
  const before = (await order()).length;
  await page.locator('.pb-block-menu >> text=Delete').click(); await wait(400);
  check('Delete: the block is gone', (await order()).length === before - 1);

  // Alt Up / Alt Down
  await page.locator('.bn-block-content').nth(1).click();
  const was = await order();
  await page.keyboard.press('Alt+ArrowUp'); await wait(400);
  const now = await order();
  check('Alt Up moves the block up', now[0] === was[1] && now[1] === was[0], now.join(' | '));
  await page.keyboard.press('Alt+ArrowDown'); await wait(400);
  check('Alt Down moves it back', (await order()).join('|') === was.join('|'));

  // ---- Settings: keyboard shortcuts
  await page.goto(base + '/settings/shortcuts');
  await page.locator('.s-keys').waitFor({ timeout: 15000 });
  const groups = await page.locator('[data-testid="keys-group"] .s-keys-title').allInnerTexts();
  check('Shortcuts list: Edit, Text, Blocks and Find and move are there', ['edit', 'text', 'blocks', 'find and move'].every((g) => groups.map((x) => x.toLowerCase()).includes(g)), groups.join(','));
  const body = (await page.locator('.s-keys').innerText()).replace(/\s+/g, ' ');
  check('Shortcuts list: Undo Ctrl Z, Redo Ctrl Y and Ctrl Shift Z', /Undo Ctrl Z/.test(body) && /Redo Ctrl Y/.test(body) && /Redo Ctrl Shift Z/.test(body), body.slice(0, 300));
  check('Shortcuts list: Find Ctrl F and Replace Ctrl H', /Find Ctrl F/.test(body) && /Replace Ctrl H/.test(body));
  await page.locator('.s-keys-search input').fill('undo'); await wait(200);
  check('Shortcuts list: search narrows it', (await page.locator('.s-keys-row').count()) === 1);
  await page.screenshot({ path: 'e2e/shortcuts.png' });
} catch (e) { check('no exception: ' + e.message, false); console.log(e.stack); }
await finish();
