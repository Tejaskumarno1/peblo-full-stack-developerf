/**
 * BackupsPanel — Extracted from WorkspacePage.
 * Shows backup history and diff viewer for AI edits.
 */
import { memo } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import DiffViewer from '../DiffViewer';
import { formatRelativeDate } from '../../utils/helpers';

function BackupsPanel({
  loadingBackups,
  backupsList,
  selectedBackupForDiff,
  setSelectedBackupForDiff,
  noteContent,
  handleRestoreBackup,
}) {
  const { showBackups, setShowBackups } = useWorkspaceStore();

  if (!showBackups) return null;

  return (
    <div className="backups-banner">
      <div className="backups-header">
        <h4>{selectedBackupForDiff ? 'Compare with this version' : 'Earlier versions'}</h4>
        <button type="button" aria-label="Close earlier versions" onClick={() => { setShowBackups(false); setSelectedBackupForDiff(null); }}>×</button>
      </div>
      {loadingBackups ? (
        <p className="no-backups">Loading…</p>
      ) : selectedBackupForDiff ? (
        <DiffViewer
          oldText={selectedBackupForDiff.content}
          newText={noteContent}
          onBack={() => setSelectedBackupForDiff(null)}
          onRestore={() => {
            handleRestoreBackup(selectedBackupForDiff.id);
            setSelectedBackupForDiff(null);
          }}
        />
      ) : backupsList.length === 0 ? (
        <p className="no-backups">No earlier versions yet. Peblo saves a copy each time AI changes this note, so you can undo it here.</p>
      ) : (
        <div className="backups-list">
          {backupsList.map((backup) => (
            <div key={backup.id} className="backup-item">
              <span>{formatRelativeDate(backup.createdAt)}</span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => setSelectedBackupForDiff(backup)}
                >
                  Compare
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => handleRestoreBackup(backup.id)}
                >
                  Restore
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(BackupsPanel);
