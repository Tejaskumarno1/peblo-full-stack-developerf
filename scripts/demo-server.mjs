// Runs the built app in a normal browser with sample data, for UI work and screenshots.
// Usage: npm run build && node scripts/demo-server.mjs [port]
// Data goes to a throwaway database in your temp folder, never your real Peblo data.
import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const port = Number(process.argv[2]) || 4777;
const tmp = mkdtempSync(path.join(os.tmpdir(), 'peblo-demo-'));
process.env.DATABASE_URL = 'file:' + path.join(tmp, 'demo.db').replace(/\\/g, '/');
process.env.PEBLO_SQL_DIR = path.resolve('server/prisma/sql');

const { startServer } = await import(pathToFileURL(path.resolve('dist/server/index.js')).href);
await startServer({ port, staticDir: path.resolve('client/dist') });
const base = `http://127.0.0.1:${port}/api`;
const post = (url, body, method = 'POST') => fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

const day = (offset, h = 17, m = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(h, m, 0, 0); return d.toISOString(); };

await post('/profile', { name: 'Aarav Reddy', settings: { defaultAiModel: 'ask' } }, 'PUT');

const notes = [
  ['DBMS · Unit 3 Normalization', '## Normal forms at a glance\n\n| Form | Rule |\n|---|---|\n| 2NF | No partial dependency on a composite key |\n| 3NF | No transitive dependency |\n| BCNF | Every determinant is a candidate key |\n\n> Revisit: decomposition example 2. I keep losing C → D when splitting.\n\n## Worked example\n\nR(A, B, C, D) with AB → C and C → D. The key is AB, so C → D is transitive and R is not in 3NF.', ['exams', 'dbms']],
  ['Internship · weekly log', 'Fixed the token refresh bug in the login API.\n\nNext: write tests for the login flow before Tuesday. Standup moved to 09:30.', ['internship']],
  ['Startup idea · campus ride-share', 'Talk to 10 hostel students first. Pricing per km vs flat per trip? Check if the college allows it.', ['ideas']],
  ['Sem 5 exam timetable', 'DBMS mid-sem · Monday 10:00 · Room B-204\nOS · Wednesday 10:00\nCN · Friday 14:00', ['exams']],
  ['Atomic Habits · chapter notes', 'Make it obvious, attractive, easy and satisfying. Habit stacking: after I brush my teeth, I review flashcards.', ['reading']],
  ['Call mom about Diwali tickets', 'Book before 5 Oct. Check Tatkal timing.', ['inbox']],
];
for (const [title, content, tags] of notes) await post('/notes', { title, content, tags });

const tasks = [
  ['Revise normalization (3NF, BCNF)', 'high', day(0, 19), ['exams']],
  ['Push login API fix for review', 'medium', day(0, 18), ['internship']],
  ['Lossless-join check for example 2', 'low', day(0, 21), ['exams']],
  ['Email Prof. Rao about the lab viva slot', 'medium', day(-1, 12), ['college']],
  ['Solve 5 questions from the 2024 paper', 'high', day(1, 10), ['exams']],
  ['Mock test · 90 minutes', 'medium', day(1, 16), ['exams']],
  ['DBMS mid-sem exam', 'high', day(2, 10), ['exams']],
  ['Reply to Priya about the mini-project', 'low', day(3, 17), ['college']],
  ['Book Diwali train tickets', 'medium', day(5, 17), ['personal']],
];
for (const [text, priority, deadline, tags] of tasks) await post('/todos', { text, priority, deadline, tags });
const done = await post('/todos', { text: 'Submit lab record', priority: 'medium', deadline: day(0, 9), tags: ['college'] });
await post(`/todos/${done.todo.id}`, { completed: true }, 'PATCH');

console.log(`Peblo demo running at http://127.0.0.1:${port}  (data: ${tmp})`);
