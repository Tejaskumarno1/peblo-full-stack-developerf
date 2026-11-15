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

patch('server/src/utils/meta.ts', (rep) => {
  rep("    order: (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined),", "    order: (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined),\n    list: (v) => str(v, 60),");
});

patch('client/src/soft/SoftTasks.jsx', (rep) => {
  rep("import { useMemo, useRef, useState } from 'react';", "import { useEffect, useMemo, useRef, useState } from 'react';");
  rep("import { Link, useNavigate } from 'react-router-dom';", "import { Link, useNavigate, useSearchParams } from 'react-router-dom';");
  rep("import { useUndoToast, useDeferredDelete } from '../utils/useUndoToast';", "import { useUndoToast, useDeferredDelete, UNDO_MS } from '../utils/useUndoToast';");
  rep("import './tasks2.css';", "import './tasks2.css';\nimport './bulk.css';\nimport { ShortcutSheet, BulkBar, UndoRedo, DeleteConfirm } from './TaskBulk';");

  // table: selection column
  rep("function TaskTable({ rows, toggle, open }) {", "function TaskTable({ rows, toggle, open, selMode, sel, onSel }) {");
  rep("            <tr key={t.id}>\n              <td><input type=\"checkbox\" className=\"s-check small\" checked={!!t.completed} onChange={() => toggle(t)} aria-label={`Mark \"${t.text}\" done`} /></td>",
    "            <tr key={t.id} className={selMode && sel.has(t.id) ? 'sel' : ''} onClick={(e) => { if (selMode) onSel(t, e.shiftKey); }}>\n              <td>{selMode ? <button type=\"button\" className={`s-selbox${sel.has(t.id) ? ' on' : ''}`} aria-pressed={sel.has(t.id)} aria-label={`Select \"${t.text}\"`} /> : <input type=\"checkbox\" className=\"s-check small\" checked={!!t.completed} onChange={() => toggle(t)} aria-label={`Mark \"${t.text}\" done`} />}</td>");
  rep("<td><button type=\"button\" className=\"s-card-open t\" onClick={() => open(t)}>{t.text}</button></td>", "<td><button type=\"button\" className=\"s-card-open t\" onClick={() => { if (!selMode) open(t); }}>{t.text}</button></td>");

  // state
  rep("  const [overCol, setOverCol] = useState(null);\n", `  const [overCol, setOverCol] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [selMode, setSelMode] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const lastSel = useRef(null);
  const [cursor, setCursor] = useState(null);
  const [keys, setKeys] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [bulkGone, setBulkGone] = useState({ ids: new Set(), series: new Set() });
  const hist = useRef({ undo: [], redo: [] });
  const [, bump] = useState(0);
  const pendingDel = useRef(null);
  const flatRef = useRef([]);
`);

  // collapsed hides pending bulk deletes
  rep("    const open = new Map();\n    for (const t of todos) if (t.seriesId && !t.completed)", "    const live = todos.filter((t) => !bulkGone.ids.has(t.id) && !(t.seriesId && bulkGone.series.has(t.seriesId)));\n    const open = new Map();\n    for (const t of live) if (t.seriesId && !t.completed)");
  rep("    return todos.filter((t) => t.completed || !t.seriesId || first.get(t.seriesId) === t.id)", "    return live.filter((t) => t.completed || !t.seriesId || first.get(t.seriesId) === t.id)");
  rep("  }, [todos]);\n  const inView", "  }, [todos, bulkGone]);\n  const inView");

  // order inside a day
  rep("    return { overdue, today, tomorrow, week, later, done, open };", `    const ord = (t) => (typeof t.meta?.order === 'number' ? t.meta.order : null);
    const withOrder = (arr) => (arr.some((x) => ord(x) !== null) ? [...arr].sort((a, b) => (ord(a) ?? 1e12) - (ord(b) ?? 1e12)) : arr);
    return { overdue, today: withOrder(today), tomorrow: withOrder(tomorrow), week: withOrder(week), later, done, open };`);

  // history, bulk, selection
  rep("  const parsed = draft.trim() ? parseTask(draft) : null;", `  // ---- Undo / Redo for bulk and keyboard changes ----
  const pushHist = (entry) => { hist.current = { undo: [...hist.current.undo, entry].slice(-20), redo: [] }; bump((n) => n + 1); };
  const patchBody = (p) => {
    const b = { scope: 'this' };
    for (const k of ['completed', 'deadline', 'priority', 'tags']) if (k in p) b[k] = p[k];
    const meta = {};
    if ('list' in p) meta.list = p.list || null;
    if ('order' in p) meta.order = p.order;
    if (Object.keys(meta).length) b.meta = meta;
    return b;
  };
  const applyPatches = async (list) => {
    queryClient.setQueryData(['todos', 'all'], (old) => (old || []).map((x) => {
      const p = list.find((y) => y.id === x.id);
      if (!p) return x;
      const n = { ...x };
      if ('completed' in p) { n.completed = p.completed; n.updatedAt = new Date().toISOString(); }
      if ('deadline' in p) n.deadline = p.deadline;
      if ('priority' in p) n.priority = p.priority;
      if ('tags' in p) n.todoTags = p.tags;
      if ('list' in p || 'order' in p) n.meta = { ...(x.meta || {}), ...('list' in p ? { list: p.list || undefined } : {}), ...('order' in p ? { order: p.order ?? undefined } : {}) };
      return n;
    }));
    try { await Promise.all(list.map((p) => todosAPI.update(p.id, patchBody(p)))); } catch { setErr('Some changes could not be saved.'); }
    refresh();
  };
  const undoLast = async () => {
    const e = hist.current.undo.at(-1);
    if (!e || e.expired) return;
    hist.current = { undo: hist.current.undo.slice(0, -1), redo: [...hist.current.redo, e] };
    bump((n) => n + 1);
    await e.undo();
  };
  const redoLast = async () => {
    const e = hist.current.redo.at(-1);
    if (!e || e.expired || !e.redo) return;
    hist.current = { undo: [...hist.current.undo, e], redo: hist.current.redo.slice(0, -1) };
    bump((n) => n + 1);
    await e.redo();
  };
  const snapshot = (t, ks) => {
    const o = { id: t.id };
    for (const k of ks) o[k] = k === 'tags' ? [...tagsOf(t)] : k === 'list' ? (t.meta?.list || null) : k === 'order' ? (t.meta?.order ?? null) : (t[k] ?? null);
    return o;
  };
  const bulk = async (label, ks, make, ids) => {
    const chosen = collapsed.filter((t) => ids.has(t.id));
    if (!chosen.length) return;
    const before = chosen.map((t) => snapshot(t, ks));
    const after = chosen.map((t) => ({ id: t.id, ...make(t) }));
    await applyPatches(after);
    pushHist({ label, undo: () => applyPatches(before), redo: () => applyPatches(after) });
    say(\`\${label}: \${chosen.length} task\${chosen.length === 1 ? '' : 's'}\`, () => undoLast());
  };
  const dateFor = (key, t) => {
    if (key === 'none') return null;
    const dow = new Date().getDay();
    const d = addDays(startOfDay(), key === 'today' ? 0 : key === 'tomorrow' ? 1 : key === 'weekend' ? ((6 - dow + 7) % 7 || 7) : 7);
    const prev = t.deadline ? new Date(t.deadline) : null;
    d.setHours(prev ? prev.getHours() : 9, prev ? prev.getMinutes() : 0, 0, 0);
    return d.toISOString();
  };
  const bDone = (ids = sel) => bulk('Marked done', ['completed'], () => ({ completed: true }), ids);
  const bDate = (k, ids = sel) => bulk('Date changed', ['deadline'], (t) => ({ deadline: dateFor(k, t) }), ids);
  const bMove = (name, ids = sel) => bulk(name ? \`Moved to \${name}\` : 'Moved to Inbox', ['list'], () => ({ list: name || null }), ids);
  const bTag = (tag, ids = sel) => bulk(\`Tagged #\${tag}\`, ['tags'], (t) => ({ tags: [...new Set([...tagsOf(t), tag])] }), ids);
  const bPrio = (p, ids = sel) => bulk('Priority changed', ['priority'], () => ({ priority: p }), ids);

  const exitSelect = () => { setSelMode(false); setSel(new Set()); lastSel.current = null; };
  const toggleSel = (t, shift = false, ordered = []) => {
    setSel((s) => {
      const n = new Set(s);
      if (shift && lastSel.current && ordered.length) {
        const a = ordered.indexOf(lastSel.current);
        const b = ordered.indexOf(t.id);
        if (a >= 0 && b >= 0) { for (const id of ordered.slice(Math.min(a, b), Math.max(a, b) + 1)) n.add(id); lastSel.current = t.id; return n; }
      }
      if (n.has(t.id)) n.delete(t.id); else n.add(t.id);
      lastSel.current = t.id;
      return n;
    });
  };
  const delStats = () => {
    const chosen = collapsed.filter((t) => sel.has(t.id));
    const series = chosen.filter((t) => t.seriesId);
    return { tasks: chosen.length, repeating: series.length, occurrences: series.reduce((n, t) => n + todos.filter((x) => x.seriesId === t.seriesId && !x.completed).length, 0) };
  };
  const doDelete = () => {
    pendingDel.current?.();
    const chosen = collapsed.filter((t) => sel.has(t.id));
    setConfirmDel(false);
    setBulkGone({ ids: new Set(chosen.map((t) => t.id)), series: new Set(chosen.filter((t) => t.seriesId).map((t) => t.seriesId)) });
    exitSelect();
    const entry = { label: 'Deleted', expired: false, undo: async () => { clearTimeout(pendingDel.timer); pendingDel.current = null; setBulkGone({ ids: new Set(), series: new Set() }); }, redo: null };
    pushHist(entry);
    say(\`Deleted \${chosen.length} task\${chosen.length === 1 ? '' : 's'}\`, () => undoLast());
    const run = async () => {
      clearTimeout(pendingDel.timer);
      pendingDel.current = null;
      entry.expired = true;
      try { await Promise.all(chosen.map((t) => todosAPI.delete(t.id, t.seriesId ? 'all' : 'this'))); } catch { setErr('Some tasks could not be deleted.'); }
      setBulkGone({ ids: new Set(), series: new Set() });
      refresh();
    };
    pendingDel.current = run;
    pendingDel.timer = setTimeout(run, UNDO_MS + 1500);
  };
  useEffect(() => () => { pendingDel.current?.(); }, []); // leaving the page finishes a delete that was waiting

  const reorder = async (id, target, column) => {
    setDragId(null);
    setOverCol(null);
    const col = columns.find((c) => c.key === column);
    if (!col || !collapsed.some((x) => x.id === id)) return;
    if (!col.items.some((x) => x.id === id)) { moveTo(id, column === 'later' ? 'week' : column); return; }
    const ids = col.items.map((x) => x.id).filter((x) => x !== id);
    ids.splice(Math.max(0, ids.indexOf(target.id)), 0, id);
    const patches = ids.map((x, i) => ({ id: x, order: i * 10 }));
    const before = col.items.map((x) => ({ id: x.id, order: x.meta?.order ?? null }));
    await applyPatches(patches);
    pushHist({ label: 'Order changed', undo: () => applyPatches(before), redo: () => applyPatches(patches) });
  };

  const parsed = draft.trim() ? parseTask(draft) : null;`);

  // URL params + keyboard (after dropProps)
  rep("  const chipsFor = (t, column) => {", `  // /tasks?task=<id> opens that task, /tasks?q=<tag> filters (used by the command palette)
  useEffect(() => {
    const id = searchParams.get('task');
    const qq = searchParams.get('q');
    if (qq) setQ(qq);
    if (id) {
      if (!todos.length) { if (qq) setSearchParams({ task: id }, { replace: true }); return; }
      const t = todos.find((x) => x.id === id);
      if (t) setSheet({ task: t, isNew: false });
      setSearchParams({}, { replace: true });
    } else if (qq) setSearchParams({}, { replace: true });
  }, [searchParams, todos]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (cursor) document.querySelector(\`[data-id="\${cursor}"]\`)?.scrollIntoView({ block: 'nearest' }); }, [cursor]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { if (keys) { setKeys(false); } else if (selMode && !sheet && !confirmDel) exitSelect(); return; }
      const el = document.activeElement;
      const typing = el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
      if (typing || sheet || confirmDel || keys || document.querySelector('[role="dialog"],[role="alertdialog"]')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redoLast(); else undoLast(); return; }
      if (mod || e.altKey) return;
      const k = e.key;
      const list = flatRef.current;
      const idx = list.findIndex((t) => t.id === cursor);
      const cur = idx >= 0 ? list[idx] : null;
      const target = () => (sel.size ? new Set(sel) : cur ? new Set([cur.id]) : new Set());
      if (k === 'n') { e.preventDefault(); inputRef.current?.focus(); }
      else if (k === '/') { e.preventDefault(); document.getElementById('s-task-search')?.focus(); }
      else if (k === '?') { e.preventDefault(); e.stopPropagation(); setKeys(true); }
      else if (k === 'j') { e.preventDefault(); setCursor(list[Math.min(list.length - 1, idx + 1)]?.id ?? null); }
      else if (k === 'k') { e.preventDefault(); setCursor(list[Math.max(0, idx - 1)]?.id ?? null); }
      else if ((k === 'x' || k === ' ') && (cur || sel.size)) { e.preventDefault(); if (sel.size) bDone(sel); else toggle(cur); }
      else if (k === 'e' && cur) { e.preventDefault(); setSheet({ task: cur, isNew: false }); }
      else if ((k === '1' || k === '2' || k === '3') && target().size) { e.preventDefault(); bPrio(k === '1' ? 'high' : k === '2' ? 'medium' : 'low', target()); }
      else if ((k === 't' || k === 'm') && target().size) { e.preventDefault(); bDate(k === 't' ? 'today' : 'tomorrow', target()); }
      else if (k === 's' && cur) { e.preventDefault(); setSelMode(true); toggleSel(cur, false, list.map((t) => t.id)); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const chipsFor = (t, column) => {`);

  // card
  rep("    <div key={t.id} className={`s-card${t.completed ? ' done' : ''}${dragId === t.id ? ' dragging' : ''}`} data-testid=\"task-card\" draggable onDragStart=",
    "    <div key={t.id} data-id={t.id} className={`s-card${t.completed ? ' done' : ''}${dragId === t.id ? ' dragging' : ''}${selMode && sel.has(t.id) ? ' sel' : ''}${cursor === t.id ? ' kb' : ''}`} data-testid=\"task-card\" draggable={!selMode} onClick={(e) => { if (selMode && !e.target.closest('a')) toggleSel(t, e.shiftKey, visibleIds); else setCursor(t.id); }} onDragOver={(e) => { if (dragId && dragId !== t.id) e.preventDefault(); }} onDrop={(e) => { if (dragId && dragId !== t.id) { e.preventDefault(); e.stopPropagation(); reorder(dragId, t, column); } }} onDragStart=");
  rep("      <input type=\"checkbox\" className=\"s-check small\" checked={!!t.completed} onChange={() => toggle(t)} aria-label={`Mark \"${t.text}\" ${t.completed ? 'not done' : 'done'}`} />\n      <div className=\"s-card-body\">\n        <button type=\"button\" className=\"t s-card-open\" onClick={() => setSheet({ task: t, isNew: false })}>{t.text}</button>",
    "      {selMode\n        ? <button type=\"button\" className={`s-selbox${sel.has(t.id) ? ' on' : ''}`} aria-pressed={sel.has(t.id)} aria-label={`Select \"${t.text}\"`} />\n        : <input type=\"checkbox\" className=\"s-check small\" checked={!!t.completed} onChange={() => toggle(t)} aria-label={`Mark \"${t.text}\" ${t.completed ? 'not done' : 'done'}`} />}\n      <div className=\"s-card-body\">\n        <button type=\"button\" className=\"t s-card-open\" onClick={() => { if (!selMode) setSheet({ task: t, isNew: false }); }}>{t.text}</button>");
  rep("      {!t.completed && <Link to={`/tasks/focus/${t.id}`}", "      {!selMode && !t.completed && <Link to={`/tasks/focus/${t.id}`}");
  rep("      <button type=\"button\" className=\"s-card-x\" aria-label={`Delete \"${t.text}\"`} onClick={() => remove(t)}>", "      {!selMode && <button type=\"button\" className=\"s-card-x\" aria-label={`Delete \"${t.text}\"`} onClick={() => remove(t)}>");
  rep("<X size={14} strokeWidth={2.4} /></button>\n    </div>\n  );", "<X size={14} strokeWidth={2.4} /></button>}\n    </div>\n  );");

  // visible order after columns
  rep("  return (\n    <div className=\"soft-page s-tasks\">", `  const visibleTasks = view === 'table' || view === 'timeline'
    ? [...groups.overdue, ...groups.today, ...groups.tomorrow, ...groups.week, ...groups.later]
    : (view === 'board' || lg === 'when') ? columns.flatMap((c) => [...c.items, ...(c.extra || [])]) : otherGroups.flatMap((g) => g.items);
  const visibleIds = visibleTasks.map((t) => t.id);
  flatRef.current = visibleTasks;
  const knownLists = [...new Set(todos.map((t) => t.meta?.list).filter(Boolean))].sort();

  return (
    <div className="soft-page s-tasks">`);

  // header
  rep("          <h1 className=\"s-h1\">Tasks</h1>\n          <span className=\"s-sub\">{subtitle}</span>", "          <h1 className=\"s-h1\">{selMode ? `${sel.size} selected` : 'Tasks'}</h1>\n          <span className=\"s-sub\">{selMode ? 'Click tasks to select them, Shift-click for a range.' : subtitle}</span>");
  rep("        <span className=\"grow\" />\n        <div className=\"s-seg\" role=\"tablist\" aria-label=\"View\">", "        <span className=\"grow\" />\n        {selMode && <button type=\"button\" className=\"s-selbtn\" onClick={exitSelect}>Cancel</button>}\n        <div className=\"s-seg\" role=\"tablist\" aria-label=\"View\">");

  // select button in tools
  rep("        {view === 'list' && (\n          <>\n            <label className=\"s-tt-sel\">Group", "        <button type=\"button\" className={`s-selbtn${selMode ? ' on' : ''}`} aria-pressed={selMode} onClick={() => (selMode ? exitSelect() : setSelMode(true))}>Select</button>\n        {view === 'list' && (\n          <>\n            <label className=\"s-tt-sel\">Group");

  // table props
  rep("<TaskTable rows={[...groups.overdue, ...groups.today, ...groups.tomorrow, ...groups.week, ...groups.later]} toggle={toggle} open={(t) => setSheet({ task: t, isNew: false })} />", "<TaskTable rows={visibleTasks} toggle={toggle} open={(t) => setSheet({ task: t, isNew: false })} selMode={selMode} sel={sel} onSel={(t, shift) => toggleSel(t, shift, visibleIds)} />");

  // overlays
  rep("      {sheet && <TaskSheet task={sheet.task}", `      {selMode && sel.size > 0 && <BulkBar count={sel.size} lists={knownLists} onDone={() => bDone()} onDate={(k) => bDate(k)} onMove={(n) => bMove(n)} onTag={(t) => bTag(t)} onPriority={(p) => bPrio(p)} onDelete={() => setConfirmDel(true)} onCancel={exitSelect} />}
      <UndoRedo canUndo={hist.current.undo.length > 0 && !hist.current.undo.at(-1).expired} canRedo={hist.current.redo.length > 0 && !!hist.current.redo.at(-1).redo} label={hist.current.undo.at(-1)?.label?.toLowerCase() || ''} onUndo={undoLast} onRedo={redoLast} />
      {keys && <ShortcutSheet onClose={() => setKeys(false)} />}
      {confirmDel && <DeleteConfirm {...delStats()} onCancel={() => setConfirmDel(false)} onConfirm={doDelete} />}
      {sheet && <TaskSheet task={sheet.task}`);
});
console.log('ok');
