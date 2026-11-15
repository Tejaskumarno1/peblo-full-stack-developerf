import fs from 'node:fs';
function patch(f, fn) {
  let s = fs.readFileSync(f, 'utf8');
  const crlf = s.includes('\r\n');
  s = s.replace(/\r\n/g, '\n');
  const rep = (a, b) => { if (!s.includes(a)) throw new Error(f + ' missing: ' + a.slice(0, 60)); s = s.replace(a, () => b); };
  fn(rep);
  if (crlf) s = s.replace(/\n/g, '\r\n');
  fs.writeFileSync(f, s);
}
patch('server/src/utils/meta.ts', (rep) => {
  rep("    remindMin: (v) => int(v, 0, 43200),", `    remindMin: (v) => int(v, 0, 43200),
    repeatFromDone: (v) => (v === true ? true : undefined),
    source: (v) => {
      if (!isObj(v)) return undefined;
      const quote = str(v.quote, 400);
      if (!quote) return undefined;
      const noteId = str(v.noteId, 64);
      const line = int(v.line, 1, 100000);
      return { quote, ...(noteId ? { noteId } : {}), ...(line ? { line } : {}) };
    },`);
});
patch('server/src/controllers/todosController.ts', (rep) => {
  rep("import { tzOf, dayBounds, dayBoundsOf } from '../utils/userTime.js';", "import { tzOf, dayBounds, dayBoundsOf, zoneParts, zonedTime } from '../utils/userTime.js';");
  rep("    const io = req.app.get('io');\n    if (io) io.to(userId).emit('todos_changed');\n\n    res.json({ todo: updatedTodo });", `    // "Repeat from the date I finish it": finishing moves the next date to one period after today, not after the old due date.
    if (data.completed === true && !todo.completed && todo.seriesId && (todo.meta as any)?.repeatFromDone && todo.deadline) {
      const tz = tzOf(req);
      const old = zoneParts(todo.deadline, tz);
      const now = zoneParts(new Date(), tz);
      const anchor = zonedTime(now.y, now.m, now.d, old.h, old.mi, old.s, 0, tz);
      await prisma.todo.deleteMany({ where: { seriesId: todo.seriesId, id: { not: todo.id }, completed: false, deadline: { gt: todo.deadline } } });
      await prisma.todoSeries.update({ where: { id: todo.seriesId }, data: { anchor, lastGenerated: anchor } });
      await topUpSeries(userId, todo.seriesId);
    }

    const io = req.app.get('io');
    if (io) io.to(userId).emit('todos_changed');

    res.json({ todo: updatedTodo });`);
});
console.log('ok');
