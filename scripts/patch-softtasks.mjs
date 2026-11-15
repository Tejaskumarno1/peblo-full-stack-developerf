import fs from 'node:fs';
const f = 'client/src/soft/SoftTasks.jsx';
let s = fs.readFileSync(f, 'utf8');
const crlf = s.includes('\r\n');
s = s.replace(/\r\n/g, '\n');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 60)); s = s.replace(a, () => b); };

rep("import { X } from 'lucide-react';", "import { X, Repeat } from 'lucide-react';");
rep("import { timeOf,", "import './tasks2.css';\nimport { timeOf,");

// helpers
rep("export default function SoftTasks() {", `const ordinal = (n) => { const v = n % 100; return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'); };
/** "Every 1st", "Every weekday", "Every Friday" - what a repeating task says about itself. */
export function repeatLabel(t) {
  const r = t.recurrence;
  if (!r || r === 'none') return '';
  const d = t.deadline ? new Date(t.deadline) : null;
  if (r === 'daily') return 'Every day';
  if (r === 'weekdays') return 'Every weekday';
  if (r === 'weekly') return d ? \`Every \${weekdayLong(d)}\` : 'Every week';
  if (r === 'monthly') return d ? \`Every \${ordinal(d.getDate())}\` : 'Every month';
  if (r === 'yearly') return d ? \`Every \${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}\` : 'Every year';
  return '';
}
const SMART = [['all', 'All'], ['inbox', 'Inbox'], ['today', 'Today'], ['upcoming', 'Upcoming'], ['waiting', 'Waiting'], ['someday', 'Someday'], ['overdue', 'Overdue'], ['high', 'High priority']];
const VIEWS = [['board', 'Board'], ['list', 'List'], ['table', 'Table'], ['timeline', 'Timeline']];
const stepsOf = (t) => (Array.isArray(t.meta?.subtasks) ? t.meta.subtasks : []);

export default function SoftTasks() {`);

// base: collapse series, smart views
rep(`  const base = useMemo(() => {
    const found = filterTasks(todos, { show: 'all', q }, SOFT_H);
    return found.filter((t) => (pill === 'high' ? t.priority === 'high' : pill === 'overdue' ? isOverdue(t, SOFT_H) : pill === 'nodate' ? !t.deadline : true));
  }, [todos, q, pill]);`, `  // A repeating task shows once (its next open date) with "+N later", not as 60 copies.
  const collapsed = useMemo(() => {
    const open = new Map();
    for (const t of todos) if (t.seriesId && !t.completed) { const a = open.get(t.seriesId) || []; a.push(t); open.set(t.seriesId, a); }
    const first = new Map();
    for (const [id, a] of open) { a.sort((x, y) => new Date(x.deadline || 8.64e15) - new Date(y.deadline || 8.64e15)); first.set(id, a[0].id); }
    return todos.filter((t) => t.completed || !t.seriesId || first.get(t.seriesId) === t.id).map((t) => (t.seriesId && !t.completed ? { ...t, _later: open.get(t.seriesId).length - 1 } : t));
  }, [todos]);
  const inView = (t, key) => {
    const tg = tagsOf(t).map(String);
    const d = t.deadline ? daysFromToday(t.deadline) : null;
    if (key === 'high') return t.priority === 'high';
    if (key === 'overdue') return isOverdue(t, SOFT_H);
    if (key === 'inbox') return d === null && !tg.includes('someday') && !tg.includes('waiting');
    if (key === 'today') return d !== null && d <= 0;
    if (key === 'upcoming') return d !== null && d >= 1;
    if (key === 'waiting') return tg.includes('waiting');
    if (key === 'someday') return tg.includes('someday');
    return true;
  };
  const smartCounts = useMemo(() => Object.fromEntries(SMART.map(([k]) => [k, collapsed.filter((t) => !t.completed && inView(t, k)).length])), [collapsed]);
  const base = useMemo(() => {
    const found = filterTasks(collapsed, { show: 'all', q }, SOFT_H);
    return found.filter((t) => t.completed || inView(t, pill));
  }, [collapsed, q, pill]);`);

