// PEB-163/164/165/166: Orbit export and print: note/topic/map downloads, tasks to .ics/.csv, full data zip, CSV import.
import fs from 'node:fs';
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const go = async (path) => {
  await page.goto(base + '/tasks');
  await page.evaluate(() => { localStorage.setItem('peblo-style', 'orbit'); localStorage.setItem('peblo-orbit-help-seen', '1'); });
  await page.goto(base + path);
  await page.waitForTimeout(1200);
};
const grab = async (click) => {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), click()]);
  return { name: dl.suggestedFilename(), buf: fs.readFileSync(await dl.path()) };
};
try {
  const a = (await api('POST', '/api/notes', { title: 'Keys note', content: '## Primary key\n\nA **primary key** uniquely identifies a row in a table of data.', tags: ['dbms', 'keys'] })).note;
  await api('POST', '/api/notes', { title: 'Joins note', content: 'A join combines rows from two tables, matching on a shared column.', tags: ['dbms', 'joins'] });
  const at = new Date(Date.now() + 86400000); at.setHours(23, 59, 0, 0);
  await api('POST', '/api/todos', { text: 'Lab file', deadline: at.toISOString(), tags: ['dbms'], priority: 'high' });
  await api('POST', '/api/todos', { text: 'Read chapter, then "notes"', priority: 'low' });

  // PEB-163 / 166: a note
  await go('/notes/' + a.id);
  await page.getByRole('button', { name: 'More' }).click();
  let f = await grab(() => page.getByRole('menuitem', { name: 'Download as Word' }).click());
  const doc = f.buf.toString('utf8');
  check('a note downloads as Word (.doc)', f.name === 'Keys note.doc' && /<h1>Keys note<\/h1>/.test(doc) && /<strong>primary key<\/strong>/.test(doc), f.name);
  await page.getByRole('button', { name: 'More' }).click();
  f = await grab(() => page.getByRole('menuitem', { name: 'Download as PDF' }).click());
  check('..and as a PDF', f.name === 'Keys note.pdf' && f.buf.slice(0, 4).toString() === '%PDF', f.name);
  await page.evaluate(() => { window.__printed = null; window.print = () => { window.__printed = document.getElementById('peblo-print-root')?.innerText || ''; }; });
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Print' }).click();
  await page.waitForTimeout(300);
  const printed = await page.evaluate(() => window.__printed);
  check('Print gives a clean copy of just the note', typeof printed === 'string' && /Keys note/.test(printed) && /primary key/.test(printed) && !/Back to map/.test(printed), String(printed).slice(0, 80));
  const hidden = await page.evaluate(() => getComputedStyle(document.getElementById('peblo-print-root')).display);
  check('..which stays out of sight on screen', hidden === 'none');

  // a topic and the whole map
  await go('/');
  await page.getByRole('button', { name: /^Keys/ }).first().click();
  await page.getByRole('button', { name: 'Download' }).first().click();
  f = await grab(() => page.getByRole('menuitem', { name: 'Markdown (.md)' }).click());
  check('a topic downloads as Markdown', f.name === 'Keys.md' && /# Keys note/.test(f.buf.toString()) && !/Joins note/.test(f.buf.toString()), f.name);
  await page.getByRole('button', { name: 'Close' }).first().click();
  await page.getByRole('button', { name: 'Download' }).first().click();
  f = await grab(() => page.getByRole('menuitem', { name: 'Markdown (.md)' }).click());
  const all = f.buf.toString();
  check('the whole space downloads as one Markdown file', /# Keys note/.test(all) && /# Joins note/.test(all), f.name);

  // PEB-164 tasks
  await go('/tasks');
  await page.getByRole('button', { name: /^Export/ }).click();
  f = await grab(() => page.getByRole('menuitem', { name: /Calendar file/ }).click());
  const ics = f.buf.toString();
  check('tasks export as a calendar file', f.name.endsWith('.ics') && /^BEGIN:VCALENDAR/.test(ics) && /SUMMARY:Lab file/.test(ics) && /VTODO/.test(ics));
  await page.getByRole('button', { name: /^Export/ }).click();
  f = await grab(() => page.getByRole('menuitem', { name: /Spreadsheet/ }).click());
  const csv = f.buf.toString();
  check('..and as CSV, with commas and quotes safe', f.name.endsWith('.csv') && /Task,Done,Priority/.test(csv) && /"Read chapter, then ""notes"""/.test(csv));
  await page.getByLabel('Filter by priority').selectOption('high');
  await page.getByRole('button', { name: /^Export filtered/ }).click();
  f = await grab(() => page.getByRole('menuitem', { name: /Spreadsheet/ }).click());
  check('a filtered list exports only what is shown', /Lab file/.test(f.buf.toString()) && !/Read chapter/.test(f.buf.toString()));

  // PEB-165 settings: everything, and import
  await page.evaluate(() => window.dispatchEvent(new Event('peblo:open-settings')));
  await page.getByRole('button', { name: 'Your Data' }).click();
  f = await grab(() => page.getByRole('button', { name: 'Download everything (.zip)' }).click());
  const z = f.buf.toString('latin1');
  check('"Download all my data" gives a zip with notes, tasks and settings', f.buf[0] === 0x50 && f.buf[1] === 0x4b && z.includes('notes/Keys note.md') && z.includes('tasks.csv') && z.includes('tasks.ics') && z.includes('settings.json'), f.name);
  await page.getByLabel('Choose a tasks CSV file').setInputFiles({ name: 't.csv', mimeType: 'text/csv', buffer: Buffer.from('Task,Priority,Due date\nImported task,high,2026-12-01\n,low,\n') });
  const st = await page.getByRole('status').first().innerText();
  check('importing shows a preview with the skipped row', /1 task will be added/.test(st) && /1 row skipped/.test(st), st);
  check('..and nothing is saved before you confirm', !(await api('GET', '/api/todos')).todos.some((t) => t.text === 'Imported task'));
  await page.getByRole('button', { name: 'Add 1 task' }).click();
  await page.getByText('Added 1 task.').waitFor({ timeout: 8000 });
  const t = (await api('GET', '/api/todos')).todos.find((x) => x.text === 'Imported task');
  check('confirming creates the task', !!t && t.priority === 'high');
} catch (e) {
  console.log('FAIL: test crashed', e.message);
  process.exitCode = 1;
}
await finish();
