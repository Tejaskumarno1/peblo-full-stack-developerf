// Picture viewer gallery and zoom (mockup S36). Based on copy-image.mjs.
// Copy picture: from the full-size view on a read-only share link, and from the picture toolbar in the editor.
import zlib from 'node:zlib';
import { boot } from './lib.mjs';
const { base, api, page, ctx, check, finish } = await boot({ freshPresence: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const png = (w, h) => {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 4 + 1) + 1 + x * 4; raw[o] = 200; raw[o + 1] = 60 + x; raw[o + 2] = 90; raw[o + 3] = 255; } }
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
const dataUrl = 'data:image/png;base64,' + png(240, 140).toString('base64');
const dataUrl2 = 'data:image/png;base64,' + png(200, 120).toString('base64');
const clip = () => page.evaluate(async () => { try { const items = await navigator.clipboard.read(); const out = []; for (const it of items) for (const t of it.types) out.push(t + ':' + (await (await it.getType(t)).arrayBuffer()).byteLength); return out; } catch (e) { return ['error ' + e.message]; } });
try {
  const n = (await api('POST', '/api/notes', { title: 'Two pictures', content: `# Pictures\n\n![First picture](${dataUrl})\n\nMiddle.\n\n![Second picture](${dataUrl2})\n`, tags: [] })).note;
  const view = (await api('POST', `/api/share/note/${n.id}`, { edit: false })).token;
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${base}/s/note/${view}`);
  await page.locator('.pb-shared .doc img').first().waitFor({ timeout: 25000 });
  await page.locator('.pb-shared .doc img').first().click(); await wait(400);
  check('1 the viewer shows which picture of how many', /1 of 2/.test(await page.locator('[data-testid="picture-count"]').innerText()));
  await page.locator('[data-testid="picture-next"]').click();
  check('2 next goes to the second picture', /2 of 2/.test(await page.locator('[data-testid="picture-count"]').innerText()));
  await page.keyboard.press('ArrowLeft');
  check('3 the arrow keys step back', /1 of 2/.test(await page.locator('[data-testid="picture-count"]').innerText()));
  await page.locator('[data-testid="picture-zoom-in"]').click();
  check('4 zoom in raises the percentage', /125%/.test(await page.locator('[data-testid="picture-zoom"]').innerText()));
  await page.locator('[data-testid="picture-zoom-out"]').click(); await page.locator('[data-testid="picture-zoom-out"]').click();
  check('5 zoom out lowers it', /75%/.test(await page.locator('[data-testid="picture-zoom"]').innerText()));
  await page.keyboard.press('Escape');
  check('6 Escape closes the viewer', (await page.locator('[data-testid="picture-view"]').count()) === 0);
} catch (e) { check('run ' + e.message, false); }
await finish();
