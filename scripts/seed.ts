// Fills a test account with realistic sample data: notes, tags, tasks, quizzes, mastery,
// AI summaries and meeting promises. Run:  npx tsx scripts/seed.ts [email]
// It REPLACES that account's notes, tasks and study data, so only use it on a test account.
import '../server/src/env.js';
import bcrypt from 'bcryptjs';
import prisma from '../server/src/db.js';
import { initDatabase } from '../server/src/db.js';

const email = (process.argv[2] || 'tejas@test.com').toLowerCase();

const at = (offset: number, h = 12, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(h, m, 0, 0);
  return d;
};

await initDatabase();

let user = await prisma.user.findUnique({ where: { email } });
if (!user) {
  user = await prisma.user.create({
    data: { email, name: 'Tejas', passwordHash: await bcrypt.hash('password123', 12), settings: {} },
  });
}
const userId = user.id;

// Start clean for this account.
await prisma.quizRun.deleteMany({ where: { userId } });
await prisma.topicMastery.deleteMany({ where: { userId } });
await prisma.aiGeneration.deleteMany({ where: { userId } });
await prisma.todo.deleteMany({ where: { userId } });
await prisma.note.deleteMany({ where: { userId } }); // cascades note tags, backups
await prisma.tag.deleteMany({ where: { userId } });

const tagIds = new Map<string, string>();
async function tagId(name: string) {
  if (!tagIds.has(name)) {
    const t = await prisma.tag.create({ data: { userId, name } });
    tagIds.set(name, t.id);
  }
  return tagIds.get(name)!;
}

interface N {
  title: string; content: string; tags: string[]; category?: string;
  created: Date; archived?: boolean; deleted?: boolean;
}
async function addNote(n: N) {
  const note = await prisma.note.create({
    data: {
      userId, title: n.title, content: n.content, category: n.category ?? null,
      isArchived: !!n.archived, isDeleted: !!n.deleted, deletedAt: n.deleted ? n.created : null,
      createdAt: n.created, updatedAt: n.created,
    },
  });
  for (const t of n.tags) await prisma.noteTag.create({ data: { noteId: note.id, tagId: await tagId(t) } });
  return note;
}

