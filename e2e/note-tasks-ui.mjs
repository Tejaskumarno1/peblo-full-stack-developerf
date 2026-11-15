// Batch 3: unchecked items of a team note become linked tasks.
const { boot } = await import('./lib.mjs');
const b = await boot();
const ok = (c, m, x) => b.check(m, !!c, x);
const p = b.page;
try {
  const made = await b.api('POST', '/api/workspaces/orgs', { name: 'Studio Co', start: 'team' });
  const team = made.spaceId;
  await p.goto(b.base + '/', { waitUntil: 'networkidle' });
  await p.evaluate((sp) => localStorage.setItem('peblo-space', sp), team);
  const note = await p.evaluate(async (sp) => {
    const t = localStorage.getItem('peblo-token');
    const r = await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t, 'x-peblo-space': sp }, body: JSON.stringify({ title: 'Kickoff', content: '# Kickoff\n\n## Action items\n- [ ] Book the venue\n- [ ] Send the brief\n- [x] Pick a date\n' }) });
    return (await r.json()).note;
  }, team);
  ok(note?.id, 'a team note with checklist items exists');
  await p.goto(b.base + '/notes/' + note.id, { waitUntil: 'networkidle' });
  await p.getByTestId('nt-open').waitFor({ timeout: 10000 });
  ok(/2 unchecked items/.test(await p.getByTestId('nt-open').innerText()), 'two unchecked items are offered, the checked one is not');
  await p.getByTestId('nt-open').click();
  await p.getByTestId('nt-create').click();
  await p.getByTestId('nt-msg').waitFor({ timeout: 8000 });
  ok(/Created 2 tasks/.test(await p.getByTestId('nt-msg').innerText()), 'tasks are created');
  const res = await p.evaluate(async ({ sp, id }) => {
    const t = localStorage.getItem('peblo-token');
    const todos = (await fetch('/api/todos', { headers: { Authorization: 'Bearer ' + t, 'x-peblo-space': sp } }).then((x) => x.json())).todos || [];
    return todos.filter((x) => (x.note?.id || x.noteId) === id).map((x) => x.text).sort();
  }, { sp: team, id: note.id });
  ok(res.length === 2 && res[0] === 'Book the venue', 'both tasks are linked to the note', JSON.stringify(res));
} catch (e) {
  b.check('no crash: ' + (e.message || e).toString().split('\n')[0], false);
}
await b.finish();
