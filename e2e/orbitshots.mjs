// Takes screenshots of the Orbit screens (set HEADED=1 to watch them on the second monitor).
import { boot, REPO } from './lib.mjs';
const { base, api, page, finish } = await boot();
const shot = (n) => page.screenshot({ path: REPO + '/.shots/o-' + n + '.png' });
await page.setViewportSize({ width: 1366, height: 700 });
const d0 = new Date(); d0.setHours(0, 0, 0, 0);
const add = (n) => { const d = new Date(d0); d.setDate(d.getDate() + n); return d.toISOString(); };
await api('POST', '/api/todos', { text: 'Solve PYQ 2024 Q3', deadline: add(0), priority: 'high', tags: ['normalization'] });
await api('POST', '/api/todos', { text: 'Study group', deadline: add(1), startTime: '16:00', endTime: '17:00', tags: ['exams'] });
await api('POST', '/api/todos', { text: 'Read chapter 5', deadline: add(2), tags: ['databases'] });
await api('POST', '/api/notes', { title: 'BCNF', content: '## BCNF\n\nEvery determinant is a key.\n\n- 3NF vs BCNF', tags: ['normalization'] });
await api('POST', '/api/notes', { title: 'Joins', content: 'Inner, outer, cross.', tags: ['databases'] });
await api('POST', '/api/notes', { title: 'Inbox thought', content: 'Ask sir about indexes', tags: ['inbox'] });
await page.goto(base + '/tasks');
await page.evaluate(() => { localStorage.setItem('peblo-style', 'orbit'); localStorage.setItem('peblo-orbit-help-seen', '1'); });
for (const [n, p] of [['map', '/'], ['notes', '/notes'], ['tasks', '/tasks'], ['cal', '/calendar'], ['ai', '/ai'], ['settings', '/settings'], ['quiz', '/quiz'], ['topics', '/topics']]) {
  await page.goto(base + p);
  await page.waitForTimeout(1800);
  await shot(n);
}
await finish();
