import fs from 'node:fs';
const f = 'client/src/components/CommandPalette.jsx';
let s = fs.readFileSync(f, 'utf8');
const crlf = s.includes('\r\n');
s = s.replace(/\r\n/g, '\n');
const rep = (a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 70)); s = s.replace(a, () => b); };

rep("import { Search, LayoutDashboard, FileText, Calendar, CheckSquare, Sparkles, File, FolderOpen, Palette } from 'lucide-react';", "import { Search, LayoutDashboard, FileText, Calendar, CheckSquare, Sparkles, File, FolderOpen, Palette, Hash } from 'lucide-react';\nimport { useQueryClient } from '@tanstack/react-query';");
rep("import { notesAPI } from '../api/index';", "import { notesAPI, todosAPI } from '../api/index';\nimport { parseTask } from '../utils/parseTask';");
rep("  const [notes, setNotes] = useState([]);\n", "  const [notes, setNotes] = useState([]);\n  const [tasks, setTasks] = useState([]);\n  const queryClient = useQueryClient();\n");
rep("      // Fetch notes for quick search\n", "      todosAPI.getAll().then((res) => setTasks(res.data.todos || [])).catch(() => {});\n      // Fetch notes for quick search\n");

rep("  const matchingCommands = query.trim()", `  // "add call mum tomorrow 6pm" makes a task, understood the same way as the Tasks page add box
  const addMatch = query.trim().match(/^(?:add|task|todo)[:\\s]\\s*(\\S.*)$/i);
  const addParsed = addMatch ? parseTask(addMatch[1]) : null;
  const addTask = async () => {
    if (!addParsed || !addParsed.text) return;
    let when = addParsed.deadline;
    if (!when && addParsed.recurrence !== 'none') { when = new Date(); when.setHours(9, 0, 0, 0); if (when < new Date()) when.setDate(when.getDate() + 1); }
    try {
      await todosAPI.create({ text: addParsed.text, priority: addParsed.priority, tags: addParsed.tags, deadline: when ? when.toISOString() : null, ...(addParsed.recurrence !== 'none' ? { recurrence: addParsed.recurrence } : {}) });
      queryClient.invalidateQueries({ queryKey: ['todos'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      window.dispatchEvent(new CustomEvent('pb-upload', { detail: { state: 'done', message: 'Task added' } }));
    } catch { /* the palette just closes */ }
  };
  const addCmd = addParsed && addParsed.text
    ? [{ id: 'add-task', title: \`Add: \${addParsed.text}\${addParsed.deadline ? \` (\${addParsed.deadline.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}\${addParsed.allDay ? '' : \`, \${addParsed.deadline.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}\`})\` : ''}\`, icon: <CheckSquare size={16} />, action: addTask }]
    : [];
  const tq = query.trim().toLowerCase().replace(/^#/, '');
  const seenSeries = new Set();
  const taskHits = tq.length >= 2 && !addMatch
    ? tasks.filter((t) => !t.completed && String(t.text).toLowerCase().includes(tq) && (!t.seriesId || (!seenSeries.has(t.seriesId) && seenSeries.add(t.seriesId)))).slice(0, 4)
    : [];
  const tagHits = tq.length >= 2 && !addMatch
    ? [...new Set(tasks.flatMap((t) => t.todoTags || []))].filter((g) => String(g).toLowerCase().includes(tq)).slice(0, 3)
    : [];

  const matchingCommands = query.trim()`);
rep("    ? [{ id: 'ask-ai', title: `Ask AI: \"${query.trim()}\"`, icon: <Sparkles size={16} />, action: () => navigate(`/ai?q=${encodeURIComponent(query.trim())}`) }, ...matchingCommands]\n    : matchingCommands;",
  "    ? [...addCmd, { id: 'ask-ai', title: `Ask AI: \"${query.trim()}\"`, icon: <Sparkles size={16} />, action: () => navigate(`/ai?q=${encodeURIComponent(query.trim())}`) }, ...matchingCommands]\n    : [...addCmd, ...matchingCommands];");
rep("    ...filteredNotes.map(n => ({ id: `note-${n.id}`, title: n.title || 'Untitled', icon: <File size={16} />, type: 'note', noteId: n.id }))\n  ];",
  "    ...filteredNotes.map(n => ({ id: `note-${n.id}`, title: n.title || 'Untitled', icon: <File size={16} />, type: 'note', noteId: n.id })),\n    ...taskHits.map((t) => ({ id: `task-${t.id}`, title: t.text, icon: <CheckSquare size={16} />, type: 'task', taskId: t.id })),\n    ...tagHits.map((g) => ({ id: `tag-${g}`, title: `#${g}`, icon: <Hash size={16} />, type: 'tag', tag: g })),\n  ];");
rep("    } else if (item.type === 'note') {\n      navigate(`/notes/${item.noteId}`);\n    }", "    } else if (item.type === 'note') {\n      navigate(`/notes/${item.noteId}`);\n    } else if (item.type === 'task') {\n      navigate(`/tasks?task=${item.taskId}`);\n    } else if (item.type === 'tag') {\n      navigate(`/tasks?q=${encodeURIComponent(item.tag)}`);\n    }");
rep('placeholder="Search notes or type a command..."', 'placeholder="Search notes and tasks, or type a command..."');

// sections for tasks and tags
rep("            </div>\n          )}\n        </div>\n        <div className=\"cmd-footer\">", `              {taskHits.length > 0 && <div className="cmd-section-title" style={{ marginTop: '8px' }}>Tasks</div>}
              {allItems.filter((i) => i.type === 'task').map((item, index) => {
                const actualIndex = filteredCommands.length + filteredNotes.length + index;
                return (
                  <div key={item.id} className={\`cmd-item \${actualIndex === selectedIndex ? 'selected' : ''}\`} onMouseEnter={() => setSelectedIndex(actualIndex)} onClick={() => handleSelect(item)}>
                    <span className="cmd-item-icon">{item.icon}</span>
                    <span className="cmd-item-title">{item.title}</span>
                  </div>
                );
              })}
              {tagHits.length > 0 && <div className="cmd-section-title" style={{ marginTop: '8px' }}>Tags</div>}
              {allItems.filter((i) => i.type === 'tag').map((item, index) => {
                const actualIndex = filteredCommands.length + filteredNotes.length + taskHits.length + index;
                return (
                  <div key={item.id} className={\`cmd-item \${actualIndex === selectedIndex ? 'selected' : ''}\`} onMouseEnter={() => setSelectedIndex(actualIndex)} onClick={() => handleSelect(item)}>
                    <span className="cmd-item-icon">{item.icon}</span>
                    <span className="cmd-item-title">{item.title}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="cmd-footer">`);
s = s.replace(/<div className="cmd-footer">[\s\S]*?<\/div>/, () => '<div className="cmd-footer">\n          <span><kbd>Up</kbd><kbd>Down</kbd> to navigate</span>\n          <span><kbd>Enter</kbd> to select</span>\n        </div>');
if (crlf) s = s.replace(/\n/g, '\r\n');
fs.writeFileSync(f, s);
console.log('ok');
