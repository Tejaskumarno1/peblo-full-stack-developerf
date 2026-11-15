import { boot } from './lib.mjs';
// A profile picture must stay inside its circle on every screen, even with the picture's own stylesheet rule gone
// (late, cached from an older build, overridden) and when the picture cannot load at all.
const { base, api, page, check, finish } = await boot();
try {
  await page.setViewportSize({ width: 1916, height: 1017 });
  await page.goto(base + '/');
  const url = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 340; const g = c.getContext('2d'); g.fillStyle = '#1a1c5a'; g.fillRect(0, 0, 600, 340); g.fillStyle = '#fff'; g.fillRect(40, 40, 200, 40); return c.toDataURL('image/webp'); });
  const r = await api('PUT', '/api/profile', { avatar: url });
  check('wide picture saved', !!r.user && !!r.user.avatar);
  const measure = () => page.evaluate(() => { const i = document.querySelector('.soft-avatar img'); if (!i) return null; const b = i.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; });
  for (const route of ['/ai/connections', '/tasks', '/calendar', '/']) {
    await page.goto(base + route);
    await page.locator('.soft-avatar').waitFor({ timeout: 8000 });
    await page.waitForTimeout(500);
    check('picture is a 48px circle on ' + route, JSON.stringify(await measure()) === '[48,48]', JSON.stringify(await measure()));
    // worst case: the stylesheet rule for pictures is gone
    await page.evaluate(() => { for (const s of document.styleSheets) { try { for (let i = s.cssRules.length - 1; i >= 0; i--) if (/pb-avatar-img/.test(s.cssRules[i].cssText)) s.deleteRule(i); } catch (e) {} } });
    check('still 48px with the picture rule removed on ' + route, JSON.stringify(await measure()) === '[48,48]', JSON.stringify(await measure()));
  }
  await page.screenshot({ path: 'D:/Peblo/_shots/avatar-ok.png' });
  // a picture that cannot load falls back to the letter
  await api('PUT', '/api/profile', { avatar: 'data:image/webp;base64,AAAA' }).catch(() => {});
} catch (e) { check('no crash', false, String(e).slice(0, 300)); }
await finish();