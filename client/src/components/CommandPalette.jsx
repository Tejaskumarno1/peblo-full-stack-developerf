import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search, LayoutDashboard, FileText, Calendar, CheckSquare, Sparkles, File, FolderOpen } from 'lucide-react';
import { notesAPI } from '../api/index';
import '../styles/command-palette.css';

export default function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();
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
      
      // Fetch notes for quick search
      notesAPI.getAll({ sort: 'updated' })
        .then(res => setNotes(res.data.notes || []))
        .catch(console.error);
    }
  }, [isOpen]);

  const filteredNotes = query.trim()
    ? notes.filter(n => (n.title || 'Untitled').toLowerCase().includes(query.toLowerCase())).slice(0, 5)
    : [];

  const navigationCommands = [
    { id: 'nav-dashboard', title: 'Go to Dashboard', icon: <LayoutDashboard size={16} />, action: () => navigate('/') },
    { id: 'nav-notes', title: 'Go to Workspace', icon: <FolderOpen size={16} />, action: () => navigate('/notes') },
    { id: 'nav-tasks', title: 'Go to To-Do List', icon: <CheckSquare size={16} />, action: () => navigate('/todolist') },
    { id: 'nav-cal', title: 'Go to Calendar', icon: <Calendar size={16} />, action: () => navigate('/calendar') },
    { 
      id: 'nav-ai', 
      title: 'Open AI Assistant', 
      icon: <Sparkles size={16} className="text-ai" />, 
      action: () => {
        // We trigger the global shortcut for AI Panel
        const event = new KeyboardEvent('keydown', { key: 'A', shiftKey: true, metaKey: true });
        window.dispatchEvent(event);
      }
    }
  ];

  const filteredCommands = query.trim()
    ? navigationCommands.filter(c => c.title.toLowerCase().includes(query.toLowerCase()))
    : navigationCommands;

  const allItems = [
    ...filteredCommands.map(c => ({ ...c, type: 'command' })),
    ...filteredNotes.map(n => ({ id: `note-${n.id}`, title: n.title || 'Untitled', icon: <File size={16} />, type: 'note', noteId: n.id }))
  ];

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleSelect = (item) => {
    if (!item) return;
    setIsOpen(false);
    if (item.type === 'command') {
      item.action();
    } else if (item.type === 'note') {
      navigate(`/notes/${item.noteId}`);
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
            placeholder="Search notes or type a command..."
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
            </div>
          )}
        </div>
        <div className="cmd-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span>
          <span><kbd>↵</kbd> to select</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
