// Puts fake demo tasks, meetings and notes into ONE existing account, by email. No password needed:
// it writes straight to the database the server is configured for (server/.env).
//
//   node scripts/seed-demo.mjs --email you@example.com            add demo data
//   node scripts/seed-demo.mjs --email you@example.com --remove   take it out again
//   add --db test to use the peblo_test database instead of the one in server/.env
//
// Everything it creates is marked (tasks carry the tag "demo-data", notes the category "Demo data"),
// so --remove deletes only what this script added and never touches anything else.
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

export const TAG = 'demo-data';
export const CATEGORY = 'Demo data';

const at = (days, h, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(h, m, 0, 0);
  return d;
};
const hhmm = (h, m = 0) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

function demoTodos() {
  const t = (text, deadline, extra = {}) => ({ text, deadline, priority: 'medium', ...extra });
  return [
    // overdue
    t('Renew library membership', at(-2, 23, 59), { priority: 'low' }),
    t('Send invoice to design client', at(-1, 17, 0), { priority: 'high' }),
    // today
    t('Revise DBMS normalisation notes', at(0, 11, 0), { priority: 'high' }),
    t('Reply to internship mentor', at(0, 15, 30)),
    t('Pay phone bill', at(0, 23, 59), { priority: 'low' }), // all-day
    t('Morning workout', at(0, 6, 30), { completed: true, priority: 'low' }),
    // meetings (have start/end time)
    t('Daily stand-up', at(0, 10, 0), { startTime: hhmm(10), endTime: hhmm(10, 30), tags: ['meeting'] }),
    t('Content planning with team', at(0, 16, 0), { startTime: hhmm(16), endTime: hhmm(17), tags: ['meeting'] }),
    t('Project demo review', at(1, 12, 0), { startTime: hhmm(12), endTime: hhmm(13), tags: ['meeting'] }),
    // coming days
    t('Record Instagram reel: study tips', at(1, 18, 0)),
    t('Submit college assignment 3', at(2, 23, 59), { priority: 'high' }),
    t('Buy birthday gift', at(3, 14, 0)),
    t('Mock interview: arrays and strings', at(4, 19, 0), { priority: 'high' }),
    t('Plan next week', at(6, 20, 0), { priority: 'low' }),
    // no date
    t('Learn Docker basics', null, { priority: 'low' }),
    t('Organise Google Drive', null, { priority: 'low' }),
  ];
}

function demoNotes() {
  return [
    ['Normalisation cheat sheet', '1NF: atomic values.\n2NF: no partial dependency on a composite key.\n3NF: no transitive dependency.\nBCNF: every determinant is a candidate key.'],
    ['Content ideas: October', '- Study with me (2 h)\n- 5 tools I use as a student developer\n- Day in the life: college + internship\n- Reel: how I plan my week'],
    ['Internship log', 'Mon: set up the project locally.\nTue: fixed the date picker bug.\nWed: wrote tests for the series logic.\nQuestions for mentor: how do we version the API?'],
    ['Interview prep: patterns', 'Two pointers, sliding window, prefix sums, binary search on answer, BFS/DFS on grids.\nRevisit one pattern per day and write the variations yourself.'],
    ['Startup idea scratchpad', 'Problem: students juggle notes, tasks and deadlines in 4 apps.\nIdea: one calm place where the AI links them.\nNext: talk to 5 classmates this week.'],
    ['Meeting notes: project demo', 'Agenda: calendar sync, voice call reminders, River view.\nDecisions: ship the settings page first.\nAction: share the build with the team by Friday.'],
  ];
}

export async function seed(prisma, userId) {
  const mine = await prisma.todo.findMany({ where: { userId }, select: { todoTags: true } });
  if (mine.some((t) => Array.isArray(t.todoTags) && t.todoTags.includes(TAG))) return { skipped: 'demo data is already there' };
  const todos = demoTodos();
  for (const x of todos) {
    await prisma.todo.create({
      data: {
        userId, text: x.text, deadline: x.deadline, priority: x.priority, completed: !!x.completed,
        startTime: x.startTime || null, endTime: x.endTime || null, todoTags: [TAG, ...(x.tags || [])],
      },
    });
  }
  const notes = demoNotes();
  for (const [title, content] of notes) await prisma.note.create({ data: { userId, title, content, category: CATEGORY } });
  return { todos: todos.length, notes: notes.length };
}

export async function unseed(prisma, userId) {
  const all = await prisma.todo.findMany({ where: { userId }, select: { id: true, todoTags: true } });
  const ids = all.filter((t) => Array.isArray(t.todoTags) && t.todoTags.includes(TAG)).map((t) => t.id);
  const a = ids.length ? await prisma.todo.deleteMany({ where: { id: { in: ids }, userId } }) : { count: 0 };
  const b = await prisma.note.deleteMany({ where: { userId, category: CATEGORY } });
  return { todos: a.count, notes: b.count };
}

// ---- command line ----
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined; };
  const email = (arg('--email') || '').trim().toLowerCase();
  if (!email) { console.error('Usage: node scripts/seed-demo.mjs --email you@example.com [--remove] [--db test]'); process.exit(1); }
  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { default: dotenv } = await import('dotenv');
  const env = dotenv.parse(fs.readFileSync(path.join(REPO, 'server', '.env'), 'utf8'));
  Object.assign(process.env, env);
  if (arg('--db') === 'test') process.env.DATABASE_URL = env.DATABASE_URL.replace(/\/peblo(\?.*)?$/, '/peblo_test$1');
  const where = process.env.DATABASE_URL.replace(/\/\/[^@]*@/, '//***@');
  const { default: prisma } = await import(pathToFileURL(path.join(REPO, 'dist', 'server', 'db.js')).href);
  try {
    const user = await prisma.user.findFirst({ where: { email } });
    if (!user) { console.error(`No account with the email ${email} in ${where}. Nothing changed.`); process.exit(2); }
    console.log(`Database: ${where}\nAccount:  ${email}`);
    const res = process.argv.includes('--remove') ? await unseed(prisma, user.id) : await seed(prisma, user.id);
    console.log(process.argv.includes('--remove') ? 'Removed demo data:' : 'Added demo data:', JSON.stringify(res));
  } finally { await prisma.$disconnect(); }
  process.exit(0);
}
