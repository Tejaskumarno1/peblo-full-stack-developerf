import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  const d = new Date(); d.setDate(d.getDate() + 1);
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:t1@test', `DTSTART:${stamp}T100000`, `DTEND:${stamp}T110000`, 'SUMMARY:Imported standup', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const file = path.join(os.tmpdir(), 'peblo-test.ics');
  fs.writeFileSync(file, ics);
  await page.goto(base + '/calendar');
  await page.locator('button', { hasText: 'Calendar file' }).click();
  check('menu lists import, export and print', (await page.locator('[role=menuitem]').allInnerTexts()).join(',') === 'Import .ics,Export .ics,Print this view');
  await page.screenshot({ path: 'D:/Peblo/_shots/cal-file-menu.png' });
  await page.locator('[data-testid="ics-input"]').setInputFiles(file);
  await page.waitForTimeout(1500);
  const r = await api('GET', '/api/todos');
  check('importing a .ics adds the meeting', (r.todos || r).some((x) => x.text === 'Imported standup'));
  await page.locator('[data-testid="ics-input"]').setInputFiles(file);
  await page.waitForTimeout(1200);
  const r2 = await api('GET', '/api/todos');
  check('importing the same file again adds no duplicate', (r2.todos || r2).filter((x) => x.text === 'Imported standup').length === 1);
  if (!(await page.locator('[role=menuitem]').count())) await page.locator('button', { hasText: 'Calendar file' }).click();
  await page.locator('[role=menuitem]', { hasText: 'Export .ics' }).waitFor();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(async () => { console.log('TOAST', await page.locator('body').innerText().then((x) => x.slice(-200))); return null; }), page.locator('[role=menuitem]', { hasText: 'Export .ics' }).click()]);
  if (!dl) throw new Error('no download');
  const out = fs.readFileSync(await dl.path(), 'utf8');
  check('export gives a calendar file with the meeting', /BEGIN:VCALENDAR/.test(out) && /Imported standup/.test(out));
} catch (e) { check('no crash', false, String(e).slice(0, 300)); }
await finish();


