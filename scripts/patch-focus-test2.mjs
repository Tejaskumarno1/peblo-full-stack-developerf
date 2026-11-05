import fs from 'node:fs';
const f = 'e2e/tasks-focus.mjs';
let s = fs.readFileSync(f, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing ' + a.slice(0, 50)); s = s.replace(a, () => b); };
rep("  const exam = (await api('POST', '/api/notes', { title: 'Exam plan', content: 'Week plan', tags: [] })).note;\n", '');
rep("  await api('PATCH', `/api/todos/${bcnf.id}`, { noteId: work.id });", "  await api('PATCH', `/api/todos/${bcnf.id}`, { noteId: work.id });\n  await api('POST', '/api/notes', { title: 'Exam plan', content: 'Week plan: [[Databases revision]]', tags: [] });");
rep("check('the working note is on the right with its text', await page.getByText('every determinant is a candidate key').first().isVisible().catch(() => false), '');", "check('the working note is on the right with its text', await page.getByText('every determinant is a candidate key').first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false), '');\n  check('a strip says which other notes mention it', await page.getByText(/Mentioned in 1 other note/).first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false), '');");
fs.writeFileSync(f, s);
console.log('ok');
