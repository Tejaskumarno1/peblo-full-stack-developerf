import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { notesAPI, aiAPI } from '../api/index';
import { useDebounce, useAutoSave, useKeyboardShortcut } from '../hooks/index';
import { stripMarkdown, formatRelativeDate, stringToColorClass } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';
import Navigation from '../components/Navigation';
import ShareModal from '../components/ShareModal';
import { marked } from 'marked';
import {
  Sparkles,
  Archive,
  Trash2,
  Link2,
  Edit2,
  Eye,
  Check,
  Loader2,
  Search,
  PanelLeftClose,
  PanelLeft,
  Plus,
  PenLine,
  History,
  Save,
  MessageSquare,
  X,
  Download,
  Columns,
} from 'lucide-react';
import '../styles/workspace.css';

function countWords(text) {
  const trimmed = text?.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

export default function WorkspacePage() {
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const { settings } = useAuth();

  const [notes, setNotes] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [sortBy, setSortBy] = useState('updated');
  const [showArchived, setShowArchived] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const [selectedNote, setSelectedNote] = useState(null);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [noteTags, setNoteTags] = useState([]);
  const [noteCategory, setNoteCategory] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [editorMode, setEditorMode] = useState('split'); // 'edit' | 'split' | 'preview'

  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiPanelTab, setAiPanelTab] = useState('assist');
  const [aiResults, setAiResults] = useState({});
  const [aiError, setAiError] = useState('');
  
  const [wsChatInput, setWsChatInput] = useState('');
  const [wsChatMessages, setWsChatMessages] = useState([]);
  const [wsChatLoading, setWsChatLoading] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  
  const [showBackups, setShowBackups] = useState(false);
  const [backupsList, setBackupsList] = useState([]);
  const [loadingBackups, setLoadingBackups] = useState(false);

  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const exportRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (exportRef.current && !exportRef.current.contains(e.target)) {
        setExportDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const debouncedSearch = useDebounce(searchQuery, 400);
  const wordCount = useMemo(() => countWords(noteContent), [noteContent]);

  const saveData = useMemo(() => {
    if (!selectedNote) return null;
    if (selectedNote.isDraft && !noteTitle.trim() && !noteContent.trim()) return null;
    return { title: noteTitle, content: noteContent, tags: noteTags, category: noteCategory || undefined };
  }, [noteTitle, noteContent, noteTags, noteCategory, selectedNote]);

  const persistDraft = useCallback(async (title, content, tags, category) => {
    try {
      const res = await notesAPI.create({
        title: title || 'Untitled',
        content: content || '',
        tags,
        category: category || undefined,
      });
      const newNote = res.data.note;
      setNotes((prev) => [newNote, ...prev]);
      setSelectedNote(newNote);
      navigate(`/notes/${newNote.id}`, { replace: true });
      return newNote;
    } catch (err) {
      console.error('Failed to persist draft:', err);
      return null;
    }
  }, [navigate]);

  const handleSave = useCallback(async (noteId, data) => {
    if (noteId === '__draft__') {
      if (!data.title?.trim() && !data.content?.trim()) return;
      const created = await persistDraft(data.title, data.content, data.tags, data.category);
      if (!created) throw new Error('Failed to save new note');
      return;
    }
    const res = await notesAPI.update(noteId, data);
    const saved = res.data.note;
    setNotes((prev) => prev.map((n) => (n.id === noteId ? saved : n)));
    setSelectedNote((prev) => (prev?.id === noteId ? saved : prev));
  }, [persistDraft]);

  const { saveStatus, forceSave } = useAutoSave(selectedNote?.id, saveData, handleSave);

  const handleCreateNote = useCallback(() => {
    const draftNote = {
      id: '__draft__',
      title: '',
      content: '',
      tags: [],
      category: '',
      isDraft: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setSelectedNote(draftNote);
    setNoteTitle('');
    setNoteContent('');
    setNoteTags([]);
    setNoteCategory('');
    setAiResults({});
    setAiError('');
    setAiPanelOpen(false);
    setEditorMode('edit');
    navigate('/notes', { replace: true });
  }, [navigate]);

  useKeyboardShortcut('s', () => forceSave(), { ctrl: true });
  useKeyboardShortcut('k', () => document.getElementById('search-input')?.focus(), { ctrl: true });
  useKeyboardShortcut('n', handleCreateNote, { ctrl: true });
  useKeyboardShortcut('p', () => {
    setEditorMode((prev) => {
      if (prev === 'edit') return 'split';
      if (prev === 'split') return 'preview';
      return 'edit';
    });
  }, { ctrl: true });
  useKeyboardShortcut('j', () => setAiPanelOpen((p) => !p), { ctrl: true });

  const fetchNotes = useCallback(async () => {
    try {
      const params = { sort: sortBy, archived: showArchived.toString() };
      if (debouncedSearch) params.search = debouncedSearch;
      if (filterTag) params.tag = filterTag;
      const res = await notesAPI.getAll(params);
      setNotes(res.data.notes);
    } catch (err) {
      console.error('Failed to fetch notes:', err);
    } finally {
      setListLoading(false);
    }
  }, [debouncedSearch, filterTag, sortBy, showArchived]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  useEffect(() => {
    const handleGlobalUpdate = (e) => {
      const updatedNote = e.detail;
      setNotes((prev) => prev.map((n) => (n.id === updatedNote.id ? updatedNote : n)));
      if (selectedNote?.id === updatedNote.id) {
        setNoteContent(updatedNote.content || '');
        setNoteTitle(updatedNote.title || '');
        setNoteTags(updatedNote.tags || []);
        setSelectedNote(updatedNote);
      }
    };
    window.addEventListener('note-updated', handleGlobalUpdate);
    return () => window.removeEventListener('note-updated', handleGlobalUpdate);
  }, [selectedNote]);

  useEffect(() => {
    if (aiPanelOpen) {
      document.body.classList.add('ai-panel-open');
    } else {
      document.body.classList.remove('ai-panel-open');
    }
    return () => document.body.classList.remove('ai-panel-open');
  }, [aiPanelOpen]);

  const loadBackups = async () => {
    if (!selectedNote || selectedNote.isDraft || selectedNote.id === '__draft__') return;
    setLoadingBackups(true);
    setShowBackups(true);
    try {
      const res = await notesAPI.getBackups(selectedNote.id);
      setBackupsList(res.data.backups || []);
    } catch (err) {
      console.error('Failed to load backups', err);
    } finally {
      setLoadingBackups(false);
    }
  };

  const handleRestoreBackup = async (backupId) => {
    if (!confirm('Are you sure you want to restore this version? Current changes will be overwritten.')) return;
    try {
      const res = await notesAPI.revertBackup(selectedNote.id, backupId);
      applyNoteToEditor(res.data.note);
      setNotes(prev => prev.map(n => n.id === res.data.note.id ? res.data.note : n));
      setShowBackups(false);
    } catch (err) {
      console.error('Failed to restore backup', err);
    }
  };

  const handleExport = (format) => {
    let mimeType = 'text/plain';
    let fileExtension = 'txt';
    let outputContent = noteContent;

    if (format === 'md') {
      mimeType = 'text/markdown';
      fileExtension = 'md';
      outputContent = `# ${noteTitle || 'Untitled'}\n\n${noteContent}`;
    } else if (format === 'html') {
      mimeType = 'text/html';
      fileExtension = 'html';
      outputContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${noteTitle || 'Untitled'}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1e293b; background: #f8fafc; }
    .container { background: #ffffff; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1); border: 1px solid #e2e8f0; }
    h1 { border-bottom: 2px solid #6366f1; padding-bottom: 10px; color: #0f172a; margin-top: 0; }
    pre { background: #0f172a; padding: 16px; border-radius: 8px; overflow-x: auto; color: #f8fafc; }
    code { font-family: monospace; font-size: 0.9em; }
    blockquote { border-left: 4px solid #6366f1; padding-left: 16px; color: #475569; font-style: italic; margin: 20px 0; }
    img { max-width: 100%; border-radius: 8px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${noteTitle || 'Untitled'}</h1>
    <div>${marked.parse(noteContent || '')}</div>
  </div>
</body>
</html>`;
    } else if (format === 'pdf') {
      const printWindow = window.open('', '_blank');
      if (!printWindow) return;
      printWindow.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${noteTitle || 'Untitled'}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; padding: 40px; color: #1e293b; background: #ffffff; }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { border-bottom: 2px solid #6366f1; padding-bottom: 10px; color: #0f172a; margin-top: 0; }
    pre { background: #0f172a; padding: 16px; border-radius: 8px; overflow-x: auto; color: #f8fafc; }
    code { font-family: monospace; font-size: 0.9em; }
    blockquote { border-left: 4px solid #6366f1; padding-left: 16px; color: #475569; font-style: italic; margin: 20px 0; }
    img { max-width: 100%; border-radius: 8px; }
    @media print {
      body { padding: 0; background: #ffffff; }
      @page { size: auto; margin: 20mm; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>${noteTitle || 'Untitled'}</h1>
    <div>${marked.parse(noteContent || '')}</div>
  </div>
  <script>
    setTimeout(function() {
      window.focus();
      window.print();
      window.close();
    }, 450);
  </script>
</body>
</html>`);
      printWindow.document.close();
      return;
    }

    const blob = new Blob([outputContent], { type: `${mimeType};charset=utf-8;` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${(noteTitle || 'Untitled').trim().replace(/\s+/g, '_')}.${fileExtension}`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const applyNoteToEditor = useCallback((note) => {
    setSelectedNote(note);
    setNoteTitle(note.title || '');
    setNoteContent(note.content || '');
    setNoteTags(note.tags || []);
    setNoteCategory(note.category || '');
    
    // Parse and pre-populate previously persisted AI summaries and insights
    const loadedAI = {};
    if (note.aiGenerations && Array.isArray(note.aiGenerations)) {
      note.aiGenerations.forEach((gen) => {
        if (gen.type && gen.result) {
          loadedAI[gen.type] = gen.result;
        }
      });
    }
    setAiResults(loadedAI);
    
    setAiError('');
    setAiPanelOpen(false);
    setEditorMode(note.id === '__draft__' ? 'edit' : 'split');
  }, []);

  const selectNote = useCallback(
    (note) => {
      forceSave(); // Safe background save, does not block routing
      if (note.id === '__draft__') {
        applyNoteToEditor(note);
        navigate('/notes', { replace: true });
      } else {
        navigate(`/notes/${note.id}`, { replace: true });
      }
    },
    [applyNoteToEditor, navigate, forceSave]
  );

  const lastRouteIdRef = useRef(null);

  useEffect(() => {
    if (!routeId) {
      lastRouteIdRef.current = null;
      return;
    }

    // Bypass if we are already actively editing or loaded this routeId
    if (lastRouteIdRef.current === routeId && selectedNote?.id === routeId) {
      return;
    }

    const noteInList = notes.find((n) => n.id === routeId);
    if (noteInList && noteInList.content !== undefined) {
      if (selectedNote?.id !== routeId) {
        lastRouteIdRef.current = routeId;
        applyNoteToEditor(noteInList);
      }
      return;
    }

    if (listLoading) return;

    let cancelled = false;
    notesAPI
      .get(routeId)
      .then((res) => {
        if (cancelled) return;
        const note = res.data.note;
        lastRouteIdRef.current = note.id;
        setNotes((prev) => {
          if (prev.some((n) => n.id === note.id)) {
            return prev.map((n) => (n.id === note.id ? note : n));
          }
          return [note, ...prev];
        });
        applyNoteToEditor(note);
      })
      .catch(() => {
        if (!cancelled) navigate('/notes', { replace: true });
      });

    return () => {
      cancelled = true;
    };
  }, [routeId, notes, listLoading, selectedNote?.id, applyNoteToEditor, navigate]);

  const handleDeleteNote = async (noteId) => {
    if (!confirm('Delete this note?')) return;
    try {
      await notesAPI.delete(noteId);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      if (selectedNote?.id === noteId) {
        setSelectedNote(null);
        navigate('/notes', { replace: true });
      }
    } catch (err) {
      console.error('Failed to delete note:', err);
    }
  };

  const handleArchiveNote = async (noteId) => {
    try {
      await notesAPI.archive(noteId);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      if (selectedNote?.id === noteId) {
        setSelectedNote(null);
        navigate('/notes', { replace: true });
      }
    } catch (err) {
      console.error('Failed to archive note:', err);
    }
  };

  const handleToggleShare = async () => {
    if (!selectedNote || isDraft) return;
    try {
      const res = await notesAPI.share(selectedNote.id);
      const updatedNote = res.data.note;
      
      setNotes((prev) => prev.map((n) => (n.id === updatedNote.id ? updatedNote : n)));
      setSelectedNote(updatedNote);
    } catch (err) {
      console.error('Failed to share note:', err);
      alert('Failed to update sharing settings.');
    }
  };

  const handleAddTag = (e) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault();
      const tag = tagInput.trim().toLowerCase();
      if (!noteTags.includes(tag)) {
        setNoteTags((prev) => [...prev, tag]);
      }
      setTagInput('');
    }
  };

  const handleRemoveTag = (tag) => {
    setNoteTags((prev) => prev.filter((t) => t !== tag));
  };

  const generateAIContent = async (type) => {
    if (!selectedNote) return;

    if (!noteContent.trim()) {
      setAiError('Add some note content before using AI.');
      return;
    }

    setAiError('');
    setGenerating(true);

    try {
      let noteId = selectedNote.id;
      let noteRef = selectedNote;

      if (selectedNote.isDraft || noteId === '__draft__') {
        const saved = await persistDraft(noteTitle, noteContent, noteTags, noteCategory);
        if (!saved?.id) {
          setAiError('Could not save the note. Try again or press Ctrl+S first.');
          return;
        }
        noteId = saved.id;
        noteRef = saved;
      }

      const payload = { title: noteTitle || noteRef.title, content: noteContent };

      let res;
      switch (type) {
        case 'summary':
          res = await aiAPI.summary(noteId, payload);
          break;
        case 'actions':
          res = await aiAPI.actions(noteId, payload);
          break;
        case 'title':
          res = await aiAPI.title(noteId, payload);
          break;
        default:
          return;
      }

      setAiResults((prev) => ({ ...prev, [type]: res.data }));

      // Instantly propagate the new generation details to in-memory list & selection
      if (type === 'summary') {
        setNotes((prevNotes) =>
          prevNotes.map((n) =>
            n.id === noteId
              ? {
                  ...n,
                  hasSummary: true,
                  aiGenerations: [
                    ...(n.aiGenerations || []).filter(ai => ai.type !== 'summary'),
                    { type: 'summary', result: res.data }
                  ]
                }
              : n
          )
        );
        setSelectedNote((prevSelected) =>
          prevSelected && prevSelected.id === noteId
            ? {
                ...prevSelected,
                hasSummary: true,
                aiGenerations: [
                  ...(prevSelected.aiGenerations || []).filter(ai => ai.type !== 'summary'),
                  { type: 'summary', result: res.data }
                ]
              }
            : prevSelected
        );
      }
    } catch (err) {
      const message =
        err.response?.data?.error ||
        (err.response?.status === 502
          ? 'AI service unavailable. Check GEMINI_API_KEY in server/.env and restart the server.'
          : 'AI request failed. Try again.');
      setAiError(message);
    } finally {
      setGenerating(false);
    }
  };

  const handleWsChatSubmit = async (e) => {
    e.preventDefault();
    if (!wsChatInput.trim() || wsChatLoading) return;

    let noteId = selectedNote?.id;
    let noteRef = selectedNote;

    if (selectedNote?.isDraft || noteId === '__draft__') {
      const saved = await persistDraft(noteTitle, noteContent, noteTags, noteCategory);
      if (!saved?.id) {
        setAiError('Could not save note to begin chat.');
        return;
      }
      noteId = saved.id;
      noteRef = saved;
    }

    const message = wsChatInput.trim();
    setWsChatInput('');
    setWsChatMessages(prev => [...prev, { role: 'user', text: message }]);
    setWsChatLoading(true);
    setAiError('');

    try {
      const res = await aiAPI.chat({ message, mode: 'append', noteId });
      const { reply, updatedNote } = res.data;
      
      setWsChatMessages(prev => [...prev, { role: 'assistant', text: reply }]);
      
      if (updatedNote) {
        setNoteContent(updatedNote.content);
        setNoteTitle(updatedNote.title);
        setNoteTags(updatedNote.tags || []);
        setNotes(prev => prev.map(n => n.id === updatedNote.id ? updatedNote : n));
        setSelectedNote(updatedNote);
      }
    } catch (err) {
      const msg = err.response?.data?.error || 'Chat failed.';
      setWsChatMessages(prev => [...prev, { role: 'assistant', text: msg, isError: true }]);
    } finally {
      setWsChatLoading(false);
    }
  };

  const allTags = useMemo(() => {
    const tags = new Set();
    notes.forEach((n) => n.tags?.forEach((t) => tags.add(t)));
    return Array.from(tags).sort();
  }, [notes]);

  const quickPickNotes = useMemo(() => notes.slice(0, 6), [notes]);

  const isDraft = selectedNote?.isDraft || selectedNote?.id === '__draft__';

  return (
    <div className="workspace-page">
      <Navigation activeTab="workspace" />

      <div className="ws-body">
        <aside className={`ws-sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
          <div className="sidebar-header">
            <div className="sidebar-header-title">
              <h2>Notes</h2>
              <span className="sidebar-note-count">
                {listLoading ? 'Loading…' : `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`}
              </span>
            </div>
            <button
              type="button"
              className="sidebar-collapse-btn"
              onClick={() => setSidebarOpen(false)}
              title="Hide sidebar"
              aria-label="Hide sidebar"
            >
              <PanelLeftClose size={16} />
            </button>
          </div>

          <button type="button" className="btn btn-primary btn-full new-note-btn" onClick={handleCreateNote}>
            <Plus size={16} /> New Note
          </button>

          <div className="sidebar-search">
            <Search size={14} className="sidebar-search-icon" />
            <input
              id="search-input"
              type="text"
              placeholder="Search notes…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search notes"
            />
          </div>

          <div className="sidebar-filters">
            <div className="filter-row">
              <select value={filterTag} onChange={(e) => setFilterTag(e.target.value)} aria-label="Filter by tag">
                <option value="">All tags</option>
                {allTags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort notes">
                <option value="updated">Recent</option>
                <option value="title">A–Z</option>
                <option value="created">Created</option>
              </select>
            </div>
            <div className="archive-toggle-row">
              <button
                type="button"
                className={`toggle-archive-btn ${showArchived ? 'active' : ''}`}
                onClick={() => setShowArchived(!showArchived)}
              >
                <Archive size={14} />
                <span>{showArchived ? 'Showing archived' : 'Archived'}</span>
              </button>
            </div>
          </div>

          <div className="notes-list">
            {listLoading ? (
              [1, 2, 3, 4, 5].map((n) => (
                <div key={n} className="note-card skeleton-card">
                  <div className="skeleton-title" />
                  <div className="skeleton-text" />
                  <div className="skeleton-text short" />
                  <div className="skeleton-footer" />
                </div>
              ))
            ) : notes.length === 0 ? (
              <div className="empty-list">
                <p>{showArchived ? 'No archived notes' : 'No notes yet'}</p>
                {!showArchived && <p className="hint">Create your first note to get started</p>}
              </div>
            ) : (
              notes.map((note) => (
                <div
                  key={note.id}
                  role="button"
                  tabIndex={0}
                  className={`note-card ${selectedNote?.id === note.id ? 'active' : ''}`}
                  onClick={() => selectNote(note)}
                  onKeyDown={(e) => e.key === 'Enter' && selectNote(note)}
                >
                  <div className="note-card-header">
                    <div className="note-card-title-row">
                      <h3 className="note-card-title">{note.title || 'Untitled'}</h3>
                    </div>
                    <div className="note-card-actions">
                      <button
                        type="button"
                        className="btn-icon-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleArchiveNote(note.id);
                        }}
                        title={note.isArchived ? 'Unarchive' : 'Archive'}
                        style={{ opacity: 1 }}
                      >
                        <Archive size={12} />
                      </button>
                      <button
                        type="button"
                        className="btn-icon-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteNote(note.id);
                        }}
                        title="Delete"
                        style={{ opacity: 1 }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  <p className="note-card-snippet">
                    {stripMarkdown(note.content)?.substring(0, 90) || 'Empty note'}
                  </p>
                  <div className="note-card-footer">
                    <div className="note-card-footer-left">
                      <span className="note-card-date">{formatRelativeDate(note.updatedAt)}</span>
                      {note.isPublic && (
                        <span className="note-footer-badge shared" title="Publicly shared">
                          <Link2 size={10} /> Shared
                        </span>
                      )}
                      {note.hasSummary && (
                        <span className="note-footer-badge ai" title="AI summary available">
                          <Sparkles size={10} /> Summarized
                        </span>
                      )}
                    </div>
                    <div className="note-card-tags">
                      {note.tags?.slice(0, 2).map((t) => (
                        <span key={t} className={`mini-tag ${stringToColorClass(t)}`}>
                          {t}
                        </span>
                      ))}
                      {note.tags?.length > 2 && (
                        <span className="mini-tag tag-default">+{note.tags.length - 2}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        {!sidebarOpen && (
          <button
            type="button"
            className="ws-sidebar-reopen"
            onClick={() => setSidebarOpen(true)}
            title="Show sidebar"
            aria-label="Show sidebar"
          >
            <PanelLeft size={18} />
          </button>
        )}

        <main className="ws-main">
          {selectedNote ? (
            <div className="editor-container">
              <div className="editor-toolbar">
                <div className="editor-toolbar-left">
                  {!sidebarOpen && (
                    <button
                      type="button"
                      className="toolbar-btn"
                      onClick={() => setSidebarOpen(true)}
                      title="Show sidebar"
                    >
                      <PanelLeft size={14} />
                    </button>
                  )}
                  <button 
                    type="button"
                    className="toolbar-btn"
                    onClick={() => forceSave()}
                    disabled={saveStatus === 'saving' || isDraft}
                    title="Save Note (Ctrl+S)"
                  >
                    <Save size={14} /> Save
                  </button>
                  <span className={`save-status ${saveStatus === 'saved' ? 'saved' : ''}`}>
                    {saveStatus === 'saving' && (
                      <>
                        <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Saving…
                      </>
                    )}
                    {saveStatus === 'saved' && (
                      <>
                        <Check size={12} /> Saved
                      </>
                    )}
                    {saveStatus === 'error' && (
                      <span className="save-status-error" title="Could not save — check server is running">
                        Save failed
                      </span>
                    )}
                    {isDraft && saveStatus !== 'saving' && saveStatus !== 'saved' && (
                      <>Draft — start typing to save</>
                    )}
                  </span>
                </div>
                <div className="editor-toolbar-right">
                  {!isDraft && (
                    <div className="toolbar-group">
                      <button
                        type="button"
                        className={`toolbar-btn ${selectedNote?.isPublic ? 'active' : ''}`}
                        onClick={() => setIsShareModalOpen(true)}
                        title="Share Note"
                      >
                        <Link2 size={14} /> {selectedNote?.isPublic ? 'Shared' : 'Share'}
                      </button>
                    </div>
                  )}

                  {!isDraft && (
                    <div className="toolbar-group">
                      <button
                        type="button"
                        className={`toolbar-btn ${showBackups ? 'active' : ''}`}
                        onClick={showBackups ? () => setShowBackups(false) : loadBackups}
                        title="View AI Edit History"
                      >
                        <History size={14} /> Backups
                      </button>

                      <div className="export-dropdown-wrapper" ref={exportRef}>
                        <button
                          type="button"
                          className={`toolbar-btn ${exportDropdownOpen ? 'active' : ''}`}
                          onClick={() => setExportDropdownOpen(!exportDropdownOpen)}
                          title="Export Note"
                        >
                          <Download size={14} /> Export
                        </button>
                        {exportDropdownOpen && (
                          <div className="export-dropdown-menu">
                            <button type="button" onClick={() => { handleExport('md'); setExportDropdownOpen(false); }}>
                              📄 Markdown (.md)
                            </button>
                            <button type="button" onClick={() => { handleExport('pdf'); setExportDropdownOpen(false); }}>
                              📕 PDF Document (.pdf)
                            </button>
                            <button type="button" onClick={() => { handleExport('html'); setExportDropdownOpen(false); }}>
                              🌐 Rich HTML (.html)
                            </button>
                            <button type="button" onClick={() => { handleExport('txt'); setExportDropdownOpen(false); }}>
                              📝 Plain Text (.txt)
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="toolbar-group">
                    {!aiPanelOpen && (
                      <button
                        type="button"
                        className="toolbar-btn spark"
                        onClick={() => setAiPanelOpen(true)}
                        title="AI Assistant (Ctrl+J)"
                      >
                        <Sparkles size={14} /> AI
                      </button>
                    )}
                    <div className="segmented-control">
                      <button
                        type="button"
                        className={`toolbar-btn ${editorMode === 'edit' ? 'active' : ''}`}
                        onClick={() => setEditorMode('edit')}
                        title="Edit Mode"
                      >
                        <Edit2 size={12} /> Edit
                      </button>
                      <button
                        type="button"
                        className={`toolbar-btn ${editorMode === 'split' ? 'active' : ''}`}
                        onClick={() => setEditorMode('split')}
                        title="Split Screen View"
                      >
                        <Columns size={12} /> Split
                      </button>
                      <button
                        type="button"
                        className={`toolbar-btn ${editorMode === 'preview' ? 'active' : ''}`}
                        onClick={() => setEditorMode('preview')}
                        title="Full Preview Mode"
                      >
                        <Eye size={12} /> Preview
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {showBackups && (
                <div className="backups-banner">
                  <div className="backups-header">
                    <h4>AI Edit History</h4>
                    <button type="button" onClick={() => setShowBackups(false)}>×</button>
                  </div>
                  {loadingBackups ? (
                    <p>Loading backups...</p>
                  ) : backupsList.length === 0 ? (
                    <p className="no-backups">No backups available for this note. AI edits will appear here.</p>
                  ) : (
                    <div className="backups-list">
                      {backupsList.map((backup) => (
                        <div key={backup.id} className="backup-item">
                          <span>{formatRelativeDate(backup.createdAt)}</span>
                          <button 
                            type="button" 
                            className="btn btn-sm btn-outline"
                            onClick={() => handleRestoreBackup(backup.id)}
                          >
                            Restore this version
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="editor-header">
                <input
                  type="text"
                  className="editor-title-input"
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  placeholder="Untitled note"
                  aria-label="Note title"
                />
                <div className="editor-inline-tags">
                  {noteTags.map((tag) => (
                    <span key={tag} className={`tag-chip editable ${stringToColorClass(tag)}`}>
                      {tag}
                      <button type="button" onClick={() => handleRemoveTag(tag)} aria-label={`Remove tag ${tag}`}>
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    className="inline-tag-input"
                    placeholder="Add tag…"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleAddTag}
                    aria-label="Add tag"
                  />
                </div>
              </div>

              <div className="editor-body">
                <div className={`editor-content ${aiPanelOpen ? 'with-panel' : ''}`}>
                  {editorMode === 'preview' && (
                    <div
                      className={`markdown-preview font-${settings?.fontSize || 'medium'}`}
                      dangerouslySetInnerHTML={{ __html: marked.parse(noteContent || '') }}
                    />
                  )}

                  {editorMode === 'edit' && (
                    <textarea
                      className={`editor-textarea font-${settings?.fontSize || 'medium'}`}
                      style={{ whiteSpace: settings?.wordWrap ? 'pre-wrap' : 'pre' }}
                      value={noteContent}
                      onChange={(e) => setNoteContent(e.target.value)}
                      placeholder="Start writing… Markdown supported."
                      aria-label="Note content"
                    />
                  )}

                  {editorMode === 'split' && (
                    <div className="split-editor-container">
                      <textarea
                        className={`editor-textarea font-${settings?.fontSize || 'medium'}`}
                        style={{ whiteSpace: settings?.wordWrap ? 'pre-wrap' : 'pre' }}
                        value={noteContent}
                        onChange={(e) => setNoteContent(e.target.value)}
                        placeholder="Start writing… Markdown supported."
                        aria-label="Note content"
                      />
                      <div
                        className={`markdown-preview font-${settings?.fontSize || 'medium'}`}
                        dangerouslySetInnerHTML={{ __html: marked.parse(noteContent || '') }}
                      />
                    </div>
                  )}
                  <div className="editor-footer">
                    <span>{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
                    <span>Ctrl+S save · Ctrl+K search</span>
                  </div>
                </div>

                {aiPanelOpen && (
                  <div className="ai-panel">
                      <div className="ai-panel-header">
                        <h3>
                          <Sparkles size={16} className="sparkle-pulse" />
                          <span>AI Workspace Copilot</span>
                        </h3>
                        <button type="button" className="btn-icon-sm close-ai-btn" onClick={() => setAiPanelOpen(false)} aria-label="Close panel">
                          <X size={16} />
                        </button>
                      </div>

                      <div className="ai-tabs-container">
                        <div className="ai-tabs-pill">
                          <button 
                            className={`ai-tab-btn ${aiPanelTab === 'assist' ? 'active' : ''}`}
                            onClick={() => setAiPanelTab('assist')}
                          >
                            <Sparkles size={14} />
                            <span>Insights</span>
                          </button>
                          <button 
                            className={`ai-tab-btn ${aiPanelTab === 'chat' ? 'active' : ''}`}
                            onClick={() => setAiPanelTab('chat')}
                          >
                            <MessageSquare size={14} />
                            <span>Chat Copilot</span>
                          </button>
                        </div>
                      </div>

                      <div className="ai-panel-content">
                        {aiPanelTab === 'assist' && (
                          <div className="ai-assist-tab">
                            <div className="ai-actions">
                              <button
                                type="button"
                                className={`ai-action-btn primary ${generating ? 'generating' : ''}`}
                                onClick={() => generateAIContent('summary')}
                                disabled={generating || !noteContent?.trim()}
                              >
                                <Sparkles size={16} className={`btn-icon ${generating ? 'spinning' : ''}`} />
                                <span>{generating ? 'Summarizing Document...' : 'Generate Summary'}</span>
                              </button>
                              <button
                                type="button"
                                className={`ai-action-btn outline ${generating ? 'generating' : ''}`}
                                onClick={() => generateAIContent('actions')}
                                disabled={generating || !noteContent?.trim()}
                              >
                                <Check size={16} className={`btn-icon ${generating ? 'spinning' : ''}`} />
                                <span>{generating ? 'Extracting Tasks...' : 'Extract Action Items'}</span>
                              </button>
                              <button
                                type="button"
                                className={`ai-action-btn outline ${generating ? 'generating' : ''}`}
                                onClick={() => generateAIContent('title')}
                                disabled={generating || !noteContent?.trim()}
                              >
                                <PenLine size={16} className={`btn-icon ${generating ? 'spinning' : ''}`} />
                                <span>{generating ? 'Brainstorming...' : 'Suggest Title'}</span>
                              </button>
                            </div>
                            
                            {aiError && (
                              <div className="ai-error-container">
                                <p className="ai-error">{aiError}</p>
                              </div>
                            )}
                            
                            {Object.keys(aiResults).length > 0 && (
                              <div className="ai-results-card">
                                <div className="ai-results-card-header">
                                  <Sparkles size={14} className="ai-accent-color" />
                                  <span>AI Insights & Analytics</span>
                                </div>
                                <div className="ai-results-content">
                                  {aiResults.summary?.summary && (
                                    <div className="ai-result-section">
                                      <h5>Summary</h5>
                                      <p>{aiResults.summary.summary}</p>
                                    </div>
                                  )}
                                  {aiResults.actions?.action_items?.length > 0 && (
                                    <div className="ai-result-section">
                                      <h5>Action Items</h5>
                                      <ul className="ai-action-list">
                                        {aiResults.actions.action_items.map((item, i) => (
                                          <li key={i}>{item}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  {aiResults.title?.suggested_title && (
                                    <div className="title-suggestion">
                                      <div className="title-suggestion-info">
                                        <h5>Suggested Title</h5>
                                        <span>{aiResults.title.suggested_title}</span>
                                      </div>
                                      <button
                                        type="button"
                                        className="btn btn-sm btn-primary apply-title-btn"
                                        onClick={() => setNoteTitle(aiResults.title.suggested_title)}
                                      >
                                        Apply
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {aiPanelTab === 'chat' && (
                          <div className="ws-ai-chat-section">
                            <div className="ws-ai-chat-messages">
                              {wsChatMessages.length === 0 ? (
                                <div className="chat-empty-state">
                                  <div className="chat-empty-icon">
                                    <MessageSquare size={24} />
                                  </div>
                                  <h4>Interactive AI Copilot</h4>
                                  <p>Ask questions, brainstorm adjustments, or command the AI to edit your note.</p>
                                  <div className="chat-suggestions-grid">
                                    <button
                                      type="button"
                                      className="chat-suggestion-chip"
                                      onClick={() => setWsChatInput("Summarize my note and list the core takeaways.")}
                                    >
                                      ✨ Summarize Takeaways
                                    </button>
                                    <button
                                      type="button"
                                      className="chat-suggestion-chip"
                                      onClick={() => setWsChatInput("Convert this note into a clean checklist.")}
                                    >
                                      ✅ Make Checklist
                                    </button>
                                    <button
                                      type="button"
                                      className="chat-suggestion-chip"
                                      onClick={() => setWsChatInput("Fix any grammar errors and make the tone professional.")}
                                    >
                                      ✍️ Improve Grammar
                                    </button>
                                    <button
                                      type="button"
                                      className="chat-suggestion-chip"
                                      onClick={() => setWsChatInput("Brainstorm 3 creative follow-up topics based on this.")}
                                    >
                                      💡 Brainstorm Ideas
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                wsChatMessages.map((m, i) => (
                                  <div key={i} className={`ws-ai-chat-msg ${m.role} ${m.isError ? 'error' : ''}`}>
                                    <div className="ws-ai-chat-bubble" dangerouslySetInnerHTML={{ __html: marked.parse(m.text || '') }} />
                                  </div>
                                ))
                              )}
                              {wsChatLoading && (
                                <div className="ws-ai-chat-msg assistant">
                                  <div className="ws-ai-chat-bubble typing">
                                    <span className="dot"></span><span className="dot"></span><span className="dot"></span>
                                  </div>
                                </div>
                              )}
                            </div>
                            <form className="ws-ai-chat-form" onSubmit={handleWsChatSubmit}>
                              <div className="ws-ai-chat-input-wrapper">
                                <input
                                  type="text"
                                  placeholder="Ask Copilot to write, edit, or analyze..."
                                  value={wsChatInput}
                                  onChange={e => setWsChatInput(e.target.value)}
                                  disabled={wsChatLoading}
                                />
                                <button type="submit" className="ws-ai-chat-send" disabled={wsChatLoading || !wsChatInput.trim()}>
                                  <Sparkles size={14} />
                                </button>
                              </div>
                            </form>
                          </div>
                        )}
                      </div>
                    </div>
                )}
              </div>
            </div>
          ) : (
            <div className="editor-empty">
              <div className="ws-welcome">
                <div className="ws-welcome-hero">
                  <div className="ws-welcome-icon">
                    <PenLine size={32} />
                  </div>
                  <h2>
                    {notes.length > 0 ? 'Choose a note to open' : 'Your workspace is ready'}
                  </h2>
                  <p>
                    {notes.length > 0
                      ? 'Pick a note from the sidebar or below to start editing.'
                      : 'Capture ideas, organize with tags, and let AI help you write.'}
                  </p>
                  <div className="ws-welcome-actions">
                    <button type="button" className="btn btn-primary" onClick={handleCreateNote}>
                      <Plus size={16} /> New Note
                    </button>
                    {notes.length > 0 && quickPickNotes[0] && (
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => selectNote(quickPickNotes[0])}
                      >
                        Open latest
                      </button>
                    )}
                  </div>
                  <div className="ws-shortcuts-hint">
                    <span>
                      <kbd>Ctrl</kbd>+N new
                    </span>
                    <span>
                      <kbd>Ctrl</kbd>+K search
                    </span>
                    <span>
                      <kbd>Ctrl</kbd>+S save
                    </span>
                  </div>
                </div>

                {notes.length > 0 && (
                  <div className="ws-quick-pick">
                    <h3>Recent notes</h3>
                    <div className="ws-quick-pick-grid">
                      {quickPickNotes.map((note) => (
                        <button
                          key={note.id}
                          type="button"
                          className="ws-quick-card"
                          onClick={() => selectNote(note)}
                        >
                          <div className="ws-quick-card-title">{note.title || 'Untitled'}</div>
                          <div className="ws-quick-card-snippet">
                            {stripMarkdown(note.content)?.substring(0, 100) || 'Empty note'}
                          </div>
                          <div className="ws-quick-card-meta">{formatRelativeDate(note.updatedAt)}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      <ShareModal 
        isOpen={isShareModalOpen} 
        onClose={() => setIsShareModalOpen(false)} 
        note={selectedNote} 
        onToggleShare={handleToggleShare} 
      />
    </div>
  );
}
