import fs from 'node:fs';
function patch(f, fn) {
  let s = fs.readFileSync(f, 'utf8');
  const crlf = s.includes('\r\n');
  s = s.replace(/\r\n/g, '\n');
  const rep = (a, b) => { if (!s.includes(a)) throw new Error(f + ' missing: ' + a.slice(0, 70)); s = s.replace(a, () => b); };
  fn(rep);
  if (crlf) s = s.replace(/\n/g, '\r\n');
  fs.writeFileSync(f, s);
}
patch('client/src/soft/SoftFocus.jsx', (rep) => {
  rep(`    const d = new Date(task.deadline || Date.now()); d.setDate(Math.max(d.getDate(), new Date().getDate()) + (daysFromToday(d) <= 0 ? 1 : 0));
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(d.getHours() || 9, d.getMinutes(), 0, 0);`, `    const prev = task.deadline ? new Date(task.deadline) : null;
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(prev ? prev.getHours() : 9, prev ? prev.getMinutes() : 0, 0, 0);`);
  rep(`          <div className="lab">Steps{steps.length ? \` · \${doneN} of \${steps.length}\` : ''}</div>\n`, '');
  rep("  const doneN = steps.filter((s) => s.done).length;\n", '');
});
patch('client/src/App.jsx', (rep) => {
  rep("const SoftTasks = lazy(() => import('./soft/SoftTasks'));", "const SoftTasks = lazy(() => import('./soft/SoftTasks'));\nconst SoftFocus = lazy(() => import('./soft/SoftFocus'));");
  rep('<Route path="/tasks" element=', '<Route path="/tasks/focus/:id" element={<SoftFocus />} />\n<Route path="/tasks" element=');
});
patch('client/src/soft/SoftTasks.jsx', (rep) => {
  rep("import { X, Repeat } from 'lucide-react';", "import { X, Repeat, Target } from 'lucide-react';");
  rep(`      <button type="button" className="s-card-x" aria-label={\`Delete "\${t.text}"\`} onClick={() => remove(t)}><X size={14} strokeWidth={2.4} /></button>`, `      {!t.completed && <Link to={\`/tasks/focus/\${t.id}\`} className="s-card-x focus" aria-label={\`Focus on "\${t.text}"\`} title="Focus on this task"><Target size={14} strokeWidth={2.4} /></Link>}
      <button type="button" className="s-card-x" aria-label={\`Delete "\${t.text}"\`} onClick={() => remove(t)}><X size={14} strokeWidth={2.4} /></button>`);
});
patch('client/src/soft/TaskSheet.jsx', (rep) => {
  rep("Jump to the line</Link>}", "Jump to the line</Link>}\n              {!isNew && <Link className=\"chip\" to={`/tasks/focus/${task.id}`} onClick={onClose}>Open note beside</Link>}");
});
console.log('ok');
