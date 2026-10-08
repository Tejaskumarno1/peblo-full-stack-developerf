/**
 * EditorToolbar: the note's top bar (breadcrumb, save state, view toggles, Ask AI, more menu).
 */
import { memo } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  PanelLeft,
  Loader2,
  Sparkles,
  Maximize2,
  Minimize2,
  Pencil,
  Eye,
  MoreHorizontal,
  FileText,
  History,
  FileDown,
  FileBadge,
  Globe,
  File,
  ListChecks,
} from 'lucide-react';

function EditorToolbar({
  saveStatus,
  isDraft,
  showPreview,
  setShowPreview,
  moreMenuOpen,
  setMoreMenuOpen,
  selectedNote,
  loadBackups,
  handleExport,
  noteTitle,
  noteTags,
}) {
  const {
    sidebarOpen, setSidebarOpen,
    aiPanelOpen, setAiPanelOpen,
    showTodoList, setShowTodoList,
    isFocusMode, setFocusMode,
    showBackups, setShowBackups,
  } = useWorkspaceStore();

  const tag = noteTags?.[0];

  let status;
  if (saveStatus === 'saving') status = <span className="nt-save"><Loader2 size={12} className="nt-spin" /> Saving…</span>;
  else if (saveStatus === 'error') status = <span className="nt-save bad" title="Could not save. Is Peblo still running?">Save failed</span>;
  else if (isDraft) status = <span className="nt-save">Draft · start typing to save</span>;
  else status = <span className="nt-save"><span className="pb-dot local" /> Saved to your account</span>;

  return (
    <div className="editor-toolbar nt-bar desktop-only">
      <div className="nt-left">
        {!sidebarOpen && (
          <button type="button" className="pb-icon-btn" onClick={() => setSidebarOpen(true)} title="Show notes list" aria-label="Show notes list">
            <PanelLeft size={16} />
          </button>
        )}
        <nav className="nt-crumbs" aria-label="Breadcrumb">
          <span>Notes</span>
          {tag && <><span className="sep">/</span><span>#{tag}</span></>}
          <span className="sep">/</span>
          <span className="cur">{noteTitle || selectedNote?.title || 'Untitled'}</span>
        </nav>
      </div>

      <div className="nt-right">
        {status}
        <span className="nt-divider" />
        {!isDraft && (
          <button type="button" className={`pb-btn ghost sm${showTodoList ? ' on' : ''}`} onClick={() => setShowTodoList(!showTodoList)} title="Show tasks">
            <ListChecks size={14} /> Tasks
          </button>
        )}
        <button
          type="button"
          className={`pb-icon-btn${isFocusMode ? ' on' : ''}`}
          onClick={() => { setFocusMode(!isFocusMode); if (!isFocusMode) setSidebarOpen(false); }}
          title={isFocusMode ? 'Leave focus mode' : 'Focus mode'}
          aria-label={isFocusMode ? 'Leave focus mode' : 'Focus mode'}
          aria-pressed={isFocusMode}
        >
          {isFocusMode ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
        <button
          type="button"
          className={`pb-icon-btn${showPreview ? ' on' : ''}`}
          onClick={() => setShowPreview(!showPreview)}
          title={showPreview ? 'Edit (Ctrl+P)' : 'Preview (Ctrl+P)'}
          aria-label={showPreview ? 'Edit note' : 'Preview note'}
        >
          {showPreview ? <Pencil size={15} /> : <Eye size={15} />}
        </button>

        {!isDraft && (
          <div className="more-menu-wrapper" style={{ position: 'relative' }}>
            <button type="button" className={`pb-icon-btn${moreMenuOpen ? ' on' : ''}`} onClick={() => setMoreMenuOpen(!moreMenuOpen)} title="More" aria-label="More actions" aria-expanded={moreMenuOpen}>
              <MoreHorizontal size={16} />
            </button>
            {moreMenuOpen && (
              <div className="export-dropdown-menu">
                <button type="button" onClick={() => { showBackups ? setShowBackups(false) : loadBackups(); setMoreMenuOpen(false); }}>
                  <History size={14} /> Version history
                </button>
                <div className="menu-sep" />
                <button type="button" onClick={() => { handleExport('md'); setMoreMenuOpen(false); }}><FileDown size={14} /> Export as Markdown</button>
                <button type="button" onClick={() => { handleExport('pdf'); setMoreMenuOpen(false); }}><FileText size={14} /> Export as PDF</button>
                <button type="button" onClick={() => { handleExport('doc'); setMoreMenuOpen(false); }}><FileBadge size={14} /> Export as Word</button>
                <button type="button" onClick={() => { handleExport('html'); setMoreMenuOpen(false); }}><Globe size={14} /> Export as HTML</button>
                <button type="button" onClick={() => { handleExport('txt'); setMoreMenuOpen(false); }}><File size={14} /> Export as plain text</button>
              </div>
            )}
          </div>
        )}

        <button type="button" className={`pb-btn soft sm${aiPanelOpen ? ' on' : ''}`} onClick={() => setAiPanelOpen(!aiPanelOpen)} title="Ask AI about this note (Ctrl+J)">
          <Sparkles size={14} /> Ask AI
        </button>
      </div>
    </div>
  );
}

export default memo(EditorToolbar);
