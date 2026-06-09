/**
 * EditorToolbar — Extracted from WorkspacePage.
 * Desktop-only toolbar with save status, AI toggle, focus mode, preview, and more menu.
 */
import { memo } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  PanelLeft,
  Loader2,
  Check,
  Sparkles,
  Monitor,
  Edit2,
  Eye,
  MoreHorizontal,
  FileText,
  Link2,
  History,
  FileDown,
  FileBadge,
  Globe,
  File,
} from 'lucide-react';

function EditorToolbar({
  saveStatus,
  isDraft,
  wordCount,
  showPreview,
  setShowPreview,
  moreMenuOpen,
  setMoreMenuOpen,
  selectedNote,
  loadBackups,
  handleExport,
}) {
  const {
    sidebarOpen, setSidebarOpen,
    aiPanelOpen, setAiPanelOpen,
    showTodoList, setShowTodoList,
    isFocusMode, setFocusMode,
    setIsShareModalOpen,
    showBackups, setShowBackups
  } = useWorkspaceStore();

  return (
    <div className="editor-toolbar desktop-only">
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
        <div className="toolbar-group toolbar-primary-actions">
          <div className="toolbar-stat-badge" style={{ padding: '0.25rem 0.5rem', background: 'var(--bg-elevated)', borderRadius: '6px', fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.375rem', border: '1px solid var(--border-subtle)' }}>
            <FileText size={12} /> {wordCount} words • {Math.max(1, Math.ceil(wordCount / 200))} min read
          </div>
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
          {!isDraft && (
            <button
              type="button"
              className={`toolbar-btn ${showTodoList ? 'active' : ''}`}
              onClick={() => setShowTodoList(!showTodoList)}
              title="View To-Do List"
            >
              <Check size={14} /> Tasks
            </button>
          )}
        </div>

        <div className="toolbar-group">
          <button
            type="button"
            className={`toolbar-btn ${isFocusMode ? 'active' : ''}`}
            onClick={() => { setFocusMode(!isFocusMode); if(!isFocusMode) setSidebarOpen(false); }}
            title="Toggle Focus Mode"
          >
            <Monitor size={14} /> Focus
          </button>
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

        {!isDraft && (
          <div className="more-menu-wrapper" style={{ position: 'relative' }}>
            <button
              type="button"
              className={`toolbar-btn ${moreMenuOpen ? 'active' : ''}`}
              onClick={() => setMoreMenuOpen(!moreMenuOpen)}
              title="More actions"
            >
              <MoreHorizontal size={14} />
            </button>
            {moreMenuOpen && (
              <div className="export-dropdown-menu">
                <button type="button" onClick={() => { setIsShareModalOpen(true); setMoreMenuOpen(false); }}>
                  <Link2 size={14} /> {selectedNote?.isPublic ? 'Sharing Settings' : 'Share Note'}
                </button>
                <button type="button" onClick={() => { showBackups ? setShowBackups(false) : loadBackups(); setMoreMenuOpen(false); }}>
                  <History size={14} /> Backups
                </button>
                <div style={{ height: '1px', background: 'var(--dash-border, var(--border-subtle))', margin: '0.25rem 0' }} />
                <button type="button" onClick={() => { handleExport('md'); setMoreMenuOpen(false); }}>
                  <FileDown size={14} /> Export as Markdown
                </button>
                <button type="button" onClick={() => { handleExport('pdf'); setMoreMenuOpen(false); }}>
                  <FileText size={14} /> Export as PDF
                </button>
                <button type="button" onClick={() => { handleExport('doc'); setMoreMenuOpen(false); }}>
                  <FileBadge size={14} /> Export as Word
                </button>
                <button type="button" onClick={() => { handleExport('html'); setMoreMenuOpen(false); }}>
                  <Globe size={14} /> Export as HTML
                </button>
                <button type="button" onClick={() => { handleExport('txt'); setMoreMenuOpen(false); }}>
                  <File size={14} /> Export as Plain Text
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(EditorToolbar);
