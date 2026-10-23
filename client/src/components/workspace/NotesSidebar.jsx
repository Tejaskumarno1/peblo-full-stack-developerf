/**
 * NotesSidebar: the notes list column (search, filters, grouped list).
 */
import { memo, useMemo } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { Search, PanelLeftClose, Plus, Archive, Trash2, RotateCcw, FileText, Sparkles } from 'lucide-react';
import { stripMarkdown } from '../../utils/helpers';

const DAY = 86400000;

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function groupLabel(date) {
  const today = startOfDay(Date.now());
  const t = startOfDay(date);
  if (t >= today) return 'Today';
  if (t >= today - DAY) return 'Yesterday';
  if (t >= today - 6 * DAY) return 'This week';
  if (t >= today - 30 * DAY) return 'This month';
  return 'Earlier';
}

function shortTime(date) {
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min`;
  if (startOfDay(d) === startOfDay(Date.now())) return `${Math.floor(diff / 3600000)} h`;
  if (diff < 6 * DAY) return d.toLocaleDateString('en-IN', { weekday: 'short' });
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

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
    showDeleted, setShowDeleted,
  } = useWorkspaceStore();

  const view = showDeleted ? 'trash' : showArchived ? 'archive' : filterTag === 'inbox' ? 'inbox' : 'all';
  const setView = (v) => {
    setShowArchived(v === 'archive');
    setShowDeleted(v === 'trash');
    if (v === 'inbox') setFilterTag('inbox');
    else if (filterTag === 'inbox') setFilterTag('');
  };

  const groups = useMemo(() => {
    if (sortBy !== 'updated') return [{ label: null, notes: filteredNotes }];
    const out = [];
    for (const n of filteredNotes) {
      const label = groupLabel(n.updatedAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.notes.push(n);
      else out.push({ label, notes: [n] });
    }
    return out;
  }, [filteredNotes, sortBy]);

  const count = filteredNotes.length;

  return (
    <aside className={`ws-sidebar nl ${sidebarOpen ? '' : 'closed'}`} aria-label="Notes list">
      <div className="nl-head">
        <h2>Notes</h2>
        <span className="nl-count">{listLoading ? '…' : count}</span>
        <span className="grow" />
        <button type="button" className="pb-icon-btn" onClick={handleCreateNote} title="New note (Ctrl+Alt+N)" aria-label="New note">
          <Plus size={16} />
        </button>
        <button
          type="button"
          className={`pb-icon-btn ${!selectedNote ? 'mobile-hidden' : ''}`}
          onClick={() => { if (selectedNote) setSidebarOpen(false); }}
          title="Hide list"
          aria-label="Hide notes list"
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      <div className="nl-search">
        <Search size={14} aria-hidden="true" />
        <input
          id="search-input"
          type="text"
          placeholder="Search notes"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search notes"
        />
      </div>

      <div className="nl-chips" role="tablist" aria-label="Which notes">
        {[
          ['all', 'All'],
          ['inbox', 'Inbox'],
          ['archive', 'Archive'],
          ['trash', 'Trash'],
        ].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} className={`pb-chip${view === id ? ' on' : ''}`} onClick={() => setView(id)}>
            {label}
          </button>
        ))}
      </div>

      <div className="nl-filters">
        <select value={filterTag} onChange={(e) => setFilterTag(e.target.value)} aria-label="Filter by tag">
          <option value="">All tags</option>
          {allTags.map((t) => <option key={t} value={t}>#{t}</option>)}
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort notes">
          <option value="updated">Recently edited</option>
          <option value="created">Recently created</option>
          <option value="title">A to Z</option>
        </select>
      </div>

      <div className="nl-list notes-list">
        {listLoading ? (
          [1, 2, 3, 4, 5].map((n) => (
            <div key={n} className="nl-row nl-skel"><span /><span /><span /></div>
          ))
        ) : count === 0 ? (
          <div className="nl-empty">
            <FileText size={22} />
            <strong>{showDeleted ? 'Trash is empty' : showArchived ? 'Nothing archived' : searchQuery ? 'No notes match' : 'No notes yet'}</strong>
            <span>{searchQuery ? 'Try other words.' : showDeleted || showArchived ? '' : 'Press + to write your first note.'}</span>
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.label || 'all'} className="nl-group">
              {g.label && <div className="nl-group-label">{g.label}</div>}
              {g.notes.map((note) => {
                const snippet = stripMarkdown(note.content || '').slice(0, 120);
                const active = selectedNote?.id === note.id;
                return (
                  <div
                    key={note.id}
                    role="button"
                    tabIndex={0}
                    aria-current={active ? 'true' : undefined}
                    className={`nl-row${active ? ' active' : ''}`}
                    onClick={() => selectNote(note)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectNote(note); } }}
                  >
                    <div className="nl-row-top">
                      <span className="nl-title">{note.title || 'Untitled'}</span>
                      <span className="nl-actions">
                        {showDeleted ? (
                          <>
                            <button type="button" className="pb-icon-btn xs" title="Restore" aria-label="Restore note" onClick={(e) => { e.stopPropagation(); handleRestoreNote(note.id); }}><RotateCcw size={12} /></button>
                            <button type="button" className="pb-icon-btn xs danger" title="Delete forever" aria-label="Delete note forever" onClick={(e) => { e.stopPropagation(); handleDeleteNote(note.id); }}><Trash2 size={12} /></button>
                          </>
                        ) : (
                          <>
                            <button type="button" className="pb-icon-btn xs" title={note.isArchived ? 'Unarchive' : 'Archive'} aria-label={note.isArchived ? 'Unarchive note' : 'Archive note'} onClick={(e) => { e.stopPropagation(); handleArchiveNote(note.id); }}><Archive size={12} /></button>
                            <button type="button" className="pb-icon-btn xs" title="Move to Trash" aria-label="Move note to Trash" onClick={(e) => { e.stopPropagation(); handleDeleteNote(note.id); }}><Trash2 size={12} /></button>
                          </>
                        )}
                      </span>
                    </div>
                    <p className="nl-snippet">{snippet || 'Empty note'}</p>
                    <div className="nl-meta">
                      {note.tags?.length > 0 && <span className="nl-tag">#{note.tags[0]}{note.tags.length > 1 ? ` +${note.tags.length - 1}` : ''}</span>}
                      {note.tags?.length > 0 && <span aria-hidden="true">·</span>}
                      <span>{shortTime(note.updatedAt)}</span>
                      {note.hasSummary && <Sparkles size={11} className="nl-ai" aria-label="Has AI summary" />}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

export default memo(NotesSidebar);