// ---- Notes ---------------------------------------------------------------------------
const main: N[] = [
  { title: 'DBMS · Unit 3 Normalization', category: 'College', tags: ['dbms', 'exams'], created: at(0, 8, 40),
    content: '## Normal forms at a glance\n\n| Form | Rule |\n|---|---|\n| 1NF | Atomic values, no repeating groups |\n| 2NF | No partial dependency on a composite key |\n| 3NF | No transitive dependency |\n| BCNF | Every determinant is a candidate key |\n\n> Revisit: decomposition example 2. I keep losing C → D when splitting.\n\n## Worked example\n\nR(A, B, C, D) with AB → C and C → D. The key is AB, so C → D is transitive and R is not in 3NF.\n\nDecompose into R1(A, B, C) and R2(C, D). Both are in 3NF and the join is lossless because C is the key of R2.' },
  { title: 'DBMS · Transactions and ACID', category: 'College', tags: ['dbms', 'exams'], created: at(-1, 21, 10),
    content: '## ACID\n\n- **Atomicity**: all or nothing\n- **Consistency**: constraints hold before and after\n- **Isolation**: concurrent transactions do not see each other half-done\n- **Durability**: committed data survives a crash\n\n## Isolation levels\n\nRead uncommitted → read committed → repeatable read → serializable. Each level removes one anomaly: dirty read, non-repeatable read, phantom read.\n\nTodo: practise drawing precedence graphs for conflict serializability.' },
  { title: 'OS · Scheduling algorithms', category: 'College', tags: ['os', 'exams'], created: at(-2, 19, 30),
    content: '## CPU scheduling\n\n| Algorithm | Preemptive | Weakness |\n|---|---|---|\n| FCFS | No | Convoy effect |\n| SJF | Optional | Starvation of long jobs |\n| Round robin | Yes | Quantum choice matters |\n| Priority | Optional | Starvation, fix with aging |\n\nRound robin with quantum 4: P1(10) P2(5) P3(8). Average waiting time works out to 11.67.\n\nTime quantum too small means too many context switches. Too large means it degrades to FCFS.' },
  { title: 'OS · Deadlocks', category: 'College', tags: ['os'], created: at(-4, 20, 0),
    content: 'Four conditions: mutual exclusion, hold and wait, no preemption, circular wait. Break any one and deadlock cannot happen.\n\nBanker\'s algorithm: grant a request only if the system stays in a safe state.\n\nQuestion for Prof: why is deadlock detection with a wait-for graph cheaper than the Banker\'s check?' },
  { title: 'Computer Networks · TCP vs UDP', category: 'College', tags: ['cn', 'exams'], created: at(-3, 18, 20),
    content: '## TCP\nConnection oriented, three-way handshake, ordered and reliable, flow control with a sliding window, congestion control.\n\n## UDP\nConnectionless, no ordering, tiny header. Used for DNS, video calls and games.\n\n**Remember:** SYN, SYN-ACK, ACK. Closing takes four steps because each side closes on its own.' },
  { title: 'Sem 5 exam timetable', category: 'College', tags: ['exams'], created: at(-6, 10, 0),
    content: 'DBMS mid-sem · Monday 10:00 · Room B-204\nOS · Wednesday 10:00 · Room B-101\nCN · Friday 14:00 · Room A-305\n\nBring hall ticket and ID card. No smart watches.' },
  { title: 'Internship · weekly log', category: 'Work', tags: ['internship', 'agile-digest'], created: at(0, 17, 30),
    content: '## This week at Agile Digest\n\nFixed the token refresh bug in the login API. Pairing with Rohit on the notification service.\n\nNext: write tests for the login flow before Tuesday. Standup moved to 09:30.\n\nI will send the sprint summary to Meera by Friday.' },
  { title: 'Internship · sprint planning', category: 'Work', tags: ['internship', 'agile-digest', 'meetings'], created: at(-2, 11, 0),
    content: '## Sprint planning, Monday\n\nAttendees: Meera, Rohit, Sanjana, me.\n\n- Meera will share the new design file by Wednesday.\n- Rohit to review my pull request tomorrow.\n- I will add pagination to the reports endpoint by Thursday.\n- Sanjana is checking the staging database access and will confirm next week.\n\nDecision: ship the dashboard in two parts. Charts first, filters later.' },
  { title: 'Startup idea · campus ride-share', category: 'Ideas', tags: ['ideas', 'startup'], created: at(-5, 22, 15),
    content: 'Talk to 10 hostel students first. Pricing per km vs flat per trip? Check if the college allows it.\n\nWhy it could work: a fixed set of routes (hostel, main gate, bus stand, railway station) and the same people every day.\n\nRisks: insurance, drivers, getting both sides at once. Start with a WhatsApp group and a Google Sheet before any app.' },
  { title: 'Startup idea · notes for exam toppers', category: 'Ideas', tags: ['ideas', 'startup'], created: at(-9, 21, 0),
    content: 'Sell topper handwritten notes as short paid bundles per subject. Quality control is the hard part. Maybe partner with 3 seniors first and split revenue 70/30.' },
  { title: 'Atomic Habits · chapter notes', category: 'Reading', tags: ['reading', 'habits'], created: at(-7, 22, 0),
    content: 'Make it obvious, attractive, easy and satisfying.\n\nHabit stacking: after I brush my teeth, I review flashcards for 5 minutes.\n\nTwo-minute rule: scale any habit down to something that takes two minutes. Start there.' },
  { title: 'Book list · 2026', category: 'Reading', tags: ['reading'], created: at(-20, 20, 0),
    content: '- [x] Atomic Habits\n- [ ] Deep Work\n- [ ] The Psychology of Money\n- [ ] Zero to One\n- [ ] Clean Code' },
  { title: 'Call mom about Diwali tickets', category: 'Personal', tags: ['personal', 'inbox'], created: at(-1, 9, 30),
    content: 'Book before 12 Oct. Check Tatkal timing. Hanamkonda to Kazipet is the cheaper station.' },
  { title: 'Gym plan', category: 'Personal', tags: ['personal', 'health'], created: at(-11, 7, 0),
    content: '## Weekly split\nMon push · Tue pull · Wed legs · Thu rest · Fri full body · Sat walk\n\nTrack: bench 40 kg x 8, squat 60 kg x 8. Increase by 2.5 kg when I hit all reps twice.' },
  { title: 'Peblo · feature wishlist', category: 'Ideas', tags: ['ideas', 'peblo'], created: at(-3, 23, 0),
    content: '- Share a note as a link\n- Voice capture on mobile\n- Weekly review that suggests what to revise\n- Import from Notion and Google Keep\n- Offline mode with sync' },
  { title: 'LeetCode · patterns I keep forgetting', category: 'College', tags: ['dsa', 'practice'], created: at(-8, 21, 30),
    content: 'Two pointers for sorted arrays. Sliding window when the problem says "contiguous". Monotonic stack for next greater element. BFS for shortest path in an unweighted grid.\n\nGoal: 3 problems a day this week.' },
  { title: 'Private journal', category: 'Personal', tags: ['private'], created: at(-2, 23, 45),
    content: 'This note is private and should never be sent to any AI. Feeling stressed about exams and the internship deadline at once.' },
  { title: 'Old resume draft', category: 'Work', tags: ['career'], created: at(-60, 12, 0), archived: true,
    content: 'Archived draft from before the internship. Skills list needs updating.' },
  { title: 'Scratch note', category: 'Personal', tags: ['inbox'], created: at(-14, 12, 0), deleted: true,
    content: 'Deleted note that should appear only in the trash.' },
];
const notes: Record<string, { id: string }> = {};
for (const n of main) notes[n.title] = await addNote(n);

