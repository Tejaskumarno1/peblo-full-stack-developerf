// Meeting note action items -> river, and "Suggest times for all" in the week tray.
import { boot, REPO } from './lib.mjs';
import path from 'path';

const { base, api, page, check, finish } = await boot();
const shot = (n) => page.screenshot({ path: path.join(REPO, '.shots', n + '.png') });
await page.setViewportSize({ width: 1440, height: 900 });
try {
  const day = (n, h) => { const d = new Date(); d.setHours(h || 0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
  // --- action items ---
  const { note } = await api('POST', '/api/notes', {
    title: 'Client call notes',
    content: '## Action items\n\n- [ ] Priya: Send November calendar draft friday\n- [ ] Share newsletter wireframes monday 11am\n- [x] Already done thing\n',
    tags: [],
  });
  await page.goto(base + '/');
  await page.evaluate(() => { localStorage.setItem('peblo-style', 'river'); localStorage.setItem('peblo-river-zoom', 'week'); });
  await page.goto(base + '/notes/' + note.id);
  await page.getByText('ACTION ITEMS · 2 FOUND').waitFor({ timeout: 12000 });
  check('action items: two unchecked lines found, the checked one is skipped', (await page.locator('#r-acts').count()) === 1 && !(await page.locator('#r-acts').locator('xpath=..').getByText('Already done thing').count()));
  check('action items: owner is read', await page.getByText(/Owner Priya/).isVisible());
  await shot('river8-acts');
  await page.getByRole('button', { name: /Put all 2 on the river/ }).click();
  await page.waitForTimeout(1500);
  const todos = (await api('GET', '/api/todos')).todos || [];
  const a = todos.find((t) => t.text === 'Send November calendar draft (Priya)');
  const b = todos.find((t) => t.text === 'Share newsletter wireframes');
  check('put all: both are tasks linked to the note', !!a && !!b && a.noteId === note.id && b.noteId === note.id, JSON.stringify([a && a.text, b && b.text]));
  check('put all: the dates were read', !!a && !!a.deadline && new Date(a.deadline).getDay() === 5 && !!b && new Date(b.deadline).getDay() === 1);
  check('put all: they show as on the river', (await page.getByText('On the river', { exact: true }).count()) >= 2);

  // --- suggest times ---
  await api('POST', '/api/todos', { text: 'Sprint planning', deadline: day(1).toISOString(), startTime: '09:00', endTime: '12:00' });
  await api('POST', '/api/todos', { text: 'Write November report', priority: 'medium' });
  await api('POST', '/api/todos', { text: 'Update portfolio', priority: 'medium' });
  await page.goto(base + '/');
  await page.locator('.r-river').waitFor({ timeout: 12000 });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /Suggest times for all/ }).click();
  await page.waitForTimeout(2000);
  const after = (await api('GET', '/api/todos')).todos || [];
  const r1 = after.find((t) => t.text === 'Write November report');
  const r2 = after.find((t) => t.text === 'Update portfolio');
  check('suggest: both tasks got a time', !!r1?.deadline && !!r2?.deadline, JSON.stringify([r1?.deadline, r2?.deadline]));
  const clashes = [r1, r2].filter(Boolean).some((t) => { const d = new Date(t.deadline); const bd = day(1); return d.toDateString() === bd.toDateString() && d.getHours() >= 9 && d.getHours() < 12; });
  check('suggest: nothing lands inside the meeting', !clashes);
  check('suggest: the two tasks do not share a time', !!r1 && !!r2 && r1.deadline !== r2.deadline);
  check('suggest: the tray is empty afterwards', (await page.locator('.r-pebble').count()) === 0);
} catch (e) { check('no crash', false, String(e).slice(0, 300)); await shot('river8-fail').catch(() => {}); }
await finish();

