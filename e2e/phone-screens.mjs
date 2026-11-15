// Phone layouts (390 x 844): every main screen uses the phone's own width, nothing sideways-scrolls, taps are big enough.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const SHOTS = process.env.PHONE_SHOTS || 'C:/Users/tejas/peblo-e2e';
try {
  const day = (d, h, m = 0) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, m, 0, 0); return x.toISOString(); };
  await api('POST', '/api/todos', { text: 'Write spec', priority: 'high', deadline: day(0, 14), startTime: '14:00', endTime: '15:30', tags: ['work'] });
  await api('POST', '/api/todos', { text: 'Review PRs', priority: 'medium', deadline: day(0, 16), tags: ['work'] });
  await api('POST', '/api/todos', { text: 'Book flights', priority: 'low', tags: ['home'] });
  await api('POST', '/api/todos', { text: 'Pay rent', priority: 'high', deadline: day(-1, 9) });
  await api('POST', '/api/notes', { title: 'Sprint demo', content: 'Notes about the demo', tags: ['work'] });
  await page.addInitScript(() => { try { localStorage.setItem('peblo-style', 'soft'); localStorage.setItem('peblo-collab-tip', '1'); } catch { /* ignore */ } });
  await page.setViewportSize({ width: 390, height: 844 });
  const screens = [['home', '/'], ['tasks', '/tasks'], ['calendar', '/calendar'], ['ai', '/ai'], ['connect', '/ai/connections'], ['notifications', '/notifications']];
  for (const [name, url] of screens) {
    await page.goto(base + url);
    await page.waitForTimeout(1600);
    const m = await page.evaluate(() => {
      const r = document.documentElement;
      const inScroller = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if ((o === 'auto' || o === 'scroll' || o === 'hidden') && p.getBoundingClientRect().right <= innerWidth + 1) return true; } return false; };
      const out = [];
      document.querySelectorAll('.soft button, .soft a, .soft input, .soft [role=tab], .soft [role=switch]').forEach((e) => {
        const b = e.getBoundingClientRect(); const cs = getComputedStyle(e);
        if (b.width < 2 || b.height < 2 || cs.visibility === 'hidden' || cs.display === 'none') return;
        if (b.bottom < 0 || b.top > innerHeight + 2000) return;
        if (b.height < 32 && !e.closest('[aria-hidden=true]') && !(e.type === 'checkbox' && e.closest('label'))) out.push((e.getAttribute('aria-label') || e.textContent || e.className).trim().slice(0, 30) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height));
      });
      const wide = [...document.querySelectorAll('.soft *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > innerWidth + 1 || b.left < -1) && getComputedStyle(e).position !== 'fixed' && !inScroller(e); }).slice(0, 4).map((e) => (e.className || e.tagName).toString().slice(0, 40));
      return { phone: r.classList.contains('pb-phone'), zoom: r.style.zoom || '', scrollX: r.scrollWidth - innerWidth, tiny: out.slice(0, 8), wide };
    });
    await page.screenshot({ path: `${SHOTS}/phone-${name}.png` });
    check(`${name}: phone layout (not a scaled desktop)`, m.phone && m.zoom === '', JSON.stringify(m));
    check(`${name}: no sideways scroll`, m.scrollX <= 1 && m.wide.length === 0, JSON.stringify(m));
    check(`${name}: taps at least 32px tall`, m.tiny.length === 0, m.tiny.join(' | '));
  }
} catch (e) { check('script ran to the end', false, e.message); }
await finish();
