// Quick add: "Peblo understood" chips, attendees, length, repeats, "by Sunday", linked note.
import { boot, REPO } from './lib.mjs';
import path from 'path';

const { base, api, page, check, finish } = await boot();
const shot = (n) => page.screenshot({ path: path.join(REPO, '.shots', n + '.png') });
await page.setViewportSize({ width: 1440, height: 900 });
try {
  await api('POST', '/api/notes', { title: 'Client call: Agile Digest', content: 'Agenda', tags: [] });
  await page.goto(base + '/');
  await page.evaluate(() => { localStorage.setItem('peblo-style', 'river'); localStorage.setItem('peblo-river-zoom', 'day'); });
  await page.goto(base + '/');
  await page.locator('.r-river').waitFor({ timeout: 12000 });
  await page.waitForTimeout(1200);

  const open = async (mode) => {
    await page.evaluate((m) => window.dispatchEvent(new CustomEvent('peblo:capture', { detail: { mode: m, text: '' } })), mode);
    await page.locator('#r-capture-input').waitFor();
  };

  // 1. a meeting with a person, a length and a note
  await open('meeting');
  await page.fill('#r-capture-input', 'Client call Friday 4pm for 30 min with Priya and Sam');
  await page.waitForTimeout(500);
  const under = page.locator('.r-under');
  check('chips: Peblo understood is shown', await under.isVisible());
  const txt = await under.innerText();
  check('chips: attendees', /With Priya, Sam/.test(txt), txt);
  check('chips: 4:00 to 4:30', /4.*4:30/.test(txt), txt);
  check('chips: linked note', /Link note: Client call: Agile Digest/.test(txt), txt);
  await shot('river7-chips');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  let todos = (await api('GET', '/api/todos')).todos || [];
  const m = todos.find((t) => /Client call/.test(t.text));
  check('meeting saved with 4:00-4:30', !!m && m.startTime === '16:00' && m.endTime === '16:30', JSON.stringify(m && [m.startTime, m.endTime]));
  check('meeting keeps attendees', !!m && JSON.stringify(m.meta && m.meta.attendees) === '["Priya","Sam"]', JSON.stringify(m && m.meta));
  check('meeting is linked to the note', !!m && !!m.noteId);

  // 2. a repeating meeting
  await open('meeting');
  await page.fill('#r-capture-input', 'Standup every weekday 10am');
  await page.waitForTimeout(400);
  check('chips: every weekday', /Every weekday/.test(await page.locator('.r-under').innerText()));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  todos = (await api('GET', '/api/todos')).todos || [];
  const s = todos.find((t) => /Standup/.test(t.text));
  check('standup repeats on weekdays', !!s && s.recurrence === 'weekdays' && s.startTime === '10:00', JSON.stringify(s && [s.recurrence, s.startTime]));

  // 3. "by Sunday"
  await open('task');
  await page.fill('#r-capture-input', 'Submit assignment by Sunday');
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  todos = (await api('GET', '/api/todos')).todos || [];
  const a = todos.find((t) => /Submit assignment/.test(t.text));
  check('"by" is not left in the title', !!a && a.text === 'Submit assignment', a && a.text);
  check('due on a Sunday', !!a && !!a.deadline && new Date(a.deadline).getDay() === 0, a && a.deadline);

  // 4. a person can remove the suggested note
  await open('meeting');
  await page.fill('#r-capture-input', 'Client call tomorrow 2pm');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Do not link that note' }).click();
  check('link can be removed', (await page.locator('.r-under').innerText()).indexOf('Link note') < 0);
} catch (e) { check('no crash', false, String(e).slice(0, 300)); await shot('river7-fail').catch(() => {}); }
await finish();

