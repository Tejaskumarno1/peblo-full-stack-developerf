import fs from 'fs';
const f = 'client/src/soft/SoftTasks.jsx';
let s = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 60)); s = s.replace(a, b); };

rep("import { ShortcutSheet, BulkBar, UndoRedo, DeleteConfirm } from './TaskBulk';",
"import { ShortcutSheet, BulkBar, UndoRedo, DeleteConfirm } from './TaskBulk';\nimport { ListCards, ListMenu, NewListDialog, DeleteListDialog, MiniCards, withLegacyLists, newListId, INBOX } from './TaskLists';\nimport { useAuth } from '../context/AuthContext';");

rep("  const flatRef = useRef([]);\n",
`  const flatRef = useRef([]);
  const { settings: acct, updateSettings } = useAuth();
  const [listSel, setListSel] = useState(null); // null = all tasks, INBOX, or a list name
  const [showLists, setShowLists] = useState(() => { try { return localStorage.getItem('peblo-task-lists-open') === '1'; } catch { return false; } });
  const [showArch, setShowArch] = useState(false);
  const [menu, setMenu] = useState(null); // { list, anchor }
  const [newList, setNewList] = useState(false);
  const [delList, setDelList] = useState(null);
  const [gPick, setGPick] = useState(null);
`);

// list filter
rep("    return found.filter((t) => t.completed || inView(t, pill));\n  }, [collapsed, q, pill]);",
"    const inList = (t) => (listSel === null ? true : listSel === INBOX ? !t.meta?.list : t.meta?.list === listSel);\n    return found.filter((t) => inList(t) && (t.completed || inView(t, pill)));\n  }, [collapsed, q, pill, listSel]);");

// grouping
rep("  const otherGroups = useMemo(() => (lg === 'when' ? [] : groupTasks(sortTasks(groups.open, ls, SOFT_H), lg, SOFT_H)), [groups.open, lg, ls]);",
`  const otherGroups = useMemo(() => {
    const sorted = sortTasks(groups.open, ls === 'due' || lg === 'when' ? 'due' : ls, SOFT_H);
    if (lg === 'list') {
      const m = new Map();
      for (const t of sorted) { const k = t.meta?.list || INBOX; if (!m.has(k)) m.set(k, { key: k, label: k === INBOX ? 'Inbox' : k, items: [] }); m.get(k).items.push(t); }
      return [...m.values()];
    }
    const g = groupTasks(sorted, lg === 'when' ? 'due' : lg, SOFT_H);
    if (lg === 'when' && groups.done.length) g.push({ key: 'done', label: 'Done', items: groups.done });
    return g;
  }, [groups.open, groups.done, lg, ls]);
  const shownGroups = gPick ? otherGroups.filter((g) => g.key === gPick) : otherGroups;`);

rep("    : (view === 'board' || lg === 'when') ? columns.flatMap((c) => [...c.items, ...(c.extra || [])]) : otherGroups.flatMap((g) => g.items);",
"    : view === 'board' ? columns.flatMap((c) => [...c.items, ...(c.extra || [])]) : shownGroups.flatMap((g) => g.items);");

