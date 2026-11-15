// Batch 3: make a note straight from a task, linked both ways.
const { boot } = await import('./lib.mjs');
const b = await boot();
const ok = (c, m, x) => b.check(m, !!c, x);
const p = b.page;
try {
  const made = await b.api('POST', '/api/workspaces/orgs', { name: 'Studio Co', start: 'team' });
  const team = made.spaceId;
  await p.goto(b.base + '/', { waitUntil: 'networkidle' });
  await p.evaluate((sp) => localStorage.setItem('peblo-space', sp), team);
  await p.evaluate(async (sp) => {
    const t = localStorage.getItem('peblo-token');
    await fetch('/api/todos', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t, 'x-peblo-space': sp }, body: JSON.stringify({ text: 'Plan the Warangal shoot', deadline: new Date().toISOString() }) });
  }, team);
  await p.goto(b.base + '/tasks', { waitUntil: 'networkidle' });
  await p.getByText('Plan the Warangal shoot').first().click();
  await p.getByTestId('note-from-task').click();
  await p.getByText('Plan the Warangal shoot', { exact: true }).nth(1).waitFor({ timeout: 8000 }).catch(() => {});
  await p.getByRole('button', { name: 'Save', exact: true }).click();
  await p.waitForTimeout(1200);
  const res = await p.evaluate(async (sp) => {
    const t = localStorage.getItem('peblo-token');
    const h = { Authorization: 'Bearer ' + t, 'x-peblo-space': sp };
    const todos = (await fetch('/api/todos', { headers: h }).then((x) => x.json())).todos || [];
    const todo = todos.find((x) => x.text === 'Plan the Warangal shoot');
    const notes = (await fetch('/api/notes', { headers: h }).then((x) => x.json())).notes || [];
    return { noteId: todo?.note?.id || todo?.noteId, titles: notes.map((n) => n.title) };
  }, team);
  ok(res.noteId, 'the task is linked to the new note', JSON.stringify(res));
  ok(res.titles.includes('Plan the Warangal shoot'), 'the note is in the team and named after the task', JSON.stringify(res));
} catch (e) { b.check('note from task ran without error', false, e.stack || e.message); }
await b.finish();
