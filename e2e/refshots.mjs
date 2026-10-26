// Reference screenshots of every style (desktop + phone) used to draw the phone mockups.
import { boot, REPO } from './lib.mjs';
const { base, api, page, finish } = await boot();
const d0 = new Date(); d0.setHours(0, 0, 0, 0);
const add = (n) => { const d = new Date(d0); d.setDate(d.getDate() + n); return d.toISOString(); };
await api('POST', '/api/todos', { text: 'Solve PYQ 2024 Q3', deadline: add(0), priority: 'high', tags: ['normalization'] });
await api('POST', '/api/todos', { text: 'Study group', deadline: add(1), startTime: '16:00', endTime: '17:00', tags: ['exams'] });
await api('POST', '/api/todos', { text: 'Read chapter 5', deadline: add(2), tags: ['databases'] });
await api('POST', '/api/notes', { title: 'BCNF', content: '## BCNF\n\nEvery determinant is a key.\n\n- 3NF vs BCNF', tags: ['normalization'] });
await api('POST', '/api/notes', { title: 'Joins', content: 'Inner, outer, cross.', tags: ['databases'] });
await api('POST', '/api/notes', { title: 'Inbox thought', content: 'Ask sir about indexes', tags: ['inbox'] });
await page.goto(base + '/tasks');
const routes = [['home', '/'], ['notes', '/notes'], ['tasks', '/tasks'], ['cal', '/calendar'], ['ai', '/ai'], ['settings', '/settings'], ['quiz', '/quiz'], ['topics', '/topics']];
for (const style of ['river', 'orbit', 'soft']) {
  await page.evaluate((s) => { localStorage.setItem('peblo-style', s); localStorage.setItem('peblo-orbit-help-seen', '1'); }, style);
  for (const [vw, vh, tag] of [[1366, 768, 'd'], [390, 844, 'p']]) {
    await page.setViewportSize({ width: vw, height: vh });
    for (const [n, p] of routes) {
      try { await page.goto(base + p); await page.waitForTimeout(1500); await page.screenshot({ path: REPO + '/.shots/ref-' + style + '-' + tag + '-' + n + '.png' }); } catch (e) { console.log('fail', style, n, e.message); }
    }
  }
}
await finish();
