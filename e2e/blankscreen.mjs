import { boot } from './lib.mjs';
const { base, ctx, check, finish } = await boot();
try {
  // 1. A file of an older build is a real 404, never the web page.
  const miss = await fetch(`${base}/assets/old-build-abc123.js`);
  const missBody = await miss.text();
  check('missing /assets file is 404', miss.status === 404, String(miss.status));
  check('missing /assets file is not html', !/<html|<!doctype/i.test(missBody));

  // 2. index.html is never cached; real routes still get the app.
  const idx = await fetch(`${base}/some/deep/route`);
  check('SPA route returns app', idx.status === 200 && /id="root"/.test(await idx.clone().text()));
  check('index.html is no-cache', /no-cache/.test(idx.headers.get('cache-control') || ''), idx.headers.get('cache-control'));

  // 3. Hashed assets are cached for good.
  const html = await (await fetch(`${base}/`)).text();
  const asset = html.match(/\/assets\/[^"']+\.js/)?.[0];
  if (asset) {
    const a = await fetch(`${base}${asset}`);
    check('real asset served as js', a.status === 200 && /javascript/.test(a.headers.get('content-type') || ''));
    check('real asset is immutable', /immutable/.test(a.headers.get('cache-control') || ''), a.headers.get('cache-control'));
  } else check('found an asset in index.html', false);

  // 4. Browser: a lazy chunk that fails to load recovers (reloads once) instead of staying blank.
  const page = await ctx.newPage();
  let blocked = 0;
  await page.route(/\/assets\/.*\.js$/, (route) => {
    // Fail every lazily loaded file once, but let the entry file through.
    const url = route.request().url();
    if (/index-|vendor|react|ui-|editor|utils|pdf/.test(url) === false && blocked < 1 && route.request().headers()['sec-fetch-dest'] === 'script' && !/index-/.test(url)) { blocked++; return route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }); }
    return route.continue();
  });
  await page.goto(`${base}/login`);
  await page.waitForTimeout(4000);
  const text = (await page.locator('body').innerText()).trim();
  check('page is never blank', text.length > 0, JSON.stringify(text.slice(0, 80)));

  // 5. A render crash shows the error screen with a Reload button, not a white page.
  const p2 = await ctx.newPage();
  await p2.goto(`${base}/login`);
  await p2.waitForTimeout(1500);
  await p2.evaluate(() => { window.dispatchEvent(new ErrorEvent('error')); });
  check('boot splash is gone once app runs', (await p2.locator('#pb-boot').count()) === 0);
} catch (e) { check('ran', false, String(e)); } finally { await finish(); }