// add: keep focus, no forced sheet
rep(`      const { data } = await todosAPI.create({ text: parsed.text || draft.trim(), priority: parsed.priority, tags: parsed.tags, deadline: parsed.deadline ? parsed.deadline.toISOString() : null });
      setDraft('');
      refresh();
      const made = data.todo || data.todos?.[0] || null;
      if (made?.id) setSheet({ task: made, isNew: true });
      else inputRef.current?.focus();`, `      let when = parsed.deadline;
      if (!when && parsed.recurrence !== 'none') { when = new Date(); when.setHours(9, 0, 0, 0); if (when < new Date()) when.setDate(when.getDate() + 1); }
      const { data } = await todosAPI.create({ text: parsed.text || draft.trim(), priority: parsed.priority, tags: parsed.tags, deadline: when ? when.toISOString() : null, ...(parsed.recurrence !== 'none' ? { recurrence: parsed.recurrence } : {}) });
      setDraft('');
      refresh();
      const made = data.todo || data.todos?.[0] || null;
      setJustAdded(made ? { task: made, label: parsed.text || made.text } : null);
      inputRef.current?.focus();`);
rep("  const [sheet, setSheet] = useState(null); // { task, isNew }", "  const [sheet, setSheet] = useState(null); // { task, isNew }\n  const [justAdded, setJustAdded] = useState(null); // the task just added with Enter, so the cursor can stay in the box\n  const [dragId, setDragId] = useState(null);\n  const [overCol, setOverCol] = useState(null);");

// understood row + remove inline chips
rep(`        {parsed?.deadline && <span className="s-tag" style={{ background: 'var(--s-mint)', padding: '7px 12px' }}>{dayChip(parsed.deadline)}</span>}
        {parsed && parsed.priority !== 'medium' && <span className="s-tag" style={{ background: 'var(--s-peach)', padding: '7px 12px' }}>{parsed.priority === 'high' ? 'High' : 'Low'}</span>}
        {parsed?.tags.map((t) => <span key={t} className="s-tag" style={{ background: 'var(--s-butter)', padding: '7px 12px' }}>#{t}</span>)}
`, '');
rep(`      {err && <p className="s-empty small"`, `      {parsed ? (
        <div className="s-understood" aria-live="polite" data-testid="understood">
          <span className="lead">Understood</span>
          <b className="what">{parsed.text || draft.trim()}</b>
          {parsed.recurrence !== 'none' && <span className="s-mini"><Repeat size={11} /> {repeatLabel({ recurrence: parsed.recurrence, deadline: parsed.deadline })}</span>}
          {parsed.deadline && <span className="s-mini">Next: {dayChip(parsed.deadline)}{parsed.allDay ? '' : \` \${timeOf({ deadline: parsed.deadline })}\`}</span>}
          {parsed.priority !== 'medium' && <span className="s-mini high">{parsed.priority === 'high' ? 'High' : 'Low'}</span>}
          {parsed.tags.map((t) => <span key={t} className="s-mini">#{t}</span>)}
          <span className="grow" />
          <kbd>Enter</kbd><span className="hint">adds it and keeps the cursor here</span>
        </div>
      ) : justAdded ? (
        <div className="s-understood added" data-testid="just-added">
          <span className="lead ok">Added</span>
          <b className="what">{justAdded.label}</b>
          <span className="grow" />
          <button type="button" className="s-linkbtn" onClick={() => { setSheet({ task: justAdded.task, isNew: true }); setJustAdded(null); }}>Add details</button>
        </div>
      ) : null}
      {err && <p className="s-empty small"`);

