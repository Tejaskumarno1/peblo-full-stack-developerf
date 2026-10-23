// Round 14: Orbit back up everything and restore from a file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { boot } from './lib.mjs';
const { base, api, page, check, finish } = await boot();
const go = async (p) => {
  await page.goto(base + '/tasks');
  await page.evaluate(() => { localStorage.setItem('peblo-style', 'orbit'); localStorage.setItem('peblo-orbit-help-seen', '1'); });
  await page.goto(base + p);
  await page.waitForTimeout(1500);
};
const notes = async () => { const r = await api('GET', '/api/notes'); return r.notes || r; };
try {
  const n = (await api('POST', '/api/notes', { title: 'Backup me', content: 'Some **text**', tags: ['dbms'] })).note;
  await api('POST', '/api/todos', { text: 'Task on note', noteId: n.id, priority: 'high' });
  await api('POST', '/api/todos', { text: 'Plain task' });

  const bk = await api('GET', '/api/backup');
  check('the backup API returns notes and tasks', bk.format === 'peblo-backup' && bk.notes.length === 1 && bk.todos.length === 2);
  check('..with topics on the notes', bk.notes[0].tags.includes('dbms'));

  await go('/');
  await page.getByRole('button', { name: 'Your menu' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Back up everything' }).click()]);
  const file = path.join(os.tmpdir(), 'peblo-test-backup.json');
  await dl.saveAs(file);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  check('Back up everything downloads a .json file', dl.suggestedFilename().endsWith('.json') && saved.notes.length === 1 && saved.todos.length === 2);
  check('..and says what it saved', (await page.getByText('Backed up 1 notes and 2 tasks.').count()) === 1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Close' }).click().catch(() => {});

  await page.getByRole('button', { name: 'Your menu' }).click();
  await page.getByRole('menuitem', { name: 'Restore from a backup' }).click();
  const bad = path.join(os.tmpdir(), 'peblo-bad.json');
  fs.writeFileSync(bad, '{"hello":1}');
  await page.getByLabel('Backup file').setInputFiles(bad);
  await page.waitForTimeout(400);
  check('a file that is not a backup is refused', (await page.getByText('does not look like a Peblo backup').count()) === 1);
  await page.getByLabel('Backup file').setInputFiles(file);
  await page.waitForTimeout(400);
  check('a real backup shows what it holds first', (await page.getByRole('dialog', { name: 'Backup and restore' }).innerText()).includes('1 notes') || (await page.getByRole('dialog', { name: 'Backup and restore' }).innerText()).includes('1 note'));
  await page.getByRole('button', { name: 'Restore now' }).click();
  await page.waitForTimeout(1500);
  check('restoring says how much came back', (await page.getByText('Restored 1 notes and 2 tasks.').count()) === 1);
  const after = await notes();
  check('..the note is back as a copy next to the original', after.filter((x) => x.title === 'Backup me').length === 2);
  check('..with its topic and text', after.filter((x) => x.title === 'Backup me').every((x) => (x.tags || []).includes('dbms') && /text/.test(x.content)));
  const todos = (await api('GET', '/api/todos')).todos;
  check('..and the tasks are back (4 in all)', todos.length === 4);
  const copy = after.find((x) => x.title === 'Backup me' && x.id !== n.id);
  check('..the task stays linked to its restored note', todos.some((t) => t.text === 'Task on note' && t.noteId === copy.id));
  const rej = await fetch(base + '/api/restore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  check('the restore API needs a signed-in user', rej.status === 401);

  // Example data
  const before = (await notes()).length;
  await go('/');
  await page.getByRole('button', { name: 'Your menu' }).click();
  await page.getByRole('menuitem', { name: 'Try with example data' }).click();
  await page.waitForTimeout(1500);
  check('Try with example data adds sample notes and tasks', (await page.getByText('Added 4 example notes and 3 example tasks').count()) === 1);
  check('..the notes really exist', (await notes()).length === before + 4);
  const dup = await api('POST', '/api/example');
  check('adding it twice is refused', !!dup.error && !dup.added, JSON.stringify(dup));
  await page.getByRole('dialog', { name: 'Backup and restore' }).getByRole('button', { name: 'Close' }).click();
  await page.waitForTimeout(600);
  check('the map shows the sample topics', (await page.locator('.o-node .ball', { hasText: /Sample/i }).count()) >= 2);
  check('..but not the marker topic', (await page.locator('.o-node .ball', { hasText: /Example data/i }).count()) === 0);
  await page.getByRole('button', { name: 'Your menu' }).click();
  check('the menu now offers to clear it', (await page.getByRole('menuitem', { name: 'Clear example data' }).count()) === 1);
  await page.getByRole('menuitem', { name: 'Clear example data' }).click();
  await page.waitForTimeout(1500);
  check('Clear example data says what it removed', (await page.getByText('Removed 4 example notes and 3 example tasks').count()) === 1);
  const left = await notes();
  check('..and only the example notes are gone', left.length === before && left.some((x) => x.title === 'Backup me'));
  check('..and only the example tasks', (await api('GET', '/api/todos')).todos.every((t) => !/\(example\)/.test(t.text)) && (await api('GET', '/api/todos')).todos.length === 4);
} catch (e) {
  check('script ran to the end', false, String(e).slice(0, 300));
}
await finish();
