import { useState, useEffect, useCallback, useMemo } from 'react';
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
  const [showPreview, setShowPreview] = useState(true);

  const [aiPanelOpen, setAiPanelOpen] = useState(false);
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
    setShowPreview(false);
    navigate('/notes', { replace: true });
  }, [navigate]);

  useKeyboardShortcut('s', () => forceSave(), { ctrl: true });
  useKeyboardShortcut('k', () => document.getElementById('search-input')?.focus(), { ctrl: true });
  useKeyboardShortcut('n', handleCreateNote, { ctrl: true });
  useKeyboardShortcut('p', () => setShowPreview((p) => !p), { ctrl: true });
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

  const applyNoteToEditor = useCallback((note) => {
    setSelectedNote(note);
    setNoteTitle(note.title || '');
    setNoteContent(note.content || '');
    setNoteTags(note.tags || []);
    setNoteCategory(note.category || '');
    setAiResults({});
    setAiError('');
    setAiPanelOpen(false);
    setShowPreview(note.id !== '__draft__');
  }, []);

  const selectNote = useCallback(
    async (note) => {
      await forceSave();
      if (note.id === '__draft__') {
        applyNoteToEditor(note);
        navigate('/notes', { replace: true });
      } else {
        navigate(`/notes/${note.id}`, { replace: true });
      }
    },
    [applyNoteToEditor, navigate, forceSave]
  );

  useEffect(() => {
    if (!routeId) return;

    const noteInList = notes.find((n) => n.id === routeId);
    if (noteInList && noteInList.content !== undefined) {
      if (selectedNote?.id !== routeId) {
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
                      {note.hasSummary && (
                        <span className="ai-spark-badge" title="AI summary available">
                          <Sparkles size={12} />
                        </span>
                      )}
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
                    <span className="note-card-date">{formatRelativeDate(note.updatedAt)}</span>
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
                  {note.isPublic && (
                    <span className="shared-badge">
                      <Link2 size={10} /> Shared
                    </span>
                  )}
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
                    <button
                      type="button"
                      className={`toolbar-btn ${selectedNote?.isPublic ? 'active' : ''}`}
                      onClick={() => setIsShareModalOpen(true)}
                      title="Share Note"
                    >
                      <Link2 size={14} /> {selectedNote?.isPublic ? 'Shared' : 'Share'}
                    </button>
                  )}
                  {!isDraft && (
                    <button
                      type="button"
                      className={`toolbar-btn ${showBackups ? 'active' : ''}`}
                      onClick={showBackups ? () => setShowBackups(false) : loadBackups}
                      title="View AI Edit History"
                    >
                      <History size={14} /> Backups
                    </button>
                  )}
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
                  <div className="editor-toolbar-divider" />
                  <button
                    type="button"
                    className={`toolbar-btn ${showPreview ? 'active' : ''}`}
                    onClick={() => setShowPreview(!showPreview)}
                    title="Preview (Ctrl+P)"
                  >
                    {showPreview ? <Edit2 size={14} /> : <Eye size={14} />}
                    {showPreview ? 'Edit' : 'Preview'}
                  </button>
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
                  {showPreview ? (
                    <div
                      className={`markdown-preview font-${settings?.fontSize || 'medium'}`}
                      dangerouslySetInnerHTML={{ __html: marked.parse(noteContent || '') }}
                    />
                  ) : (
                    <textarea
                      className={`editor-textarea font-${settings?.fontSize || 'medium'}`}
                      style={{ whiteSpace: settings?.wordWrap ? 'pre-wrap' : 'pre' }}
                      value={noteContent}
                      onChange={(e) => setNoteContent(e.target.value)}
                      placeholder="Start writing… Markdown supported."
                      aria-label="Note content"
                    />
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
                        <Sparkles size={16} /> AI Assistant
                      </h3>
                      <button type="button" className="btn-icon-sm" onClick={() => setAiPanelOpen(false)} style={{ opacity: 1 }}>
                        ×
                      </button>
                    </div>
                    <div className="ai-panel-content">
                      <div className="ai-actions">
                        <button
                          type="button"
                          className="btn btn-primary btn-full"
                          onClick={() => generateAIContent('summary')}
                          disabled={generating || !noteContent?.trim()}
                        >
                          {generating ? 'Generating…' : 'Generate Summary'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline btn-full"
                          onClick={() => generateAIContent('actions')}
                          disabled={generating || !noteContent?.trim()}
                        >
                          Extract Action Items
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline btn-full"
                          onClick={() => generateAIContent('title')}
                          disabled={generating || !noteContent?.trim()}
                        >
                          Suggest Title
                        </button>
                      </div>
                      {aiError && <p className="ai-error">{aiError}</p>}
                      <div className="ai-results">
                        {aiResults.summary?.summary && <p>{aiResults.summary.summary}</p>}
                        {aiResults.actions?.action_items?.length > 0 && (
                          <ul className="ai-action-list">
                            {aiResults.actions.action_items.map((item, i) => (
                              <li key={i}>{item}</li>
                            ))}
                          </ul>
                        )}
                        {aiResults.title?.suggested_title && (
                          <div className="title-suggestion">
                            <span>{aiResults.title.suggested_title}</span>
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              onClick={() => setNoteTitle(aiResults.title.suggested_title)}
                            >
                              Apply
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="ws-ai-chat-section">
                        <h4>Chat with this Note</h4>
                        <div className="ws-ai-chat-messages">
                          {wsChatMessages.map((m, i) => (
                            <div key={i} className={`ws-ai-chat-msg ${m.role} ${m.isError ? 'error' : ''}`}>
                              <div className="ws-ai-chat-avatar">
                                {m.role === 'assistant' ? <Sparkles size={12} /> : null}
                              </div>
                              <div className="ws-ai-chat-bubble" dangerouslySetInnerHTML={{ __html: marked.parse(m.text || '') }} />
                            </div>
                          ))}
                          {wsChatLoading && (
                            <div className="ws-ai-chat-msg assistant">
                              <div className="ws-ai-chat-avatar"><Sparkles size={12} /></div>
                              <div className="ws-ai-chat-bubble">Thinking...</div>
                            </div>
                          )}
                        </div>
                        <form className="ws-ai-chat-form" onSubmit={handleWsChatSubmit}>
                          <input
                            type="text"
                            placeholder="Tell AI to update this note..."
                            value={wsChatInput}
                            onChange={e => setWsChatInput(e.target.value)}
                            disabled={wsChatLoading}
                          />
                          <button type="submit" disabled={wsChatLoading || !wsChatInput.trim()}>
                            <Sparkles size={14} />
                          </button>
                        </form>
                      </div>

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
