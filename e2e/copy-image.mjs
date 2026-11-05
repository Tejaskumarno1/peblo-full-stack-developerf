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
const clip = () => page.evaluate(async () => { try { const items = await navigator.clipboard.read(); const out = []; for (const it of items) for (const t of it.types) out.push(t + ':' + (await (await it.getType(t)).arrayBuffer()).byteLength); return out; } catch (e) { return ['error ' + e.message]; } });
try {
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const n = (await api('POST', '/api/notes', { title: 'With a picture', content: `# With a picture\n\nBefore.\n\n![A small test picture](${dataUrl})\n\nAfter.\n`, tags: [] })).note;
  const view = (await api('POST', `/api/share/note/${n.id}`, { edit: false })).token;
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${base}/s/note/${view}`);
  await page.locator('.pb-shared .doc img').first().waitFor({ timeout: 25000 });
  await page.locator('.pb-shared .doc img').first().click(); await wait(500);
  check('1 a picture on a read-only link opens full size with Copy and Save', (await page.locator('[data-testid="picture-copy"]').isVisible()) && (await page.locator('[data-testid="picture-save"]').isVisible()));
  await page.locator('[data-testid="picture-copy"]').click(); await wait(900);
  const got = await clip();
  check('2 the clipboard now holds the picture as a PNG', got.some((s) => s.startsWith('image/png:') && Number(s.split(':')[1]) > 50), JSON.stringify(got));
  check('3 the button says Copied', /Copied/.test(await page.locator('[data-testid="picture-copy"]').innerText()));
  await page.keyboard.press('Escape'); await wait(300);
  check('4 Escape closes the picture', (await page.locator('[data-testid="picture-view"]').count()) === 0);

  // the owner's editor: selecting the picture shows a toolbar with Copy picture
  await page.goto(`${base}/notes/${n.id}`);
  await page.locator('.bn-editor img').first().waitFor({ timeout: 25000 });
  await wait(1500);
  const box = await page.locator('.bn-visual-media-wrapper img, img.bn-visual-media').first().boundingBox();
  await page.mouse.click(box.x + Math.min(40, box.width / 2), box.y + Math.min(40, box.height / 2));
  await wait(1500);
  const btn = page.locator('.bn-toolbar button[data-test="copypicture"]').first();
  await btn.waitFor({ timeout: 8000 }).catch(() => {});
  const seen = await page.evaluate(() => [...document.querySelectorAll('.bn-toolbar button')].map((b) => b.getAttribute('data-test') || '?'));
  check('5 the picture toolbar has a Copy picture button', (await btn.count()) > 0, JSON.stringify({ box, seen }));
  if (await btn.count()) {
    await btn.click(); await wait(900);
    const got2 = await clip();
    check('6 and it puts the picture on the clipboard', got2.some((s) => s.startsWith('image/png')), JSON.stringify(got2));
  }
} catch (e) { check('crash: ' + e.message, false); }
await finish();