rep("  const knownLists = [...new Set(todos.map((t) => t.meta?.list).filter(Boolean))].sort();",
`  const reg = Array.isArray(acct?.taskLists) ? acct.taskLists : [];
  const allLists = useMemo(() => withLegacyLists(reg, todos), [reg, todos]); // eslint-disable-line react-hooks/exhaustive-deps
  const knownLists = allLists.filter((l) => !l.archived).map((l) => l.name).sort();
  const listStats = useMemo(() => {
    const st = { [INBOX]: { open: 0, done: 0, overdue: 0 } };
    for (const t of collapsed) {
      const k = t.meta?.list || INBOX;
      const o = (st[k] = st[k] || { open: 0, done: 0, overdue: 0 });
      if (t.completed) o.done += 1; else { o.open += 1; if (isOverdue(t, SOFT_H)) o.overdue += 1; }
    }
    return st;
  }, [collapsed]);
  const saveLists = (next) => updateSettings({ taskLists: next });
  const upsertList = (def) => saveLists(reg.some((l) => l.id === def.id) ? reg.map((l) => (l.id === def.id ? { ...l, ...def } : l)) : [...reg, def]);
  const createList = (name) => { setNewList(false); upsertList({ id: newListId(), name, color: ['peach', 'mint', 'lilac', 'butter', 'sand'][allLists.length % 5] }); setListSel(name); setGPick(null); say(\`List \${name} created\`); };
  const renameList = async (l, name) => {
    if (allLists.some((x) => x.name === name && x.id !== l.id)) { setErr('You already have a list with that name.'); return; }
    await upsertList({ ...l, name, legacy: undefined });
    const moved = todos.filter((t) => t.meta?.list === l.name).map((t) => ({ id: t.id, list: name }));
    if (moved.length) await applyPatches(moved);
    if (listSel === l.name) setListSel(name);
  };
  const colorList = (l, color) => upsertList({ ...l, color, legacy: undefined });
  const archiveList = (l) => { upsertList({ ...l, archived: !l.archived, legacy: undefined }); if (!l.archived && listSel === l.name) setListSel(null); say(l.archived ? \`\${l.name} is back\` : \`\${l.name} archived\`, () => upsertList({ ...l, archived: !!l.archived, legacy: undefined })); };
  const tasksOfList = (l) => collapsed.filter((t) => t.meta?.list === l.name);
  const dropOnList = (key) => { const id = dragId; setDragId(null); setOverCol(null); if (id) bMove(key === INBOX ? null : key, new Set([id])); };
  const confirmDeleteList = async (l, mode) => {
    setDelList(null);
    const before = reg;
    const restoreList = () => saveLists(before);
    await saveLists(reg.filter((x) => x.id !== l.id));
    if (listSel === l.name) setListSel(null);
    const mine = tasksOfList(l);
    if (mode === 'trash' && mine.length) {
      deleteTasks(mine);
      const e = hist.current.undo.at(-1);
      if (e) { const u = e.undo; e.undo = async () => { await u(); await restoreList(); }; }
    } else if (mine.length) {
      const ids = new Set(mine.map((t) => t.id));
      await bulk(\`List \${l.name} deleted\`, ['list'], () => ({ list: null }), ids);
      const e = hist.current.undo.at(-1);
      if (e) { const u = e.undo; e.undo = async () => { await u(); await restoreList(); }; }
    } else say(\`List \${l.name} deleted\`, restoreList);
  };
  const toggleLists = () => { const n = !showLists; setShowLists(n); try { localStorage.setItem('peblo-task-lists-open', n ? '1' : '0'); } catch { /* ignore */ } };`);

// delete refactor
rep("  const doDelete = () => {\n    pendingDel.current?.();\n    const chosen = collapsed.filter((t) => sel.has(t.id));\n    setConfirmDel(false);",
"  const doDelete = () => deleteTasks(collapsed.filter((t) => sel.has(t.id)));\n  const deleteTasks = (chosen) => {\n    pendingDel.current?.();\n    setConfirmDel(false);");

// UI: toolbar button + group seg
rep("        <button type=\"button\" className={`s-selbtn${selMode ? ' on' : ''}`} aria-pressed={selMode} onClick={() => (selMode ? exitSelect() : setSelMode(true))}>Select</button>",
"        <button type=\"button\" className={`s-selbtn${showLists ? ' on' : ''}`} aria-pressed={showLists} onClick={toggleLists}>Lists</button>\n        <button type=\"button\" className={`s-selbtn${selMode ? ' on' : ''}`} aria-pressed={selMode} onClick={() => (selMode ? exitSelect() : setSelMode(true))}>Select</button>");

