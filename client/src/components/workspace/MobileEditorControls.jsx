/**
 * MobileEditorControls — Extracted from WorkspacePage.
 * Mobile-only header and bottom action bar for the note editor.
 */
import { memo, useState } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  PanelLeft,
  Edit2,
  Eye,
  MoreHorizontal,
  Save,
  Link2,
  History,
  FileDown,
  FileText,
  FileBadge,
  Globe,
  File,
} from 'lucide-react';

function MobileEditorControls({
  noteTitle,
  showPreview,
  setShowPreview,
  forceSave,
  saveStatus,
  isDraft,
  selectedNote,
  loadBackups,
  setExportDropdownOpen,
  handleExport,
}) {
  const {
    setSidebarOpen,
    setIsShareModalOpen,
    showBackups, setShowBackups
  } = useWorkspaceStore();
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);

  const toggleMoreActions = () => {
    setMoreActionsOpen((open) => {
      if (open) setExportDropdownOpen(false);
      return !open;
    });
  };

  return (
    <>
      {/* Mobile Editor Header */}
      <div className="mobile-editor-header mobile-only">
        <button
          type="button"
          className="mobile-back-btn"
          onClick={() => setSidebarOpen(true)}
          title="Back to notes"
        >
          <PanelLeft size={20} />
        </button>
        <div className="mobile-editor-title-wrap">
          {noteTitle || 'Untitled'}
        </div>
        <button
          type="button"
          className={`mobile-icon-btn ${showPreview ? 'active' : ''}`}
          onClick={() => setShowPreview(!showPreview)}
          title={showPreview ? 'Edit' : 'Preview'}
        >
          {showPreview ? <Edit2 size={18} /> : <Eye size={18} />}
        </button>
      </div>

      {/* Mobile Bottom Actions */}
      <div className="mobile-bottom-actions mobile-only">
        <button
          type="button"
          className="mobile-action-btn"
          onClick={() => forceSave()}
          disabled={saveStatus === 'saving'}
        >
          <Save size={20} />
          <span>{saveStatus === 'saving' ? 'Saving' : 'Save'}</span>
        </button>

        <div className="mobile-more-actions-wrapper" style={{ position: 'relative' }}>
          <button
            type="button"
            className={`mobile-action-btn ${moreActionsOpen ? 'active' : ''}`}
            onClick={toggleMoreActions}
            aria-label="More note actions"
            aria-expanded={moreActionsOpen}
            title="More actions"
          >
            <MoreHorizontal size={20} />
            <span>More</span>
          </button>
          {moreActionsOpen && (
            <div className="export-dropdown-menu mobile-more-actions-menu" style={{ bottom: '100%', top: 'auto', right: '0', marginBottom: '10px' }}>
              {!isDraft && (
                <button type="button" onClick={() => { setIsShareModalOpen(true); setMoreActionsOpen(false); }}>
                  <Link2 size={14} /> {selectedNote?.isPublic ? 'Sharing Settings' : 'Share Note'}
                </button>
              )}
              {!isDraft && (
                <button type="button" onClick={() => { showBackups ? setShowBackups(false) : loadBackups(); setMoreActionsOpen(false); }}>
                  <History size={14} /> Backups
                </button>
              )}
              <div style={{ height: '1px', background: 'var(--dash-border, var(--border-subtle))', margin: '0.25rem 0' }} />
              <button type="button" onClick={() => { handleExport('md'); setMoreActionsOpen(false); }}>
                <FileDown size={14} /> Markdown (.md)
              </button>
              <button type="button" onClick={() => { handleExport('pdf'); setMoreActionsOpen(false); }}>
                <FileText size={14} /> PDF Document (.pdf)
              </button>
              <button type="button" onClick={() => { handleExport('doc'); setMoreActionsOpen(false); }}>
                <FileBadge size={14} /> Word Document (.doc)
              </button>
              <button type="button" onClick={() => { handleExport('html'); setMoreActionsOpen(false); }}>
                <Globe size={14} /> Rich HTML (.html)
              </button>
              <button type="button" onClick={() => { handleExport('txt'); setMoreActionsOpen(false); }}>
                <File size={14} /> Plain Text (.txt)
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default memo(MobileEditorControls);