// card: repeat chip, later, steps, drag
rep(`    for (const tag of tagsOf(t).slice(0, 2)) out.push({ label: \`#\${tag}\` });
    return out;`, `    const rl = repeatLabel(t);
    if (rl && column !== 'done') out.push({ label: rl, kind: 'repeat' });
    if (t._later > 0 && column !== 'done') out.push({ label: \`+\${t._later} later\`, kind: 'later' });
    for (const tag of tagsOf(t).slice(0, 2)) out.push({ label: \`#\${tag}\` });
    return out;`);
rep(`    <div key={t.id} className={\`s-card\${t.completed ? ' done' : ''}\`}>`, `    <div key={t.id} className={\`s-card\${t.completed ? ' done' : ''}\${dragId === t.id ? ' dragging' : ''}\`} data-testid="task-card" draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; setDragId(t.id); }} onDragEnd={() => { setDragId(null); setOverCol(null); }}>`);
rep(`          {t.note && <Link`, `          {stepsOf(t).length > 0 && <StepsBar steps={stepsOf(t)} />}
          {t.note && <Link`);
rep("{chipsFor(t, column).map((c) => <span key={c.label} className={`s-mini ${c.kind || ''}`}>{c.label}</span>)}", "{chipsFor(t, column).map((c) => <span key={c.label} className={`s-mini ${c.kind || ''}`}>{c.kind === 'repeat' && <Repeat size={11} />}{c.label}</span>)}");

// StepsBar component before default export
rep("export default function SoftTasks() {", `function StepsBar({ steps }) {
  const done = steps.filter((x) => x.done).length;
  return (
    <span className="s-steps" title={\`\${done} of \${steps.length} steps\`}>
      <span className="bar"><i style={{ width: \`\${Math.round((done / steps.length) * 100)}%\` }} /></span>
      <span className="n">{done} of {steps.length} steps</span>
    </span>
  );
}

export default function SoftTasks() {`);

// move via drag
rep("  const chipsFor =", `  const moveTo = async (id, col) => {
    const t = todos.find((x) => x.id === id);
    if (!t || t.completed) return;
    if (col === 'done') { toggle(t); return; }
    const days = col === 'today' ? 0 : col === 'tomorrow' ? 1 : 2;
    const old = t.deadline;
    const d = addDays(startOfDay(), days);
    const prev = old ? new Date(old) : null;
    d.setHours(prev ? prev.getHours() : 9, prev ? prev.getMinutes() : 0, 0, 0);
    const put = (deadline) => todosAPI.update(id, { deadline, scope: 'this' }).then(refresh);
    queryClient.setQueryData(['todos', 'all'], (o) => (o || []).map((x) => (x.id === id ? { ...x, deadline: d.toISOString() } : x)));
    try { await put(d.toISOString()); } catch { setErr('Could not move that task.'); refresh(); return; }
    say(\`Moved to \${col === 'week' ? dayChip(d) : col === 'today' ? 'Today' : 'Tomorrow'}\`, () => put(old));
  };
  const dropProps = (key) => ({
    onDragOver: (e) => { if (dragId) { e.preventDefault(); setOverCol(key); } },
    onDragLeave: () => setOverCol((c) => (c === key ? null : c)),
    onDrop: (e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain') || dragId; setOverCol(null); setDragId(null); if (id) moveTo(id, key); },
  });

  const chipsFor =`);

// view tabs
rep(`          <button type="button" role="tab" aria-selected={view === 'board'} className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>Board</button>
          <button type="button" role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>List</button>
          <button type="button" role="tab" aria-selected={false} onClick={() => navigate('/calendar')}>Timeline</button>`, `          {VIEWS.map(([k, name]) => <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{name}</button>)}`);

// filter pills
rep(`          {[['all', 'All'], ['overdue', 'Overdue'], ['high', 'High priority'], ['nodate', 'No date']].map(([k, name]) => (
            <button key={k} type="button" role="tab" aria-selected={pill === k} className={pill === k ? 'on' : ''} onClick={() => setPill(k)}>{name}</button>
          ))}`, `          {SMART.map(([k, name]) => (
            <button key={k} type="button" role="tab" aria-selected={pill === k} className={pill === k ? 'on' : ''} onClick={() => setPill(k)}>{name}{k !== 'all' && <span className="s-pcount">{smartCounts[k]}</span>}</button>
          ))}`);

