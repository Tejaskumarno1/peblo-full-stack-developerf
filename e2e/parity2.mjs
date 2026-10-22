// Meetings can be made in Soft Studio and Orbit too: the calendar's New meeting form, and Orbit's capture Meeting tab; Orbit notes take a picture.
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const style = async (s, to) => {
  await page.goto(base + '/tasks');
  await page.evaluate((st) => { localStorage.setItem('peblo-style', st); localStorage.setItem('peblo-orbit-help-seen', '1'); }, s);
  await page.goto(base + to);
  await page.waitForTimeout(1300);
};
const todos = async () => (await api('GET', '/api/todos')).todos || [];
const fill = async (name) => {
  const dlg = page.getByRole('dialog', { name: 'New meeting' });
  await dlg.waitFor({ timeout: 6000 });
  await dlg.getByLabel('Name').fill(name);
  await dlg.getByLabel('Starts').fill('14:00');
  await dlg.getByLabel('Ends').fill('15:30');
  await dlg.getByLabel('Meeting link (optional)').fill('https://meet.example.com/abc');
  await dlg.getByRole('button', { name: 'Add meeting' }).click();
  await dlg.waitFor({ state: 'detached', timeout: 6000 }).catch(() => {});
};
try {
  await style('soft', '/calendar');
  await page.getByRole('button', { name: /New meeting/ }).click();
  await fill('Soft planning call');
  await page.waitForTimeout(800);
  let m = (await todos()).find((x) => x.text === 'Soft planning call');
  check('soft calendar: New meeting saves it with its times', !!m && m.startTime === '14:00' && m.endTime === '15:30', JSON.stringify(m && [m.startTime, m.endTime]));
  check('soft calendar: the meeting link is kept', !!m && m.meta?.link === 'https://meet.example.com/abc', JSON.stringify(m && m.meta));

  await style('orbit', '/tasks');
  await page.getByRole('button', { name: /New meeting/ }).click();
  await fill('Orbit study call');
  await page.waitForTimeout(800);
  m = (await todos()).find((x) => x.text === 'Orbit study call');
  check('orbit due: New meeting saves it with its times', !!m && m.startTime === '14:00' && m.endTime === '15:30', JSON.stringify(m && [m.startTime, m.endTime]));

  await style('orbit', '/quick-capture');
  await page.locator('#o-capture-input').waitFor({ timeout: 12000 });
  await page.getByRole('tab', { name: 'Meeting' }).click();
  await page.locator('#o-capture-input').fill('Group revision tomorrow 4-5pm #exams');
  await page.getByRole('button', { name: 'Add meeting' }).click();
  await page.waitForTimeout(1200);
  m = (await todos()).find((x) => /Group revision/.test(x.text));
  check('orbit capture: the Meeting tab reads the time range', !!m && m.startTime === '16:00' && m.endTime === '17:00', JSON.stringify(m && [m.text, m.startTime, m.endTime]));
  check('orbit capture: the topic tag is kept', !!m && JSON.stringify(m.todoTags || m.tags || []).includes('exams'));

  // a note with a picture
  await style('orbit', '/quick-capture');
  await page.locator('#o-capture-input').waitFor({ timeout: 12000 });
  await page.getByRole('tab', { name: 'Note' }).click();
  await page.locator('#o-capture-input').fill('Diagram of a join #databases');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.locator('.o-attach input[type=file]').setInputFiles({ name: 'join.png', mimeType: 'image/png', buffer: png });
  await page.locator('.o-attach .o-chip', { hasText: 'join' }).waitFor({ timeout: 6000 });
  check('orbit capture: an attached picture is listed', true);
  await page.getByRole('button', { name: 'Save note' }).click();
  await page.waitForTimeout(1500);
  const note = ((await api('GET', '/api/notes')).notes || []).find((n) => /Diagram of a join/.test(n.title));
  check('orbit capture: the note holds the picture', !!note && /!\[[^\]]*\]\(/.test(note.content || ''), note && String(note.content).slice(0, 120));
} catch (e) { check('parity2 run finished', false, String(e).slice(0, 400)); }
await finish();
