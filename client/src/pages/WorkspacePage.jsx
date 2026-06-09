import { useState, useEffect, useCallback, useMemo, useRef, Component } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { notesAPI, aiAPI } from '../api/index';
import { useDebounce, useAutoSave, useKeyboardShortcut } from '../hooks/index';
import { stripMarkdown, formatRelativeDate, stringToColorClass } from '../utils/helpers';
import { useAuth } from '../context/AuthContext';
import Navigation from '../components/Navigation';
import ShareModal from '../components/ShareModal';
import TodoListPanel from '../components/TodoListPanel';
import { marked } from 'marked';
import {
  Link2,
  PanelLeft,
} from 'lucide-react';
import BlockEditor from '../components/BlockEditor';
import '../styles/workspace.css';

// Import subcomponents for cleaner SPA loading/rendering
import {
  NotesSidebar,
  EditorToolbar,
  AiWorkspacePanel,
  BackupsPanel,
  MobileEditorControls,
  WelcomeScreen,
} from '../components/workspace';
import { useWorkspaceStore } from '../store/workspaceStore';

class EditorErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("Editor crashed:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-fallback" style={{ padding: '2rem', textAlign: 'center', background: 'var(--bg-elevated)', margin: '2rem', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
          <h3 style={{ color: '#ef4444', marginBottom: '1rem' }}>Failed to load note editor</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>An error occurred while rendering this note's content.</p>
          <button type="button" className="btn btn-primary" onClick={() => this.setState({ hasError: false })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function countWords(text) {
  const trimmed = text?.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

function getYouTubeEmbedUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./, '');
    let videoId = '';

    if (host === 'youtu.be') {
      videoId = url.pathname.split('/').filter(Boolean)[0] || '';
    } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      if (url.pathname === '/watch') {
        videoId = url.searchParams.get('v') || '';
      } else if (url.pathname.startsWith('/shorts/') || url.pathname.startsWith('/embed/')) {
        videoId = url.pathname.split('/').filter(Boolean)[1] || '';
      }
    }

    return videoId ? `https://www.youtube.com/embed/${videoId}` : '';
  } catch {
    return '';
  }
}

export default function WorkspacePage() {
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const { user, settings } = useAuth();
  const queryClient = useQueryClient();

  const {
    searchQuery, setSearchQuery,
    filterTag, setFilterTag,
    sortBy, setSortBy,
    showArchived, setShowArchived,
    showDeleted, setShowDeleted,
    sidebarOpen, setSidebarOpen,
    isFocusMode, setFocusMode,
    aiPanelOpen, setAiPanelOpen,
    showTodoList, setShowTodoList,
    showBackups, setShowBackups,
    isShareModalOpen, setIsShareModalOpen,
  } = useWorkspaceStore();
  const [suggestedTag, setSuggestedTag] = useState('');
  const [linkPreviews, setLinkPreviews] = useState([]);
  const [showLinkPreviews, setShowLinkPreviews] = useState(false);

  const { data: notes = [], isLoading: listLoading } = useQuery({
    queryKey: ['notes', { sort: sortBy, archived: showArchived, deleted: showDeleted, tag: filterTag }],
    queryFn: () => {
      const params = { sort: sortBy, archived: showArchived.toString(), deleted: showDeleted.toString() };
      if (filterTag) params.tag = filterTag;
      return notesAPI.getAll(params).then(res => {
        if (!showArchived && !showDeleted && !filterTag) {
          localStorage.setItem('peblo_cached_notes', JSON.stringify(res.data.notes));
        }
        return res.data.notes;
      });
    },
    initialData: () => {
      if (!showArchived && !showDeleted && !filterTag) {
        try {
          const cached = localStorage.getItem('peblo_cached_notes');
          return cached ? JSON.parse(cached) : undefined;
        } catch {
          return undefined;
        }
      }
      return undefined;
    },
    initialDataUpdatedAt: () => 0
  });

  const [generating, setGenerating] = useState(false);

  const [selectedNote, setSelectedNote] = useState(null);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [noteTags, setNoteTags] = useState([]);
  const [noteCategory, setNoteCategory] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [showPreview, setShowPreview] = useState(true);

  const [aiPanelTab, setAiPanelTab] = useState('assist');
  const [aiResults, setAiResults] = useState({});
  const [aiError, setAiError] = useState('');
  
  const [wsChatInput, setWsChatInput] = useState('');
  const [wsChatMessages, setWsChatMessages] = useState([]);
  const [wsChatLoading, setWsChatLoading] = useState(false);
  
  const [backupsList, setBackupsList] = useState([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [selectedBackupForDiff, setSelectedBackupForDiff] = useState(null);

  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const exportRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest('.export-dropdown-wrapper') && !e.target.closest('.more-menu-wrapper')) {
        setExportDropdownOpen(false);
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, []);

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
      queryClient.setQueriesData({ queryKey: ['notes'] }, (old) => {
        if (!old) return old;
        return [newNote, ...old];
      });
      setSelectedNote(newNote);
      navigate(`/notes/${newNote.id}`, { replace: true });
      return newNote;
    } catch (err) {
      console.error('Failed to persist draft:', err);
      return null;
    }
  }, [navigate, queryClient]);

  const handleSave = useCallback(async (noteId, data) => {
    if (noteId === '__draft__') {
      if (!data.title?.trim() && !data.content?.trim()) return;
      const created = await persistDraft(data.title, data.content, data.tags, data.category);
      if (!created) throw new Error('Failed to save new note');
      return;
    }
    await notesAPI.update(noteId, data);
    
    queryClient.setQueriesData({ queryKey: ['notes'] }, (old) => {
      if (!old) return old;
      return old.map((n) => (n.id === noteId ? { ...n, ...data, updatedAt: new Date().toISOString() } : n));
    });
    setSelectedNote((prev) => (prev?.id === noteId ? { ...prev, ...data, updatedAt: new Date().toISOString() } : prev));
  }, [persistDraft, queryClient]);

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

  useEffect(() => {
    const handleNoteUpdatedEvent = (e) => {
      const updatedNote = e.detail;
      queryClient.setQueriesData({ queryKey: ['notes'] }, (old) => {
        if (!old) return old;
        return old.map((n) => (n.id === updatedNote.id ? updatedNote : n));
      });
      if (selectedNote?.id === updatedNote.id) {
        setNoteContent(updatedNote.content || '');
        setNoteTitle(updatedNote.title || '');
        setNoteTags(updatedNote.tags || []);
        setSelectedNote(updatedNote);
      }
    };
    window.addEventListener('note-updated', handleNoteUpdatedEvent);
    return () => window.removeEventListener('note-updated', handleNoteUpdatedEvent);
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
      queryClient.setQueriesData({ queryKey: ['notes'] }, (old) => {
        if (!old) return old;
        return old.map(n => n.id === res.data.note.id ? res.data.note : n);
      });
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
    } else if (format === 'doc') {
      mimeType = 'application/msword';
      fileExtension = 'doc';
      outputContent = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset='utf-8'><title>${noteTitle || 'Untitled'}</title></head>
<body>
<h1>${noteTitle || 'Untitled'}</h1>
<div>${marked.parse(noteContent || '')}</div>
</body></html>`;
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
      import('html2pdf.js')
        .then((html2pdfModule) => {
          const html2pdf = html2pdfModule.default;
          const container = document.createElement('div');
          container.innerHTML = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; padding: 40px; color: #1e293b; background: #ffffff;">
              <h1 style="border-bottom: 2px solid #6366f1; padding-bottom: 10px; color: #0f172a; margin-top: 0;">${noteTitle || 'Untitled'}</h1>
              <div>${marked.parse(noteContent || '')}</div>
            </div>
          `;
          const opt = {
            margin:       10,
            filename:     `${(noteTitle || 'Untitled').trim().replace(/[^a-zA-Z0-9-_\s]/g, '').replace(/\s+/g, '_')}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2 },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
          };
          
          html2pdf().set(opt).from(container).save();
        })
        .catch((err) => {
          console.error('Failed to load html2pdf dynamically:', err);
          alert('Could not load PDF generation library. Please try again.');
        });
      return;
    }

    try {
      const blob = new Blob([outputContent], { type: `${mimeType};charset=utf-8;` });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${(noteTitle || 'Untitled').trim().replace(/[^a-zA-Z0-9-_\s]/g, '').replace(/\s+/g, '_')}.${fileExtension}`);
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      
      setTimeout(() => {
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      }, 500);
    } catch (err) {
      console.error('Export failed:', err);
      alert('Failed to export document. Please try again.');
    }
  };

  const applyNoteToEditor = useCallback((note) => {
    setSelectedNote(note);
    setNoteTitle(note.title || '');
    setNoteContent(note.content || '');
    setNoteTags(note.tags || []);
    setNoteCategory(note.category || '');
    
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
    setShowPreview(note.id !== '__draft__');
    setSelectedBackupForDiff(null);
    setShowBackups(false);
  }, []);

  const selectNote = useCallback(
    (note) => {
      forceSave();
      if (window.innerWidth <= 768) {
        setSidebarOpen(false);
      }
      if (note.id === '__draft__') {
        applyNoteToEditor(note);
        navigate('/notes', { replace: true });
      } else {
        navigate(`/notes/${note.id}`, { replace: true });
      }
    },
    [applyNoteToEditor, navigate, forceSave, setSidebarOpen]
  );

  const lastRouteIdRef = useRef(null);
  const ignoredNoteIdsRef = useRef(new Set());

  useEffect(() => {
    if (!routeId) {
      lastRouteIdRef.current = null;
      return;
    }

    if (ignoredNoteIdsRef.current.has(routeId)) {
      return;
    }

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
        queryClient.setQueriesData({ queryKey: ['notes'] }, (old) => {
          if (!old) return old;
          if (old.some((n) => n.id === note.id)) {
            return old.map((n) => (n.id === note.id ? note : n));
          }
          return [note, ...old];
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
    const targetNote = notes.find((n) => n.id === noteId) || (selectedNote?.id === noteId ? selectedNote : null);
    const isAlreadyDeleted = targetNote?.isDeleted;

    if (isAlreadyDeleted) {
      if (!confirm('Permanently delete this note? This cannot be undone.')) return;
    } else {
      if (!confirm('Move this note to trash?')) return;
    }

    try {
      ignoredNoteIdsRef.current.add(noteId);
      await notesAPI.delete(noteId);
      queryClient.setQueriesData({ queryKey: ['notes'] }, (old) => {
        if (!old) return old;
        return old.filter((n) => n.id !== noteId);
      });
      if (selectedNote?.id === noteId) {
        setSelectedNote(null);
        navigate('/notes', { replace: true });
      }
    } catch (err) {
      console.error('Failed to delete note:', err);
    }
  };

  const handleRestoreNote = async (noteId) => {
    try {
      ignoredNoteIdsRef.current.add(noteId);
      await notesAPI.restore(noteId);
      queryClient.setQueriesData({ queryKey: ['notes'] }, (old) => {
        if (!old) return old;
        return old.filter((n) => n.id !== noteId);
      });
      if (selectedNote?.id === noteId) {
        setSelectedNote(null);
        navigate('/notes', { replace: true });
      }
    } catch (err) {
      console.error('Failed to restore note:', err);
    }
  };

  const handleArchiveNote = async (noteId) => {
    try {
      ignoredNoteIdsRef.current.add(noteId);
      await notesAPI.archive(noteId);
      queryClient.setQueriesData({ queryKey: ['notes'] }, (old) => {
        if (!old) return old;
        return old.filter((n) => n.id !== noteId);
      });
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
      
      queryClient.setQueriesData({ queryKey: ['notes'] }, (old) => {
        if (!old) return old;
        return old.map((n) => (n.id === updatedNote.id ? updatedNote : n));
      });
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

      if (type === 'summary') {
        queryClient.setQueriesData({ queryKey: ['notes'] }, (old) => {
          if (!old) return old;
          return old.map((n) =>
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
          );
        });
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
        queryClient.setQueriesData({ queryKey: ['notes'] }, (old) => {
          if (!old) return old;
          return old.map(n => n.id === updatedNote.id ? updatedNote : n);
        });
        setSelectedNote(updatedNote);
      }
    } catch (err) {
      const msg = err.response?.data?.error || 'Chat failed.';
      setWsChatMessages(prev => [...prev, { role: 'assistant', text: msg, isError: true }]);
    } finally {
      setWsChatLoading(false);
    }
  };

  const filteredNotes = useMemo(() => {
    if (!searchQuery.trim()) return notes;
    const query = searchQuery.toLowerCase();
    return notes.filter((note) => {
      const titleMatch = note.title?.toLowerCase().includes(query);
      const contentMatch = note.content?.toLowerCase().includes(query);
      return titleMatch || contentMatch;
    });
  }, [notes, searchQuery]);



  // Link Previews
  useEffect(() => {
    if (!noteContent) {
      setLinkPreviews([]);
      return;
    }

    const urlRegex = /(https?:\/\/[^\s\)]+)/gi;
    const matches = noteContent.match(urlRegex) || [];
    const uniqueUrls = Array.from(new Set(matches.map(url => url.replace(/[.,;:]$/, ''))));

    if (uniqueUrls.length === 0) {
      setLinkPreviews([]);
      return;
    }

    let isMounted = true;

    const fetchPreviews = async () => {
      const previews = await Promise.all(
        uniqueUrls.map(async (url) => {
          const embedUrl = getYouTubeEmbedUrl(url);

          try {
            const existing = linkPreviews.find(p => p.url === url);
            if (existing) return { ...existing, embedUrl: existing.embedUrl || embedUrl };

            if (embedUrl) {
              return {
                url,
                embedUrl,
                title: 'YouTube video',
                description: 'Playable embedded video',
                domain: new URL(url).hostname.replace(/^www\./, '')
              };
            }

            const res = await aiAPI.linkPreview(url);
            return res.data;
          } catch (err) {
            console.warn('Failed to fetch link preview:', err?.response?.status || err?.message);
            return {
              url,
              embedUrl,
              title: embedUrl ? 'YouTube video' : url,
              description: embedUrl ? 'Playable embedded video' : 'No description available.',
              domain: new URL(url).hostname.replace(/^www\./, '')
            };
          }
        })
      );

      if (isMounted) {
        setLinkPreviews(previews.filter(Boolean));
      }
    };

    fetchPreviews();

    return () => {
      isMounted = false;
    };
  }, [noteContent]);

  // Native-Feeling Mobile Swipe for Sidebar
  useEffect(() => {
    let touchStartX = 0;
    let touchEndX = 0;

    const handleTouchStart = (e) => {
      touchStartX = e.changedTouches[0].screenX;
    };

    const handleTouchEnd = (e) => {
      touchEndX = e.changedTouches[0].screenX;
      handleSwipe();
    };

    const handleSwipe = () => {
      const swipeDistance = touchEndX - touchStartX;
      const minSwipeDistance = 50;
      
      if (window.innerWidth > 768) return;
      
      if (swipeDistance > minSwipeDistance && touchStartX < 80) {
        setSidebarOpen(true);
      }
      
      if (swipeDistance < -minSwipeDistance) {
        setSidebarOpen(false);
      }
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, []);

  // Global Keyboard Hotkeys
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handleCreateNote();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleCreateNote]);

  const allTags = useMemo(() => {
    const tags = new Set();
    notes.forEach((n) => n.tags?.forEach((t) => tags.add(t)));
    return Array.from(tags).sort();
  }, [notes]);

  const quickPickNotes = useMemo(() => notes.slice(0, 6), [notes]);

  const isDraft = selectedNote?.isDraft || selectedNote?.id === '__draft__';

  return (
    <div className={`workspace-page ${settings?.compactMode ? 'compact-mode' : ''} ${isFocusMode ? 'focus-mode-active' : ''}`}>
      {!isFocusMode && <Navigation activeTab="notes" />}

      <div className="ws-body">
        <div className={`ws-mobile-overlay ${sidebarOpen ? 'open' : ''}`} onClick={() => { if (selectedNote) setSidebarOpen(false) }} />
        
        <NotesSidebar
          selectedNote={selectedNote}
          filteredNotes={filteredNotes}
          listLoading={listLoading}
          allTags={allTags}
          handleCreateNote={handleCreateNote}
          selectNote={selectNote}
          handleArchiveNote={handleArchiveNote}
          handleDeleteNote={handleDeleteNote}
          handleRestoreNote={handleRestoreNote}
        />

        {!sidebarOpen && (
          <button
            type="button"
            className="ws-sidebar-reopen desktop-only"
            onClick={() => setSidebarOpen(true)}
            title="Show sidebar"
            aria-label="Show sidebar"
          >
            <PanelLeft size={18} />
          </button>
        )}

        <main className="ws-main">
          {selectedNote ? (
            <>
              <div className="editor-container">
                <MobileEditorControls
                  noteTitle={noteTitle}
                  showPreview={showPreview}
                  setShowPreview={setShowPreview}
                  forceSave={forceSave}
                  saveStatus={saveStatus}
                  isDraft={isDraft}
                  selectedNote={selectedNote}
                  loadBackups={loadBackups}
                  exportDropdownOpen={exportDropdownOpen}
                  setExportDropdownOpen={setExportDropdownOpen}
                  handleExport={handleExport}
                />

                <EditorToolbar
                  saveStatus={saveStatus}
                  isDraft={isDraft}
                  wordCount={wordCount}
                  showPreview={showPreview}
                  setShowPreview={setShowPreview}
                  moreMenuOpen={moreMenuOpen}
                  setMoreMenuOpen={setMoreMenuOpen}
                  selectedNote={selectedNote}
                  loadBackups={loadBackups}
                  handleExport={handleExport}
                />

                <BackupsPanel
                  loadingBackups={loadingBackups}
                  backupsList={backupsList}
                  selectedBackupForDiff={selectedBackupForDiff}
                  setSelectedBackupForDiff={setSelectedBackupForDiff}
                  noteContent={noteContent}
                  handleRestoreBackup={handleRestoreBackup}
                />

                {selectedNote?.isDeleted && (
                  <div className="trash-banner">
                    <span>This note is in the Trash. Restore it to view or edit.</span>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => handleRestoreNote(selectedNote.id)}>
                        Restore
                      </button>
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDeleteNote(selectedNote.id)}>
                        Delete permanently
                      </button>
                    </div>
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
                    disabled={selectedNote?.isDeleted}
                  />
                  <div className="editor-inline-tags">
                    {noteTags.map((tag) => (
                      <span key={tag} className={`tag-chip editable ${stringToColorClass(tag)}`}>
                        {tag}
                        {!selectedNote?.isDeleted && (
                          <button type="button" onClick={() => handleRemoveTag(tag)} aria-label={`Remove tag ${tag}`}>
                            ×
                          </button>
                        )}
                      </span>
                    ))}
                    {!selectedNote?.isDeleted && (
                      <input
                        type="text"
                        className="inline-tag-input"
                        placeholder="Add tag…"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={handleAddTag}
                        aria-label="Add tag"
                      />
                    )}

                  </div>
                </div>

                <div className="editor-body">
                  <div className={`editor-content ${aiPanelOpen ? 'with-panel' : ''}`}>
                    <EditorErrorBoundary key={selectedNote?.id || 'new'}>
                      <BlockEditor
                        initialContent={noteContent}
                        onChange={(content) => setNoteContent(content)}
                        editable={!showPreview && !selectedNote?.isDeleted}
                      />
                    </EditorErrorBoundary>

                    {linkPreviews.length > 0 && (
                      <div className="link-previews-control">
                        <button
                          type="button"
                          className={`link-previews-toggle ${showLinkPreviews ? 'active' : ''}`}
                          onClick={() => setShowLinkPreviews((open) => !open)}
                          aria-expanded={showLinkPreviews}
                        >
                          <Link2 size={14} />
                          <span>{showLinkPreviews ? 'Hide links' : `Show links (${linkPreviews.length})`}</span>
                        </button>

                        {showLinkPreviews && (
                          <div className="link-previews-panel">
                            <div className="link-previews-grid">
                              {linkPreviews.map((preview, i) => (
                                preview.embedUrl ? (
                                  <div key={preview.url || i} className="link-preview-card youtube-preview-card">
                                    <div className="youtube-embed-frame">
                                      <iframe
                                        src={preview.embedUrl}
                                        title={preview.title || 'YouTube video'}
                                        loading="lazy"
                                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                        allowFullScreen
                                      />
                                    </div>
                                    <a href={preview.url} target="_blank" rel="noopener noreferrer" className="youtube-preview-meta">
                                      <span>{preview.domain || 'youtube.com'}</span>
                                      <strong>{preview.title || 'YouTube video'}</strong>
                                    </a>
                                  </div>
                                ) : (
                                  <a key={preview.url || i} href={preview.url} target="_blank" rel="noopener noreferrer" className="link-preview-card">
                                    {preview.image && (
                                      <div className="link-preview-image" style={{ backgroundImage: `url(${preview.image})` }} />
                                    )}
                                    <div className="link-preview-content">
                                      <h5>
                                        {preview.title}
                                      </h5>
                                      <p>
                                        {preview.description}
                                      </p>
                                      <span>
                                        {preview.domain}
                                      </span>
                                    </div>
                                  </a>
                                )
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="editor-footer">
                      <span>{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
                      <span>Ctrl+S save · Ctrl+K search</span>
                    </div>
                  </div>

                  <AiWorkspacePanel
                    aiPanelTab={aiPanelTab}
                    setAiPanelTab={setAiPanelTab}
                    aiResults={aiResults}
                    aiError={aiError}
                    generating={generating}
                    noteContent={noteContent}
                    generateAIContent={generateAIContent}
                    setNoteTitle={setNoteTitle}
                    wsChatInput={wsChatInput}
                    setWsChatInput={setWsChatInput}
                    wsChatMessages={wsChatMessages}
                    wsChatLoading={wsChatLoading}
                    handleWsChatSubmit={handleWsChatSubmit}
                  />
                </div>
              </div>

              {showTodoList && (
                <div style={{ position: 'absolute', right: 0, top: 0, height: '100%', zIndex: 100, boxShadow: '-4px 0 15px rgba(0,0,0,0.05)' }}>
                  <TodoListPanel onClose={() => setShowTodoList(false)} />
                </div>
              )}
            </>
          ) : (
            <WelcomeScreen
              handleCreateNote={handleCreateNote}
              selectNote={selectNote}
              notes={notes}
              quickPickNotes={quickPickNotes}
              setSidebarOpen={setSidebarOpen}
            />
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
