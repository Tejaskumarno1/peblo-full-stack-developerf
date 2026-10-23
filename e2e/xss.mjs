import { boot } from './lib.mjs';
const { base, page, check, finish } = await boot();
try {
  // A saved AI Hub chat whose reply carries script-like content (what a hostile or confused model could produce)
  const evil = [
    'Hello <img src=x onerror="window.__xss=1"> there',
    '[click me](javascript:window.__xss=2)',
    '<script>window.__xss=3</script>',
    '<a href="javascript:window.__xss=4" id="evil-a">raw link</a>',
    'Source [1] is fine',
  ].join('\n\n');
  const chat = [{ id: 'c1', title: 'xss', createdAt: Date.now(), updatedAt: Date.now(), messages: [
    { id: 'u1', role: 'user', content: 'hi' },
    { id: 'b1', role: 'assistant', content: evil, sources: [{ id: 'n1', title: 'N' }], status: 'done' },
  ] }];
  await page.addInitScript((c) => { try { localStorage.setItem('peblo-ai-hub-v1', JSON.stringify(c)); } catch {} }, chat);
  await page.goto(base + '/ai');
  await page.waitForTimeout(2500);
  const bodyText = await page.evaluate(() => document.body.innerText);
  check('the reply is shown (page rendered it)', /Hello/.test(bodyText), bodyText.slice(0, 80));
  const xss = await page.evaluate(() => window.__xss);
  check('no injected script ran', xss === undefined, xss);
  const bad = await page.evaluate(() => [...document.querySelectorAll('a[href]')].filter((a) => /^\s*javascript:/i.test(a.getAttribute('href'))).length);
  check('no javascript: links in the page', bad === 0, bad);
  const imgs = await page.evaluate(() => document.querySelectorAll('img[onerror]').length);
  check('no onerror attributes survive', imgs === 0, imgs);
  const cite = await page.evaluate(() => document.querySelectorAll('button.pb-cite').length);
  check('citation buttons still work', cite >= 1, cite);
} catch (e) { console.error(e); process.exitCode = 1; }
await finish();
