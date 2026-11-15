import { boot } from './lib.mjs';
const { base, api, page, finish } = await boot({ freshPresence: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const n = (await api('POST', '/api/notes', { title: 'Q4 client report', content: '## Overview\n\nThree themes came up across the six client interviews.\n\n## 1. What we heard\n\nClients were not unhappy with quality. They described waiting.\n\n## 2. Next steps\n\nA Tuesday review slot.' })).note;
await page.setViewportSize({ width: 1536, height: 864 });
const open = {
  soft: async () => { await page.locator('button[aria-label="Full screen"]').first().click(); },
  river: async () => { await page.locator('[data-testid="fs-open"]').first().click(); },
  orbit: async () => { await page.locator('button[aria-label="Focus mode"]').first().click(); },
};
for (const style of ['soft', 'river', 'orbit']) {
  await page.goto(base + '/tasks');
  await page.evaluate((v) => { localStorage.setItem('peblo-style', v); ['peblo-fs-width', 'peblo-fs-size', 'peblo-fs-theme', 'peblo-fs-outline', 'peblo-fs-day'].forEach((k) => localStorage.removeItem(k)); }, style);
  await page.goto(base + '/notes/' + n.id);
  await page.locator('.bn-editor').waitFor({ timeout: 20000 }); await wait(1500);
  await open[style]();
  await page.locator('[data-testid="fs-bar"]').waitFor({ timeout: 5000 }); await wait(800);
  await page.mouse.move(700, 30); await wait(300);
  await page.screenshot({ path: `D:/Peblo/_shots/fs-${style}.png` });
  if (style === 'soft') { await page.locator('[data-testid="fs-theme"]').click(); await wait(500); await page.screenshot({ path: 'D:/Peblo/_shots/fs-soft-dark.png' }); }
  if (style === 'orbit') { await page.locator('[data-testid="fs-theme"]').click(); await wait(500); await page.screenshot({ path: 'D:/Peblo/_shots/fs-orbit-dark.png' }); }
  await page.keyboard.press('Escape'); await wait(500);
}
await finish();
