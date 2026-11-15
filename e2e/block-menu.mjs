// Toolbar block menu: grouped icon grid with filter, direct list buttons on the bar, More for H4 to H6 and toggle headings.
// Every scenario starts on a fresh note so one change cannot disturb the next.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot({ freshPresence: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const typeOf = () => page.evaluate(() => { const b = document.querySelector('.bn-editor .bn-block-content[data-content-type]'); return b ? b.getAttribute('data-content-type') + (b.getAttribute('data-level') ? ':' + b.getAttribute('data-level') : '') : ''; });
const fresh = async () => {
  const n = (await api('POST', '/api/notes', { title: 'Menu', content: 'Pick a type for this line.\n', tags: [] })).note;
  await page.goto(`${base}/notes/${n.id}`);
  await page.locator('.bn-editor').waitFor({ timeout: 25000 });
  await wait(1500);
  await page.locator('.bn-editor .bn-inline-content').first().click({ clickCount: 3, timeout: 8000, force: true }); await wait(900);
};
const open = async () => { await page.locator('[data-testid="bm-open"]').click(); await wait(300); };
try {
  await page.setViewportSize({ width: 1280, height: 800 });
  await fresh();
  check('1 selecting text shows the block type button', (await page.locator('[data-testid="bm-open"]').count()) === 1);
  await open();
  const groups = await page.locator('.pb-bm-lab').allInnerTexts();
  check('2 the menu has Text, Lists and Blocks groups', groups.join(',').toLowerCase() === 'text,lists,blocks', groups.join(','));
  check('3 the current type (Text) is highlighted', (await page.locator('[data-testid="bm-paragraph"].on').count()) === 1);
  const box = await page.locator('[data-testid="bm-pop"]').boundingBox();
  check('4 the menu stays inside the window', box && box.x >= 0 && box.x + box.width <= 1280 && box.y + box.height <= 800, JSON.stringify(box));
  await page.locator('[data-testid="bm-check"]').click(); await wait(900);
  check('5 Check list turns the line into a check list', (await typeOf()).startsWith('checkListItem'), await typeOf());

  await fresh(); await open();
  await page.locator('[data-testid="bm-filter"]').fill('quote'); await page.keyboard.press('Enter'); await wait(900);
  check('6 typing in the filter and pressing Enter applies the first match', (await typeOf()).startsWith('quote'), await typeOf());

  await fresh(); await open();
  await page.locator('[data-testid="bm-more"]').click(); await wait(200);
  await page.locator('[data-testid="bm-h4"]').click(); await wait(900);
  check('7 More reveals Heading 4 and it works', (await typeOf()) === 'heading:4', await typeOf());

  await fresh();
  await page.locator('[data-testid="bm-direct-bullet"]').click(); await wait(900);
  check('8 the Bullet button on the bar makes a bullet list', (await typeOf()).startsWith('bulletListItem'), await typeOf());
  await page.locator('[data-testid="bm-direct-bullet"]').click({ force: true }); await wait(900);
  check('9 clicking it again goes back to text', (await typeOf()).startsWith('paragraph'), await typeOf());

  await fresh();
  await page.locator('[data-testid="bm-direct-check"]').click(); await wait(900);
  check('10 the Check list button on the bar makes a check list', (await typeOf()).startsWith('checkListItem'), await typeOf());

  await fresh(); await open();
  await page.keyboard.press('Escape'); await wait(300);
  check('11 Escape closes the menu', (await page.locator('[data-testid="bm-pop"]').count()) === 0);
} catch (e) { check('crash: ' + e.message, false); }
await finish();
