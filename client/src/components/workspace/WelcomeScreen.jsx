/**
 * WelcomeScreen — Extracted from WorkspacePage.
 * Shown when no note is selected — recent notes grid and quick actions.
 */
import { memo } from 'react';
import { Plus, PenLine, Menu } from 'lucide-react';
import { stripMarkdown, formatRelativeDate } from '../../utils/helpers';

function WelcomeScreen({
  handleCreateNote,
  selectNote,
  notes,
  quickPickNotes,
  setSidebarOpen,
}) {
  return (
    <div className="editor-empty">
      {/* Mobile top bar for Welcome Screen so users can open the sidebar */}
      <div className="ws-welcome-mobile-header mobile-only">
        <button 
          className="mobile-icon-btn" 
          onClick={() => setSidebarOpen && setSidebarOpen(true)}
          aria-label="Open sidebar"
        >
          <Menu size={20} />
        </button>
        <span style={{ fontWeight: 600, fontSize: '1rem' }}>Peblo</span>
        <div style={{ width: 34 }}></div> {/* Spacer for centering */}
      </div>

      <div className="ws-welcome">
        <div className="ws-welcome-hero">
          <div className="ws-welcome-icon">
            <PenLine size={24} className="ws-welcome-icon-svg" />
          </div>
          <h2>Choose a note to open</h2>
          <p>Pick a note from the sidebar or below to start editing.</p>
          <div className="ws-welcome-actions">
            <button type="button" className="btn btn-primary" onClick={handleCreateNote}>
              <Plus size={16} /> New Note
            </button>
            <button type="button" className="btn btn-outline" onClick={() => notes.length > 0 && selectNote(notes[0])}>
              Open latest
            </button>
          </div>
          <div className="ws-shortcuts-hint">
            <span><kbd>Ctrl</kbd> +N new</span>
            <span><kbd>Ctrl</kbd> +K search</span>
            <span><kbd>Ctrl</kbd> +S save</span>
          </div>
        </div>

        {quickPickNotes.length > 0 && (
          <div className="ws-quick-pick">
            <h3>Recent Notes</h3>
            <div className="ws-quick-pick-grid">
              {quickPickNotes.map((note) => (
                <div
                  key={note.id}
                  className="ws-quick-card"
                  onClick={() => selectNote(note)}
                >
                  <div className="ws-quick-card-title">{note.title || 'Untitled'}</div>
                  <div className="ws-quick-card-snippet">
                    {stripMarkdown(note.content)?.substring(0, 80) || 'Empty note'}
                  </div>
                  <div className="ws-quick-card-meta">
                    {formatRelativeDate(note.updatedAt)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(WelcomeScreen);