// board columns drop targets
rep("<section key={c.key} className=\"s-col\" style={{ background: `var(--s-${c.tone})` }} aria-labelledby={`s-col-${c.key}`}>", "<section key={c.key} data-col={c.key} className={`s-col${overCol === c.key ? ' over' : ''}`} style={{ background: `var(--s-${c.tone})` }} aria-labelledby={`s-col-${c.key}`} {...dropProps(c.key)}>");

// board vs list vs table vs timeline
rep("      {view === 'board' ? (", "      {view === 'table' ? <TaskTable rows={[...groups.overdue, ...groups.today, ...groups.tomorrow, ...groups.week, ...groups.later]} toggle={toggle} open={(t) => setSheet({ task: t, isNew: false })} /> : view === 'timeline' ? <TaskTimeline groups={groups} open={(t) => setSheet({ task: t, isNew: false })} /> : view === 'board' ? (");

// components
rep("export default function SoftTasks() {", `function TaskTable({ rows, toggle, open }) {
  return (
    <div className="s-table-wrap">
      <table className="s-table" data-testid="task-table">
        <thead><tr><th scope="col"><span className="s-sr">Done</span></th><th scope="col">Task</th><th scope="col">Due</th><th scope="col">Repeat</th><th scope="col">Priority</th><th scope="col">Steps</th><th scope="col">Tags</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} className="s-empty small">Nothing here.</td></tr>}
          {rows.map((t) => (
            <tr key={t.id}>
              <td><input type="checkbox" className="s-check small" checked={!!t.completed} onChange={() => toggle(t)} aria-label={\`Mark "\${t.text}" done\`} /></td>
              <td><button type="button" className="s-card-open t" onClick={() => open(t)}>{t.text}</button></td>
              <td>{t.deadline ? \`\${dayChip(t.deadline)}\${timeOf(t) ? \` \${timeOf(t)}\` : ''}\` : '\\u2014'}</td>
              <td>{repeatLabel(t) || '\\u2014'}{t._later > 0 && <span className="s-mini later">+{t._later} later</span>}</td>
              <td>{t.priority === 'high' ? 'High' : t.priority === 'low' ? 'Low' : 'Normal'}</td>
              <td>{stepsOf(t).length ? \`\${stepsOf(t).filter((x) => x.done).length}/\${stepsOf(t).length}\` : '\\u2014'}</td>
              <td>{tagsOf(t).map((g) => \`#\${g}\`).join(' ') || '\\u2014'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskTimeline({ groups, open }) {
  const days = Array.from({ length: 14 }, (_, i) => addDays(startOfDay(), i));
  const all = [...groups.overdue, ...groups.today, ...groups.tomorrow, ...groups.week, ...groups.later].filter((t) => t.deadline);
  return (
    <div className="s-timeline" data-testid="task-timeline">
      {days.map((d, i) => {
        const items = all.filter((t) => (i === 0 ? daysFromToday(t.deadline) <= 0 : daysFromToday(t.deadline) === i));
        return (
          <section key={i} className={\`s-tl-day\${i === 0 ? ' today' : ''}\`}>
            <h2>{i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : weekdayLong(d)}<small>{d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</small></h2>
            {items.length === 0 && <p className="s-empty small">Free</p>}
            {items.map((t) => <button key={t.id} type="button" className="s-tl-item" onClick={() => open(t)}><b>{timeOf(t) || 'All day'}</b>{t.text}{repeatLabel(t) && <Repeat size={11} />}</button>)}
          </section>
        );
      })}
    </div>
  );
}

export default function SoftTasks() {`);

if (crlf) s = s.replace(/\n/g, '\r\n');
fs.writeFileSync(f, s);
console.log('ok');