rep("            <label className=\"s-tt-sel\">Group <select value={lg} onChange={(e) => setLg(e.target.value)} aria-label=\"Group tasks by\">{GROUP_OPTIONS.map(([k, n]) => <option key={k} value={k === 'due' ? 'when' : k}>{n}</option>)}</select></label>\n            {lg !== 'when' && <label className=\"s-tt-sel\">Sort <select value={ls} onChange={(e) => setLs(e.target.value)} aria-label=\"Sort tasks by\">{SORT_OPTIONS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>}",
"            <div className=\"tl-seg\" role=\"group\" aria-label=\"Group tasks by\">{[['none', 'None'], ['when', 'Date'], ['list', 'List'], ['tag', 'Tag'], ['priority', 'Priority']].map(([k, n]) => <button key={k} type=\"button\" className={lg === k ? 'on' : ''} aria-pressed={lg === k} onClick={() => { setLg(k); setGPick(null); }}>{n}</button>)}</div>\n            {lg !== 'when' && <label className=\"s-tt-sel\">Sort <select value={ls} onChange={(e) => setLs(e.target.value)} aria-label=\"Sort tasks by\">{SORT_OPTIONS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>}");

// cards + crumbs above the view
rep("      {view === 'table' ? <TaskTable",
`      {showLists && <ListCards lists={allLists.filter((l) => showArch || !l.archived)} stats={listStats} sel={listSel} dragging={!!dragId} onOpen={(n) => { setListSel(listSel === n ? null : n); setGPick(null); }} onNew={() => setNewList(true)} onMenu={(l, el) => setMenu({ list: l, anchor: el })} onDropTask={dropOnList} />}
      {showLists && allLists.some((l) => l.archived) && <button type="button" className="s-linkbtn" onClick={() => setShowArch(!showArch)}>{showArch ? 'Hide archived lists' : 'Show archived lists'}</button>}
      {(listSel !== null || showLists) && (
        <nav className="tl-crumbs" aria-label="List path" data-testid="list-crumbs">
          <button type="button" onClick={() => { setListSel(null); if (!showLists) toggleLists(); }}>Lists</button><span>/</span>
          <b>{listSel === null ? 'All tasks' : listSel === INBOX ? 'Inbox' : listSel}</b>
          {listSel !== null && <button type="button" className="x" aria-label="Show all tasks" onClick={() => setListSel(null)}>Show all</button>}
        </nav>
      )}
      {view === 'list' && lg !== 'none' && lg !== 'priority' && otherGroups.length > 0 && <MiniCards groups={otherGroups} picked={gPick} onPick={setGPick} />}
      {view === 'table' ? <TaskTable`);

// list rendering
rep("          {lg !== 'when' && otherGroups.map((g) => (", "          {shownGroups.map((g) => (");
s = s.replace(/          \{lg === 'when' && columns\.filter[\s\S]*?\n          \)\)\}\n/, '');

rep("      {sheet && <TaskSheet",
`      {menu && <ListMenu list={menu.list} anchor={menu.anchor} onClose={() => setMenu(null)} onRename={renameList} onColor={colorList} onArchive={archiveList} onDelete={(l) => setDelList(l)} />}
      {newList && <NewListDialog taken={allLists.map((l) => l.name)} onCreate={createList} onClose={() => setNewList(false)} />}
      {delList && <DeleteListDialog list={delList} open={tasksOfList(delList).filter((t) => !t.completed).length} done={tasksOfList(delList).filter((t) => t.completed).length} onCancel={() => setDelList(null)} onConfirm={(m) => confirmDeleteList(delList, m)} />}
      {sheet && <TaskSheet`);
s = s.replace("import './bulk.css';", "import './bulk.css';\nimport './lists.css';");
fs.writeFileSync(f, s);

const a = 'client/src/context/AuthContext.jsx';
let c = fs.readFileSync(a, 'utf8').replace(/\r\n/g, '\n');
c = c.replace("if (u.settings.noteFolders) merged.noteFolders = u.settings.noteFolders; // folders follow the account", "if (u.settings.noteFolders) merged.noteFolders = u.settings.noteFolders; // folders follow the account\n        if (u.settings.taskLists) merged.taskLists = u.settings.taskLists; // so do task lists");
fs.writeFileSync(a, c);
console.log('ok');
