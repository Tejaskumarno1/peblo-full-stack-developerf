import fs from 'fs';
const ed = (f, pairs) => {
  let s = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  for (const [a, b] of pairs) { if (!s.includes(a)) throw new Error(f + ' missing: ' + a.slice(0, 70)); s = s.replace(a, b); }
  fs.writeFileSync(f, s);
};
ed('server/src/utils/meta.ts', [[
"    list: (v) => str(v, 60),\n",
`    list: (v) => str(v, 60),
    planned: (v) => (v === true ? true : undefined),
    moves: (v) => int(v, 0, 99),
    proposal: (v) => { if (!isObj(v)) return undefined; const by = str(v.by, 60); if (!by) return undefined; const from = str(v.from, 120); return { by, ...(from ? { from } : {}) }; },
`]]);
ed('server/src/controllers/todosController.ts', [
[`      take: Math.min(Math.max(parseInt(String(limit), 10) || 1000, 1), 2000), // paging cap: open tasks come first, old finished ones are what gets cut
    });
    res.json({ todos });`,
`      take: Math.min(Math.max(parseInt(String(limit), 10) || 1000, 1), 2000), // paging cap: open tasks come first, old finished ones are what gets cut
    });
    // Tasks that Claude or a guest only proposed wait in the approval inbox: ?proposals=only shows just those, ?proposals=all both.
    const prop = (t: any) => !!(t.meta as any)?.proposal;
    const mode = String(req.query.proposals || '');
    res.json({ todos: mode === 'only' ? todos.filter(prop) : mode === 'all' ? todos : todos.filter((t) => !prop(t)) });`],
[`    }) as any[];

    const todayStartDate`, `    }) as any[];
    const allTasksAll = allTasks;
    allTasks.splice(0, allTasks.length, ...allTasksAll.filter((t) => !(t.meta as any)?.proposal));

    const todayStartDate`],
[`      take: 2000,
    });

    res.json({ todos });`, `      take: 2000,
    });

    res.json({ todos: todos.filter((t) => !(t.meta as any)?.proposal) });`],
[`      data.deadline = deadline ? new Date(deadline) : null;
    }`, `      data.deadline = deadline ? new Date(deadline) : null;
      // Pushing a task to a later day counts, so Plan my day can ask "still want it?" after three moves.
      if (data.deadline && todo.deadline && data.deadline.getTime() - todo.deadline.getTime() > 12 * 3600e3 && !(meta && typeof meta === 'object' && 'moves' in meta)) {
        const cur = ((data.meta ?? todo.meta) || {}) as any;
        data.meta = { ...cur, moves: Math.min(99, (Number(cur.moves) || 0) + 1) };
      }
    }`],
]);
ed('server/src/mcp/tools.ts', [[
`  const { todo } = await api('POST', '/todos', args);
  return { id: todo.id, text: todo.text, deadline: todo.deadline };`,
`  // When the person asked to approve what Claude adds (Plan my day), the task waits in their approval inbox.
  let propose = false;
  try { const me = await api('GET', '/profile'); propose = me?.user?.settings?.aiApproval === true; } catch { /* no setting: add it straight away */ }
  const { todo } = await api('POST', '/todos', propose ? { ...args, meta: { proposal: { by: 'Claude' } } } : args);
  return { id: todo.id, text: todo.text, deadline: todo.deadline, ...(propose ? { status: 'waiting for the person to approve it' } : {}) };`]]);
console.log('ok');
