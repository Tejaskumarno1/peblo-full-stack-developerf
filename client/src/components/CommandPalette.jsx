import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search, LayoutDashboard, FileText, Calendar, CheckSquare, Sparkles, File, FolderOpen, Palette, Hash } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { notesAPI, todosAPI } from '../api/index';
import { parseTask } from '../utils/parseTask';
import { TEMPLATES } from '../orbit/noteTemplates';
import '../styles/command-palette.css';

export default function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState([]);
  const [tasks, setTasks] = useState([]);
  const queryClient = useQueryClient();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
  const { uiStyle, setUiStyle } = useAuth();
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
      
      todosAPI.getAll().then((res) => setTasks(res.data.todos || [])).catch(() => {});
      // Fetch notes for quick search
      notesAPI.getAll({ sort: 'updated' })
        .then(res => setNotes(res.data.notes || []))
        .catch(console.error);
    }
  }, [isOpen]);

  // Typing asks the server, which ranks by title, tags and text and forgives a typo; until it answers, titles are matched here.
  const [hits, setHits] = useState(null);
  useEffect(() => {
    const t = query.trim();
    if (t.length < 2) { setHits(null); return undefined; }
    const timer = setTimeout(() => {
      notesAPI.getAll({ search: t, snippet: '1', limit: 6 }).then((r) => setHits({ q: t, notes: r.data.notes || [] })).catch(() => {});
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);
  const filteredNotes = query.trim()
    ? (hits && hits.q === query.trim() ? hits.notes.slice(0, 6) : notes.filter(n => (n.title || 'Untitled').toLowerCase().includes(query.toLowerCase())).slice(0, 5))
    : [];

  const openNew = async (data) => {
    try { const r = await notesAPI.create(data); navigate(`/notes/${r.data.note.id}`); } catch { /* the palette just closes */ }
  };
  const openToday = async () => {
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    try { const r = await notesAPI.daily(date); navigate(`/notes/${r.data.note.id}`); } catch { /* the palette just closes */ }
  };

  const navigationCommands = [
    { id: 'daily-note', title: "Open today's daily note", icon: <Calendar size={16} />, action: openToday },
    ...TEMPLATES.map((t) => ({ id: `tpl-${t.id}`, title: `New note from template: ${t.name}`, icon: <FileText size={16} />, action: () => openNew({ title: t.title.trim() || t.name, content: t.content, tags: [] }) })),
    { id: 'nav-dashboard', title: 'Go to Home', icon: <LayoutDashboard size={16} />, action: () => navigate('/') },
    { id: 'nav-notes', title: 'Go to Notes', icon: <FolderOpen size={16} />, action: () => navigate('/notes') },
    { id: 'nav-tasks', title: 'Go to Tasks', icon: <CheckSquare size={16} />, action: () => navigate('/tasks') },
    { id: 'nav-cal', title: 'Go to Calendar', icon: <Calendar size={16} />, action: () => navigate('/calendar') },
    { id: 'nav-ai', title: 'Open AI Hub', icon: <Sparkles size={16} />, action: () => navigate('/ai') },
    { id: 'help', title: 'Help and shortcuts', icon: <Search size={16} />, action: () => window.dispatchEvent(new Event('peblo:help')) },
    { id: 'nav-connections', title: 'AI models and privacy', icon: <Sparkles size={16} />, action: () => navigate('/ai/connections') },
    ...[['soft', 'Soft Studio'], ['river', 'River'], ['orbit', 'Orbit']]
      .filter(([id]) => id !== uiStyle)
      .map(([id, name]) => ({ id: `style-${id}`, title: `Change style to ${name}`, icon: <Palette size={16} />, action: () => setUiStyle(id) }))
  ];

  // "add call mum tomorrow 6pm" makes a task, understood the same way as the Tasks page add box
  const addMatch = query.trim().match(/^(?:add|task|todo)[:\s]\s*(\S.*)$/i);
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
    ? [{ id: 'add-task', title: `Add: ${addParsed.text}${addParsed.deadline ? ` (${addParsed.deadline.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}${addParsed.allDay ? '' : `, ${addParsed.deadline.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`})` : ''}`, icon: <CheckSquare size={16} />, action: addTask }]
    : [];
  const tq = query.trim().toLowerCase().replace(/^#/, '');
  const seenSeries = new Set();
  const taskHits = tq.length >= 2 && !addMatch
    ? tasks.filter((t) => !t.completed && String(t.text).toLowerCase().includes(tq) && (!t.seriesId || (!seenSeries.has(t.seriesId) && seenSeries.add(t.seriesId)))).slice(0, 4)
    : [];
  const tagHits = tq.length >= 2 && !addMatch
    ? [...new Set(tasks.flatMap((t) => t.todoTags || []))].filter((g) => String(g).toLowerCase().includes(tq)).slice(0, 3)
    : [];

  const matchingCommands = query.trim()
    ? navigationCommands.filter(c => c.title.toLowerCase().includes(query.toLowerCase()))
    : navigationCommands;
  // Anything typed can also be asked in the AI Hub, answered from your notes.
  const filteredCommands = query.trim().length > 2
    ? [...addCmd, { id: 'ask-ai', title: `Ask AI: "${query.trim()}"`, icon: <Sparkles size={16} />, action: () => navigate(`/ai?q=${encodeURIComponent(query.trim())}`) }, ...matchingCommands]
    : [...addCmd, ...matchingCommands];

  const allItems = [
    ...filteredCommands.map(c => ({ ...c, type: 'command' })),
    ...filteredNotes.map(n => ({ id: `note-${n.id}`, title: n.title || 'Untitled', icon: <File size={16} />, type: 'note', noteId: n.id })),
    ...taskHits.map((t) => ({ id: `task-${t.id}`, title: t.text, icon: <CheckSquare size={16} />, type: 'task', taskId: t.id })),
    ...tagHits.map((g) => ({ id: `tag-${g}`, title: `#${g}`, icon: <Hash size={16} />, type: 'tag', tag: g })),
  ];

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // keep the highlighted row on screen when moving with the arrow keys
  useEffect(() => {
    listRef.current?.querySelector('.cmd-item.selected')?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, isOpen]);

  const handleSelect = (item) => {
    if (!item) return;
    setIsOpen(false);
    if (item.type === 'command') {
      item.action();
    } else if (item.type === 'note') {
      navigate(`/notes/${item.noteId}`);
    } else if (item.type === 'task') {
      navigate(`/tasks?task=${item.taskId}`);
    } else if (item.type === 'tag') {
      navigate(`/tasks?q=${encodeURIComponent(item.tag)}`);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, allItems.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + allItems.length) % Math.max(1, allItems.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (allItems.length > 0) {
        handleSelect(allItems[selectedIndex]);
      }
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="cmd-overlay" onClick={() => setIsOpen(false)}>
      <div className="cmd-palette" onClick={e => e.stopPropagation()}>
        <div className="cmd-header">
          <Search size={20} className="cmd-search-icon" />
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="Search notes and tasks, or type a command..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="cmd-badge">esc</div>
        </div>
        
        <div className="cmd-body" ref={listRef}>
          {allItems.length === 0 ? (
            <div className="cmd-empty">No results found for "{query}"</div>
          ) : (
            <div className="cmd-list">
              {filteredCommands.length > 0 && <div className="cmd-section-title">Navigation & Actions</div>}
              {allItems.filter(i => i.type === 'command').map((item, index) => (
                <div
                  key={item.id}
                  className={`cmd-item ${index === selectedIndex ? 'selected' : ''}`}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => handleSelect(item)}
                >
                  <span className="cmd-item-icon">{item.icon}</span>
                  <span className="cmd-item-title">{item.title}</span>
                </div>
              ))}

              {filteredNotes.length > 0 && <div className="cmd-section-title" style={{ marginTop: '8px' }}>Notes</div>}
              {allItems.filter(i => i.type === 'note').map((item, index) => {
                // Adjust index based on how many commands precede it
                const actualIndex = filteredCommands.length + index;
                return (
                  <div
                    key={item.id}
                    className={`cmd-item ${actualIndex === selectedIndex ? 'selected' : ''}`}
                    onMouseEnter={() => setSelectedIndex(actualIndex)}
                    onClick={() => handleSelect(item)}
                  >
                    <span className="cmd-item-icon">{item.icon}</span>
                    <span className="cmd-item-title">{item.title}</span>
                  </div>
                );
              })}
              {taskHits.length > 0 && <div className="cmd-section-title" style={{ marginTop: '8px' }}>Tasks</div>}
              {allItems.filter((i) => i.type === 'task').map((item, index) => {
                const actualIndex = filteredCommands.length + filteredNotes.length + index;
                return (
                  <div key={item.id} className={`cmd-item ${actualIndex === selectedIndex ? 'selected' : ''}`} onMouseEnter={() => setSelectedIndex(actualIndex)} onClick={() => handleSelect(item)}>
                    <span className="cmd-item-icon">{item.icon}</span>
                    <span className="cmd-item-title">{item.title}</span>
                  </div>
                );
              })}
              {tagHits.length > 0 && <div className="cmd-section-title" style={{ marginTop: '8px' }}>Tags</div>}
              {allItems.filter((i) => i.type === 'tag').map((item, index) => {
                const actualIndex = filteredCommands.length + filteredNotes.length + taskHits.length + index;
                return (
                  <div key={item.id} className={`cmd-item ${actualIndex === selectedIndex ? 'selected' : ''}`} onMouseEnter={() => setSelectedIndex(actualIndex)} onClick={() => handleSelect(item)}>
                    <span className="cmd-item-icon">{item.icon}</span>
                    <span className="cmd-item-title">{item.title}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="cmd-footer">
          <span><kbd>Up</kbd><kbd>Down</kbd> to navigate</span>
          <span><kbd>Enter</kbd> to select</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
