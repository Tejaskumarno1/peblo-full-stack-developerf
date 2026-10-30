// Round 13: Orbit map: topic colours and icons, arrow-key navigation, save as PNG/SVG.
import fs from 'node:fs';
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const go = async (path) => {
  await page.goto(base + '/tasks');
  await page.evaluate(() => { localStorage.setItem('peblo-style', 'orbit'); localStorage.setItem('peblo-orbit-help-seen', '1'); });
  await page.goto(base + path);
  await page.waitForTimeout(1800);
};
try {
  for (const t of ['alpha', 'bravo', 'charlie']) await api('POST', '/api/notes', { title: `${t} note`, content: `about ${t}`, tags: [t] });
  await go('/');
  await page.evaluate(() => window.dispatchEvent(new Event('peblo:topics')));
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Icon for alpha/ }).click();
  await page.getByRole('menuitem', { name: 'Use Brain' }).click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'red for alpha' }).click();
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Close' }).first().click().catch(() => {});
  await page.waitForTimeout(500);
  const alpha = page.locator('.o-node .ball', { hasText: 'Alpha' }).first();
  check('a topic icon shows on the map', (await alpha.locator('svg').count()) > 0);
  check('a topic colour shows on the map', !!(await alpha.getAttribute('data-own-colour')));

  await go('/');
  await page.locator('.o-map').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('ArrowRight');
  check('an arrow key puts focus on a node', await page.evaluate(() => !!document.activeElement?.closest('.o-node .ball')));
  const first = await page.evaluate(() => document.activeElement?.textContent);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  check('..and arrows keep focus on nodes', await page.evaluate(() => !!document.activeElement?.closest('.o-node .ball')));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  check('Enter selects the focused topic', (await page.getByRole('complementary', { name: 'Selected topic' }).count()) === 1, first);

  const [svgDl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('g')]);
  const svgText = fs.readFileSync(await svgDl.path(), 'utf8');
  check('Download as SVG gives a drawing of the map', svgDl.suggestedFilename().endsWith('.svg') && svgText.startsWith('<svg') && /alpha/i.test(svgText));
  const [pngDl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('p')]);
  const png = fs.readFileSync(await pngDl.path());
  check('Download as PNG gives a real picture', pngDl.suggestedFilename().endsWith('.png') && png[0] === 0x89 && png[1] === 0x50 && png.length > 1000, String(png.length));
} catch (e) {
  check('script ran to the end', false, String(e).slice(0, 300));
}
await finish();
