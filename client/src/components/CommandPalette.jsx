import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Image as ImageIcon, Search, LayoutDashboard, FileText, Calendar, CheckSquare, Sparkles, File, FolderOpen, Palette, Hash, CalendarClock } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { notesAPI, todosAPI, mediaSearchAPI } from '../api/index';
import { useSpaceName } from '../soft/spaces';
import { parseTask } from '../utils/parseTask';
import { TEMPLATES } from '../orbit/noteTemplates';
import '../styles/command-palette.css';

const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The query's words picked out in a result, so you can see why it matched. */
function Hl({ text, q }) {
  const w = (q || '').trim().replace(/^#/, '');
  if (w.length < 2) return text;
  return String(text).split(new RegExp('(' + esc(w) + ')', 'ig')).map((p, i) => (p.toLowerCase() === w.toLowerCase() ? <mark key={i} className="cmd-hl">{p}</mark> : p));
}
const snipOf = (n, q) => {
  const txt = String(n.content || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!txt) return '';
  const i = txt.toLowerCase().indexOf((q || '').trim().toLowerCase());
  const a = Math.max(0, i - 20);
  return (a > 0 ? '...' : '') + txt.slice(a, a + 70) + (txt.length > a + 70 ? '...' : '');
};

export default function CommandPalette() {
  const spaceName = useSpaceName();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState([]);
  const [tasks, setTasks] = useState([]);
  const queryClient = useQueryClient();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scope, setScope] = useState('all'); // all | notes | tasks (Tab cycles)
  const SCOPES = [['all', 'All'], ['notes', 'Notes'], ['tasks', 'Tasks']];
  const inScope = (k) => scope === 'all' || scope === k;
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
      setScope('all');
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
  const [picHits, setPicHits] = useState({ q: '', list: [] });
  useEffect(() => {
    const t = query.trim();
    if (t.length < 2) { setHits(null); setPicHits({ q: '', list: [] }); return undefined; }
    const timer = setTimeout(() => {
      notesAPI.getAll({ search: t, snippet: '1', limit: 6 }).then((r) => setHits({ q: t, notes: r.data.notes || [] })).catch(() => {});
      mediaSearchAPI.search(t).then((r) => setPicHits({ q: t, list: r.data.pictures || [] })).catch(() => {});
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);
  const filteredNotes = inScope('notes') && query.trim()
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
  const taskHits = inScope('tasks') && tq.length >= 2 && !addMatch
    ? tasks.filter((t) => !t.completed && !t.startTime && String(t.text).toLowerCase().includes(tq) && (!t.seriesId || (!seenSeries.has(t.seriesId) && seenSeries.add(t.seriesId)))).slice(0, 4)
    : [];
  const tagHits = inScope('tasks') && tq.length >= 2 && !addMatch
    ? [...new Set(tasks.flatMap((t) => t.todoTags || []))].filter((g) => String(g).toLowerCase().includes(tq)).slice(0, 3)
    : [];

  const eventHits = inScope('tasks') && tq.length >= 2 && !addMatch
    ? tasks.filter((t) => t.startTime && !t.completed && String(t.text).toLowerCase().includes(tq)).slice(0, 3)
    : [];
  const matchingCommands = query.trim()
    ? navigationCommands.filter(c => c.title.toLowerCase().includes(query.toLowerCase()))
    : navigationCommands;
  // Anything typed can also be asked in the AI Hub, answered from your notes.
  const filteredCommands = scope !== 'all' ? [] : query.trim().length > 2
    ? [...addCmd, { id: 'ask-ai', title: `Ask AI: "${query.trim()}"`, icon: <Sparkles size={16} />, action: () => navigate(`/ai?q=${encodeURIComponent(query.trim())}`) }, ...matchingCommands]
    : [...addCmd, ...matchingCommands];

  const pictureHits = scope === 'all' && picHits.q === query.trim() && !addMatch ? picHits.list : [];
  const allItems = [
    ...filteredCommands.map(c => ({ ...c, type: 'command' })),
    ...filteredNotes.map(n => ({ id: `note-${n.id}`, title: n.title || 'Untitled', icon: <File size={16} />, type: 'note', noteId: n.id, sub: snipOf(n, query) })),
    ...taskHits.map((t) => ({ id: `task-${t.id}`, title: t.text, icon: <CheckSquare size={16} />, type: 'task', taskId: t.id, sub: [t.deadline && 'Due ' + new Date(t.deadline).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }), (t.todoTags || [])[0]].filter(Boolean).join(', ') })),
    ...tagHits.map((g) => ({ id: `tag-${g}`, title: `#${g}`, icon: <Hash size={16} />, type: 'tag', tag: g, sub: tasks.filter((t) => (t.todoTags || []).includes(g)).length + ' tasks' })),
    ...eventHits.map((t) => ({ id: `ev-${t.id}`, title: t.text, icon: <CalendarClock size={16} />, type: 'event', taskId: t.id, sub: [t.deadline && new Date(t.deadline).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }), t.startTime].filter(Boolean).join(' ') })),
    ...pictureHits.map((p) => ({ id: `pic-${p.id}`, title: p.snippet, icon: <ImageIcon size={16} />, type: 'picture', url: p.url })),
  ];

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, scope]);

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
    } else if (item.type === 'task' || item.type === 'event') {
      navigate(`/tasks?task=${item.taskId}`);
    } else if (item.type === 'picture') {
      window.open(item.url, '_blank', 'noopener');
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
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const i = SCOPES.findIndex(([k]) => k === scope);
      setScope(SCOPES[(i + (e.shiftKey ? SCOPES.length - 1 : 1)) % SCOPES.length][0]);
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
            placeholder={spaceName ? `Search in ${spaceName}, or type a command...` : 'Search notes and tasks, or type a command...'}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="cmd-tabs" role="tablist" aria-label="Search in">
            {SCOPES.map(([k, name]) => <button key={k} type="button" role="tab" aria-selected={scope === k} className={scope === k ? 'on' : ''} onClick={() => { setScope(k); inputRef.current?.focus(); }}>{name}</button>)}
          </div>
          <div className="cmd-badge">esc</div>
        </div>
        
        <div className="cmd-body" ref={listRef}>
          {allItems.length === 0 ? (
            <div className="cmd-empty">{query.trim() ? `No results found for "${query}"` : scope === 'all' ? 'Nothing here yet.' : `Type to search ${scope}.`}</div>
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

              {[
                ['note', 'Notes', filteredNotes.length, hits && hits.q === query.trim() ? hits.notes.length : filteredNotes.length, () => navigate('/notes?q=' + encodeURIComponent(query.trim()))],
                ['task', 'Tasks', taskHits.length, taskHits.length, () => navigate('/tasks?q=' + encodeURIComponent(query.trim()))],
                ['tag', 'Tags', tagHits.length, tagHits.length],
                ['event', 'Events', eventHits.length, eventHits.length, () => navigate('/calendar')],
                ['picture', 'Pictures', pictureHits.length, pictureHits.length],
              ].filter(([, , n]) => n > 0).map(([type, name, n, total, seeAll]) => {
                const base = allItems.findIndex((i) => i.type === type);
                return (
                  <div key={type} className="cmd-group" data-testid={'cmd-group-' + type}>
                    <div className="cmd-section-title cmd-gh"><span>{name}</span><span className="cmd-count">{total}</span><span className="grow" />{seeAll && total > 1 && <button type="button" className="cmd-seeall" onClick={() => { setIsOpen(false); seeAll(); }}>See all {total}</button>}</div>
                    {allItems.filter((i) => i.type === type).map((item, k) => (
                      <div key={item.id} data-testid={type === 'picture' ? 'picture-hit' : undefined} className={`cmd-item ${base + k === selectedIndex ? 'selected' : ''}`} onMouseEnter={() => setSelectedIndex(base + k)} onClick={() => handleSelect(item)}>
                        <span className="cmd-item-icon">{item.icon}</span>
                        <span className="cmd-item-text"><span className="cmd-item-title"><Hl text={item.title} q={query} /></span>{item.sub ? <span className="cmd-item-sub"><Hl text={item.sub} q={query} /></span> : null}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="cmd-footer">
          <span><kbd>Up</kbd><kbd>Down</kbd> to navigate</span>
          <span><kbd>Enter</kbd> to select</span>
          <span><kbd>Tab</kbd> to filter</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
