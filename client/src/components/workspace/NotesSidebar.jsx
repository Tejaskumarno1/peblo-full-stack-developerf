/**
 * NotesSidebar — Extracted from WorkspacePage for code-splitting.
 * Contains the notes list, search, filters, and archive/trash toggles.
 */
import { memo } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  Search,
  PanelLeftClose,
  Plus,
  Archive,
  Trash2,
  Link2,
  Sparkles,
  FileText,
  RotateCcw,
} from 'lucide-react';
import { stripMarkdown, formatRelativeDate, stringToColorClass } from '../../utils/helpers';

function NotesSidebar({
  selectedNote,
  filteredNotes,
  listLoading,
  allTags,
  handleCreateNote,
  selectNote,
  handleArchiveNote,
  handleDeleteNote,
  handleRestoreNote,
}) {
  const {
    sidebarOpen, setSidebarOpen,
    searchQuery, setSearchQuery,
    filterTag, setFilterTag,
    sortBy, setSortBy,
    showArchived, setShowArchived,
    showDeleted, setShowDeleted
  } = useWorkspaceStore();

  return (
    <aside className={`ws-sidebar ${sidebarOpen ? '' : 'closed'}`}>
      <div className="sidebar-header">
        <div className="sidebar-header-title">
          <h2>Notes</h2>
          <span className="sidebar-note-count">
            {listLoading ? 'Loading…' : `${filteredNotes.length} ${filteredNotes.length === 1 ? 'note' : 'notes'}`}
          </span>
        </div>
        <button
          type="button"
          className={`sidebar-collapse-btn ${!selectedNote ? 'mobile-hidden' : ''}`}
          onClick={() => { if (selectedNote) setSidebarOpen(false) }}
          title="Hide sidebar"
          aria-label="Hide sidebar"
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      <button type="button" className="btn btn-primary new-note-btn" onClick={handleCreateNote}>
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
        <div className="archive-toggle-row" style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <button
            type="button"
            className={`toggle-archive-btn ${showArchived ? 'active' : ''}`}
            onClick={() => {
              setShowArchived(!showArchived);
              setShowDeleted(false);
            }}
            style={{ flex: 1 }}
          >
            <Archive size={14} />
            <span>{showArchived ? 'Archived' : 'Archive'}</span>
          </button>
          <button
            type="button"
            className={`toggle-archive-btn ${showDeleted ? 'active' : ''}`}
            onClick={() => {
              setShowDeleted(!showDeleted);
              setShowArchived(false);
            }}
            style={{ flex: 1, color: showDeleted ? '#ef4444' : 'inherit', borderColor: showDeleted ? '#ef4444' : 'inherit' }}
          >
            <Trash2 size={14} />
            <span>{showDeleted ? 'Trash' : 'Trash'}</span>
          </button>
        </div>
      </div>

      <div className="notes-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto', flex: 1, padding: '0.25rem 0.5rem' }}>
        {listLoading ? (
          [1, 2, 3, 4, 5].map((n) => (
            <div key={n} className="note-card skeleton-card">
              <div className="skeleton-title" />
              <div className="skeleton-text" />
              <div className="skeleton-text short" />
              <div className="skeleton-footer" />
            </div>
          ))
        ) : filteredNotes.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><FileText size={32} /></div>
            <h4>No notes found</h4>
            <p>Create a new note to get started or try a different search query.</p>
          </div>
        ) : (
          filteredNotes.map((note) => (
            <div
              key={note.id}
              className={`note-card ${selectedNote?.id === note.id ? 'active' : ''}`}
              onClick={() => selectNote(note)}
            >
              <div className="note-card-header">
                <div className="note-card-title-row">
                  <h3 className="note-card-title">{note.title || 'Untitled'}</h3>
                </div>
                {showDeleted ? (
                  <div className="note-card-actions">
                    <button
                      type="button"
                      className="btn-icon-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRestoreNote(note.id);
                      }}
                      title="Restore note"
                      style={{ opacity: 1 }}
                    >
                      <RotateCcw size={12} />
                    </button>
                    <button
                      type="button"
                      className="btn-icon-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteNote(note.id);
                      }}
                      title="Delete permanently"
                      style={{ opacity: 1, color: '#ef4444' }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ) : (
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
                )}
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
  );
}

export default memo(NotesSidebar);
