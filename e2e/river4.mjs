// River meeting notes: template on a new meeting note, "last time" card, after-meeting actions.
import { boot, REPO } from './lib.mjs';
import path from 'path';

const { base, api, page, check, finish } = await boot();
const shot = (n) => page.screenshot({ path: path.join(REPO, '.shots', n + '.png') });
await page.setViewportSize({ width: 1440, height: 900 });
try {
  const day = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d.toISOString(); };
  const prevNote = (await api('POST', '/api/notes', { title: 'Weekly sync - last week', content: 'Sam sends the deck.', tags: [] })).note;
  await api('POST', '/api/todos', { text: 'Weekly sync', deadline: day(-7), startTime: '10:00', endTime: '11:00', noteId: prevNote.id });
  await api('POST', '/api/todos', { text: 'Weekly sync', deadline: day(1), startTime: '10:00', endTime: '11:00' });
  const before = ((await api('GET', '/api/notes')).notes || []).length;

  await page.goto(base + '/');
  await page.evaluate(() => { localStorage.setItem('peblo-style', 'river'); localStorage.setItem('peblo-river-zoom', 'day'); });
  await page.goto(base + '/');
  await page.locator('.r-river').waitFor({ timeout: 12000 });
  await page.waitForTimeout(1500);
  await page.locator('.r-meet', { hasText: 'Weekly sync' }).last().click();
  await page.getByRole('button', { name: 'Take notes in this meeting' }).click();
  const ed = page.locator('.bn-editor');
  await ed.waitFor({ timeout: 12000 });
  await page.waitForTimeout(1200);
  const text = await ed.innerText();
  check('template: sections are there', /Agenda/.test(text) && /Decisions/.test(text) && /Action items/.test(text) && /When:/.test(text), text.slice(0, 120));
  const mid = ((await api('GET', '/api/notes')).notes || []).length;
  check('template: nothing is saved until you write', mid === before, `${before} -> ${mid}`);
  await page.locator('#r-note-title').fill('Weekly sync - this week');
  await page.waitForTimeout(2500);
  const after = ((await api('GET', '/api/notes')).notes || []);
  const made = after.find((n) => n.title === 'Weekly sync - this week');
  check('template: writing a title saves the note with the template', !!made && /Decisions/.test(made.content || ''), String(made && made.content).slice(0, 80));

  await page.waitForTimeout(1200);
  const last = page.getByRole('heading', { name: /LAST TIME/ });
  check('last time: the earlier meeting notes are linked', await last.waitFor({ timeout: 8000 }).then(() => true).catch(() => false) && (await page.getByText('Weekly sync - last week').count()) > 0);
  check('after: copy and follow-up buttons show', (await page.getByRole('button', { name: 'Copy notes' }).count()) === 1 && (await page.getByRole('button', { name: 'Schedule a follow-up' }).count()) === 1);
  await shot('river4-meeting-note');
  await page.getByRole('button', { name: 'Schedule a follow-up' }).click();
  check('after: follow-up opens quick add as a meeting', await page.locator('#r-capture-input').inputValue().then((v) => /Follow-up: Weekly sync/.test(v)).catch(() => false));
} catch (e) { check('no crash', false, String(e).slice(0, 300)); await shot('river4-fail').catch(() => {}); }
await finish();