// Light daily-log notes across the last ~17 weeks so the heatmap and streak have history.
let filler = 0;
for (let i = 1; i <= 118; i++) {
  if (i % 3 === 0 || i % 7 === 0) continue;
  const d = at(-i, 20, i % 50);
  await addNote({
    title: `Daily log · ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`,
    category: 'Journal', tags: i % 2 ? ['daily'] : ['daily', 'reflection'], created: d,
    content: `Studied for ${1 + (i % 4)} hours. ${i % 5 === 0 ? 'Skipped the gym.' : 'Went for a short walk.'} Tomorrow: revise one chapter and reply to pending messages.`,
  });
  filler++;
}

// Backups (older versions of a note) and AI summaries.
await prisma.noteBackup.create({ data: { noteId: notes['DBMS · Unit 3 Normalization'].id, content: 'Normal forms: 1NF, 2NF, 3NF, BCNF. (first draft)', createdAt: at(-3, 20, 0) } });
await prisma.noteBackup.create({ data: { noteId: notes['DBMS · Unit 3 Normalization'].id, content: '## Normal forms\n\n2NF no partial dependency. 3NF no transitive dependency.', createdAt: at(-1, 20, 0) } });
const summaries: [string, string][] = [
  ['DBMS · Unit 3 Normalization', 'Covers 1NF to BCNF with a worked decomposition example where C → D breaks 3NF. The open worry is keeping the dependency while splitting.'],
  ['OS · Scheduling algorithms', 'Compares FCFS, SJF, round robin and priority scheduling with their weaknesses, plus a round robin waiting-time calculation.'],
  ['Computer Networks · TCP vs UDP', 'TCP is reliable and ordered with a handshake. UDP is lightweight and used for DNS, calls and games.'],
];
for (const [t, s] of summaries) {
  await prisma.aiGeneration.create({ data: { noteId: notes[t].id, userId, type: 'summary', result: s, createdAt: at(-1, 9, 0) } });
}

