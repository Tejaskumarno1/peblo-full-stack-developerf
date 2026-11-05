// A picture pasted from another web page arrives as <img src="blob:..."> that only works in that tab.
// The editor must store the real picture file instead, or say plainly that it cannot.
import zlib from 'node:zlib';
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot({ freshPresence: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const png = (w, h) => {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 4 + 1) + 1 + x * 4; raw[o] = 200; raw[o + 1] = 60 + x; raw[o + 2] = 90; raw[o + 3] = 255; } }
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
const b64 = png(120, 80).toString('base64');
const pasteIt = (withFile) => page.evaluate(({ b64, withFile }) => {
  const el = document.querySelector('.bn-editor');
  el.focus();
  const dt = new DataTransfer();
  dt.setData('text/html', '<meta charset="utf-8"><img src="blob:https://claude.ai/3feeaadc-8440-4f5f-80d0-139df0d39ecb">');
  dt.setData('text/plain', '');
  if (withFile) { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); dt.items.add(new File([u], 'pasted.png', { type: 'image/png' })); }
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev.defaultPrevented;
}, { b64, withFile });
const srcs = () => page.evaluate(() => [...document.querySelectorAll('.bn-editor img')].map((i) => i.getAttribute('src') || ''));
try {
  const n = (await api('POST', '/api/notes', { title: 'Blob paste', content: '# Blob paste\n\nHello.\n', tags: [] })).note;
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${base}/notes/${n.id}`);
  await page.locator('.bn-editor').waitFor({ timeout: 25000 });
  await wait(1500);
  await page.locator('.bn-editor p', { hasText: 'Hello.' }).first().click(); await wait(300);
  const prevented = await pasteIt(true);
  await wait(2500);
  const a = await srcs();
  check('1 pasting a blob picture with a real file is taken over by the editor', prevented === true);
  check('2 one stored picture appears, not a blob address', a.length === 1 && !/^blob:/.test(a[0]), JSON.stringify(a));
  await page.locator('.bn-editor p', { hasText: 'Hello.' }).first().click(); await wait(300);
  const notice = page.waitForEvent('console', { timeout: 0 }).catch(() => null);
  await page.evaluate(() => { window.__tells = []; window.addEventListener('pb-upload', (e) => window.__tells.push(e.detail)); });
  await pasteIt(false); await wait(800);
  const tells = await page.evaluate(() => window.__tells);
  check('3 a blob picture with no file says it cannot be pasted', tells.some((t) => t.state === 'error' && /other tab/.test(t.message)), JSON.stringify(tells));
  const b = await srcs();
  check('4 and no blob address was inserted', b.length === 1 && !b.some((s) => /^blob:/.test(s)), JSON.stringify(b));
  void notice;
} catch (e) { check('crash: ' + e.message, false); }
await finish();
