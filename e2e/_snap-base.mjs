// Captures the live Kanban page as a static, pixel-exact HTML snapshot (computed styles inlined) for the design canvas.
import fs from 'node:fs';
const { boot } = await import('./lib.mjs');
const b = await boot();
const out = 'D:\\Peblo\\_shots';
try { fs.mkdirSync(out, { recursive: true }); } catch {}
const p = b.page;
const SNAP = () => {
  const root = document.getElementById('root');
  const clone = root.cloneNode(true);
  const src = [root, ...root.querySelectorAll('*')];
  const dst = [clone, ...clone.querySelectorAll('*')];
  src.forEach((el, i) => {
    const d = dst[i];
    if (!d || !d.style) return;
    const cs = getComputedStyle(el);
    let css = '';
    for (let k = 0; k < cs.length; k++) {
      const n = cs[k];
      if (/^(transition|animation|-webkit-|cursor|pointer|will-change|caret|scroll|overscroll|view-transition|container|anchor|position-anchor|interactivity|interpolate|math|ruby|speak|text-size|print-color|forced|field-sizing|appearance|app-region)/.test(n)) continue;
      css += `${n}:${cs.getPropertyValue(n)};`;
    }
    d.setAttribute('style', css);
    if (cs.position === 'fixed') {
      const r = el.getBoundingClientRect();
      d.style.position = 'absolute'; d.style.top = r.top + 'px'; d.style.left = r.left + 'px'; d.style.right = 'auto'; d.style.bottom = 'auto'; d.style.transform = 'none'; d.style.width = r.width + 'px'; d.style.height = r.height + 'px'; d.style.margin = '0';
    }
    if (d.tagName === 'INPUT') { d.setAttribute('value', el.value || ''); if (el.placeholder) d.setAttribute('placeholder', el.placeholder); if (el.checked) d.setAttribute('checked', ''); }
  });
  clone.querySelectorAll('script,style,link,noscript,iframe').forEach((x) => x.remove());
  const bg = getComputedStyle(document.body).backgroundColor;
  return { html: clone.innerHTML, bg };
};
const snap = async (name) => {
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}\\base-${name}.png` });
  const r = await p.evaluate(SNAP);
  fs.writeFileSync(`${out}\\base-${name}.json`, JSON.stringify(r));
};
const step = async (name, fn) => { try { await fn(); await snap(name); } catch (e) { console.log('STEP FAIL', name, e.message); } };
try {
  await p.setViewportSize({ width: 1440, height: 900 });
  const made = await b.api('POST', '/api/workspaces/orgs', { name: 'Studio Co', start: 'team' });
  const team = made.spaceId;
  await p.goto(b.base + '/', { waitUntil: 'networkidle' });
  await p.evaluate((sp) => localStorage.setItem('peblo-space', sp), team);
  const call = (path, method, body, sp) => p.evaluate(async ({ path, method, body, sp }) => {
    const t = localStorage.getItem('peblo-token');
    const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t, ...(sp ? { 'x-peblo-space': sp } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return r.json();
  }, { path, method, body, sp });
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString();
  const mk = (text, o) => call('/api/todos', 'POST', { text, ...o }, team);
  await mk('Reply to sponsor email', { deadline: day(1), priority: 'high' });
  await mk('Colour grade the reel', { deadline: day(-2), priority: 'high' });
  await mk('Update the caption template', { deadline: day(2), priority: 'low' });
  await mk('Record the voice-over', { deadline: day(3), priority: 'medium', column: 'doing' });
  await mk('Edit the cuts', { deadline: day(5), priority: 'medium', column: 'review' });
  await call('/api/notes', 'POST', { title: 'Reel plan', content: 'Shots for the week' }, team);
  await call('/api/notes', 'POST', { title: 'Sponsor call notes', content: 'Agenda and follow-ups' }, team);
  await p.goto(b.base + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  await snap('home');
  await step('home-switcher', async () => { await p.locator('header button', { hasText: 'Studio Co team' }).last().click(); await p.waitForTimeout(500); });
  await p.keyboard.press('Escape');
  await p.goto(b.base + '/tasks', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  await step('tasks-board', async () => {});
  await step('tasks-review', async () => { await p.getByText('Review', { exact: true }).first().click(); await p.waitForTimeout(700); }); await p.goto(b.base + '/tasks', { waitUntil: 'networkidle' }); await step('tasks-lists', async () => { await p.getByText('Lists', { exact: true }).first().click(); await p.waitForTimeout(600); });
  await p.goto(b.base + '/tasks', { waitUntil: 'networkidle' });
  await p.getByRole('tab', { name: 'List' }).click(); await p.waitForTimeout(900);
  await snap('tasks-list');
  await p.getByRole('tab', { name: 'Kanban' }).click(); await p.getByTestId('kanban').waitFor({ timeout: 8000 }); await p.waitForTimeout(500);
  await snap('tasks-kanban');
  await p.getByRole('tab', { name: 'Workload' }).click(); await p.waitForTimeout(900);
  await snap('tasks-workload');
  await p.goto(b.base + '/notes', { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
  await snap('notes');
  await step('notes-move-share', async () => { await p.getByRole('button', { name: /Move or share/ }).first().click(); await p.waitForTimeout(500); });
  await p.keyboard.press('Escape');
  await p.goto(b.base + '/notes', { waitUntil: 'networkidle' });
  await step('notes-new', async () => { await p.getByRole('button', { name: /New note|Folders/ }).first().click(); await p.waitForTimeout(500); });
} catch (e) { console.log('ERR', e.message); }
await b.finish();