// Promises found in the sprint-planning note.
await prisma.aiGeneration.create({
  data: {
    noteId: notes['Internship · sprint planning'].id, userId, type: 'promises', createdAt: at(-1, 10, 0),
    result: JSON.stringify({ items: [
      { text: 'Share the new design file', owner: 'Meera', due: at(0, 18).toISOString(), status: 'open', todoId: null },
      { text: 'Review the pull request', owner: 'Rohit', due: at(-1, 18).toISOString(), status: 'open', todoId: null },
      { text: 'Add pagination to the reports endpoint', owner: 'you', due: at(2, 18).toISOString(), status: 'open', todoId: null },
      { text: 'Confirm staging database access', owner: 'Sanjana', due: null, status: 'ignored', todoId: null },
    ] }),
  },
});

// ---- Tasks ---------------------------------------------------------------------------
interface T {
  text: string; priority?: 'low' | 'medium' | 'high'; deadline?: Date | null; tags?: string[];
  done?: boolean; note?: string; start?: string; end?: string; recurrence?: string; doneAt?: Date;
}
const tasks: T[] = [
  // overdue
  { text: 'Email Prof. Rao about the lab viva slot', priority: 'medium', deadline: at(-1, 12), tags: ['college'] },
  { text: 'Pay hostel mess fee', priority: 'high', deadline: at(-2, 17), tags: ['personal'] },
  // today
  { text: 'Revise normalization (3NF, BCNF)', priority: 'high', deadline: at(0, 19), tags: ['exams', 'dbms'], note: 'DBMS · Unit 3 Normalization', start: '19:00', end: '20:30' },
  { text: 'Push login API fix for review', priority: 'medium', deadline: at(0, 18), tags: ['internship'], note: 'Internship · weekly log', start: '17:30', end: '18:00' },
  { text: 'Lossless-join check for example 2', priority: 'low', deadline: at(0, 21), tags: ['exams', 'dbms'] },
  { text: 'Walk for 30 minutes', priority: 'low', deadline: at(0, 7), tags: ['health'], done: true, doneAt: at(0, 7, 40), recurrence: 'daily' },
  // next days
  { text: 'Solve 5 questions from the 2024 DBMS paper', priority: 'high', deadline: at(1, 10), tags: ['exams', 'dbms'], start: '10:00', end: '12:00' },
  { text: 'Mock test · 90 minutes', priority: 'medium', deadline: at(1, 16), tags: ['exams'], start: '16:00', end: '17:30' },
  { text: 'DBMS mid-sem exam', priority: 'high', deadline: at(2, 10), tags: ['exams', 'dbms'], note: 'Sem 5 exam timetable', start: '10:00', end: '13:00' },
  { text: 'Add pagination to the reports endpoint', priority: 'high', deadline: at(2, 18), tags: ['internship'], note: 'Internship · sprint planning' },
  { text: 'OS scheduling revision with round robin examples', priority: 'high', deadline: at(3, 19), tags: ['exams', 'os'], note: 'OS · Scheduling algorithms' },
  { text: 'Reply to Priya about the mini-project', priority: 'low', deadline: at(3, 17), tags: ['college'] },
  { text: 'Book Diwali train tickets', priority: 'medium', deadline: at(4, 8), tags: ['personal'], note: 'Call mom about Diwali tickets' },
  { text: 'Send sprint summary to Meera', priority: 'medium', deadline: at(4, 16), tags: ['internship'], note: 'Internship · weekly log' },
  { text: 'CN exam · TCP and UDP', priority: 'high', deadline: at(5, 14), tags: ['exams', 'cn'], note: 'Computer Networks · TCP vs UDP', start: '14:00', end: '17:00' },
  { text: 'Weekly review', priority: 'low', deadline: at(6, 18), tags: ['habits'], recurrence: 'weekly' },
  { text: 'Pay phone recharge', priority: 'low', deadline: at(9, 12), tags: ['personal'], recurrence: 'monthly' },
  { text: 'Talk to 10 hostel students about ride-share', priority: 'medium', deadline: at(10, 18), tags: ['startup'], note: 'Startup idea · campus ride-share' },
  // no deadline
  { text: 'Read two chapters of Deep Work', priority: 'low', tags: ['reading'] },
  { text: 'Update LinkedIn headline', priority: 'low', tags: ['career'] },
  { text: 'Solve 3 LeetCode problems', priority: 'medium', tags: ['dsa', 'practice'], note: 'LeetCode · patterns I keep forgetting' },
  // done this week and last
  { text: 'Submit lab record', priority: 'medium', deadline: at(0, 9), tags: ['college'], done: true, doneAt: at(0, 9, 20) },
  { text: 'Finish Atomic Habits chapter 4', priority: 'low', deadline: at(-1, 22), tags: ['reading', 'habits'], done: true, doneAt: at(-1, 22, 10) },
  { text: 'Fix the token refresh bug', priority: 'high', deadline: at(-2, 17), tags: ['internship'], done: true, doneAt: at(-2, 16, 30) },
  { text: 'Prepare CN notes', priority: 'medium', deadline: at(-3, 18), tags: ['cn'], done: true, doneAt: at(-3, 18, 45) },
  { text: 'Gym · legs day', priority: 'low', deadline: at(-3, 7), tags: ['health'], done: true, doneAt: at(-3, 8, 30) },
  { text: 'Order printed question papers', priority: 'low', deadline: at(-5, 12), tags: ['college'], done: true, doneAt: at(-5, 12, 15) },
  { text: 'Pay electricity bill', priority: 'medium', deadline: at(-6, 12), tags: ['personal'], done: true, doneAt: at(-6, 12, 5) },
];
for (const t of tasks) {
  await prisma.todo.create({
    data: {
      userId, text: t.text, priority: t.priority ?? 'medium', deadline: t.deadline ?? null,
      todoTags: t.tags ?? [], completed: !!t.done, noteId: t.note ? notes[t.note].id : null,
      startTime: t.start ?? null, endTime: t.end ?? null, recurrence: t.recurrence ?? 'none',
      createdAt: at(-7, 12), updatedAt: t.doneAt ?? at(-1, 12),
    },
  });
}

