// scripts/seed-demo.mjs: adds fake data to one account, is safe to run twice, and --remove takes out only its own rows.
import path from 'path';
import { pathToFileURL } from 'url';
import { boot, REPO } from './lib.mjs';

const { api, check, finish, email } = await (async () => { const b = await boot(); return { ...b, email: null }; })();
try {
  const { default: prisma } = await import(pathToFileURL(path.join(REPO, 'dist', 'server', 'db.js')).href);
  const { seed, unseed } = await import(pathToFileURL(path.join(REPO, 'scripts', 'seed-demo.mjs')).href);
  const me = await api('GET', '/api/profile');
  const userId = (me.user || me).id;
  await api('POST', '/api/todos', { text: 'my real task' });
  await api('POST', '/api/notes', { title: 'my real note', content: 'keep me' });

  const r = await seed(prisma, userId);
  const todos = (await api('GET', '/api/todos')).todos;
  const notes = (await api('GET', '/api/notes')).notes;
  check('seed adds the demo tasks', todos.length === r.todos + 1, `${todos.length} vs ${r.todos}`);
  check('seed adds the demo notes', notes.length === r.notes + 1, `${notes.length} vs ${r.notes}`);
  check('there are meetings, all-day, overdue, undated and done tasks',
    todos.some((t) => t.startTime) && todos.some((t) => t.deadline && new Date(t.deadline).getHours() === 23 && !t.startTime)
    && todos.some((t) => t.deadline && new Date(t.deadline) < new Date() && !t.completed) && todos.some((t) => !t.deadline) && todos.some((t) => t.completed));
  const again = await seed(prisma, userId);
  check('running it twice does not duplicate', !!again.skipped && (await api('GET', '/api/todos')).todos.length === todos.length);

  const gone = await unseed(prisma, userId);
  const todos2 = (await api('GET', '/api/todos')).todos;
  const notes2 = (await api('GET', '/api/notes')).notes;
  check('--remove deletes what it added', gone.todos === r.todos && gone.notes === r.notes, JSON.stringify(gone));
  check('and leaves the person\'s own data alone', todos2.length === 1 && todos2[0].text === 'my real task' && notes2.length === 1 && notes2[0].title === 'my real note');
} catch (e) { console.error(e); check('script ran to the end', false, e.message); }
await finish();