// ---- Quizzes and mastery ---------------------------------------------------------------
type Q = { q: string; options: string[]; answer: number; explain: string; concept: string; noteId: string | null; noteTitle: string | null };
const dbmsNote = notes['DBMS · Unit 3 Normalization'];
const osNote = notes['OS · Scheduling algorithms'];
const cnNote = notes['Computer Networks · TCP vs UDP'];
const mk = (n: { id: string }, title: string, q: string, options: string[], answer: number, explain: string, concept: string): Q =>
  ({ q, options, answer, explain, concept, noteId: n.id, noteTitle: title });

const dbmsQs: Q[] = [
  mk(dbmsNote, 'DBMS · Unit 3 Normalization', 'Which normal form removes partial dependencies on a composite key?', ['1NF', '2NF', '3NF', 'BCNF'], 1, '2NF requires every non-key attribute to depend on the whole key.', 'Second normal form'),
  mk(dbmsNote, 'DBMS · Unit 3 Normalization', 'In R(A,B,C,D) with AB → C and C → D, why is R not in 3NF?', ['C → D is a transitive dependency', 'AB is not a key', 'D is not atomic', 'C is not unique'], 0, 'D depends on the key AB only through C.', 'Transitive dependency'),
  mk(dbmsNote, 'DBMS · Unit 3 Normalization', 'BCNF requires that every determinant is…', ['a prime attribute', 'a candidate key', 'a foreign key', 'unique in the table'], 1, 'BCNF is stricter than 3NF: each determinant must be a candidate key.', 'BCNF rule'),
  mk(dbmsNote, 'DBMS · Unit 3 Normalization', 'A decomposition into R1(A,B,C) and R2(C,D) is lossless when…', ['C is the key of R2', 'A is the key of R1', 'both share no attribute', 'D is dropped'], 0, 'The common attribute C must be a key of at least one part.', 'Lossless join'),
  mk(dbmsNote, 'DBMS · Unit 3 Normalization', 'Which ACID property means committed data survives a crash?', ['Atomicity', 'Consistency', 'Isolation', 'Durability'], 3, 'Durability guarantees committed changes are permanent.', 'ACID properties'),
];
const osQs: Q[] = [
  mk(osNote, 'OS · Scheduling algorithms', 'Which scheduling algorithm suffers from the convoy effect?', ['FCFS', 'Round robin', 'SJF', 'Priority'], 0, 'Short jobs wait behind one long job.', 'Convoy effect'),
  mk(osNote, 'OS · Scheduling algorithms', 'What fixes starvation in priority scheduling?', ['Aging', 'Larger quantum', 'Preemption', 'Batching'], 0, 'Aging slowly raises the priority of waiting processes.', 'Starvation and aging'),
  mk(osNote, 'OS · Scheduling algorithms', 'A very large round robin quantum behaves like…', ['SJF', 'FCFS', 'Priority', 'Multilevel queue'], 1, 'No process is ever preempted, so it runs in arrival order.', 'Round robin quantum'),
  mk(osNote, 'OS · Scheduling algorithms', 'A very small round robin quantum mainly causes…', ['Starvation', 'Too many context switches', 'Deadlock', 'Convoy effect'], 1, 'Switching overhead dominates useful work.', 'Round robin quantum'),
];
const cnQs: Q[] = [
  mk(cnNote, 'Computer Networks · TCP vs UDP', 'Which protocol is best for a live video call?', ['TCP', 'UDP', 'FTP', 'SMTP'], 1, 'Late packets are useless in a call, so UDP avoids retransmission delay.', 'UDP use cases'),
  mk(cnNote, 'Computer Networks · TCP vs UDP', 'The three-way handshake order is…', ['SYN, ACK, SYN-ACK', 'SYN, SYN-ACK, ACK', 'ACK, SYN, SYN-ACK', 'SYN-ACK, SYN, ACK'], 1, 'Client SYN, server SYN-ACK, client ACK.', 'TCP handshake'),
  mk(cnNote, 'Computer Networks · TCP vs UDP', 'Why does closing a TCP connection take four steps?', ['Each side closes its direction separately', 'Packets are lost', 'The server is slower', 'It uses UDP'], 0, 'TCP connections are full duplex, closed one direction at a time.', 'TCP teardown'),
];
const quizPlan: { topic: string; qs: Q[]; answers: number[]; daysAgo: number }[] = [
  { topic: 'dbms', qs: dbmsQs, answers: [1, 1, 1, 0, 3], daysAgo: 4 },
  { topic: 'dbms', qs: dbmsQs, answers: [1, 0, 1, 0, 3], daysAgo: 1 },
  { topic: 'os', qs: osQs, answers: [0, 0, 1, 0], daysAgo: 2 },
  { topic: 'cn', qs: cnQs, answers: [1, 1, 0], daysAgo: 3 },
];
for (const p of quizPlan) {
  const correct = p.qs.filter((q, i) => p.answers[i] === q.answer).length;
  await prisma.quizRun.create({
    data: {
      userId, topic: p.topic, questions: JSON.stringify(p.qs), answers: JSON.stringify(p.answers),
      correct, total: p.qs.length, createdAt: at(-p.daysAgo, 20), finishedAt: at(-p.daysAgo, 20, 12),
    },
  });
}
const mastery = [
  { topic: 'dbms', score: 80, quizzes: 2, lastCorrect: 4, lastTotal: 5, missed: [{ concept: 'Transitive dependency', n: 1 }] },
  { topic: 'os', score: 50, quizzes: 1, lastCorrect: 2, lastTotal: 4, missed: [{ concept: 'Round robin quantum', n: 1 }, { concept: 'Starvation and aging', n: 1 }] },
  { topic: 'cn', score: 67, quizzes: 1, lastCorrect: 2, lastTotal: 3, missed: [{ concept: 'TCP teardown', n: 1 }] },
];
for (const m of mastery) {
  await prisma.topicMastery.create({
    data: { userId, topic: m.topic, score: m.score, quizzes: m.quizzes, lastCorrect: m.lastCorrect, lastTotal: m.lastTotal, missed: JSON.stringify(m.missed) },
  });
}

console.log(`Seeded ${email}: ${main.length + filler} notes (${filler} daily logs), ${tasks.length} tasks, ${quizPlan.length} quizzes, ${mastery.length} topics.`);
await prisma.$disconnect();
