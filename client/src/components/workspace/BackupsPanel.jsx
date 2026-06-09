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
        <h4>{selectedBackupForDiff ? 'Compare AI Edit History' : 'AI Edit History'}</h4>
        <button type="button" onClick={() => { setShowBackups(false); setSelectedBackupForDiff(null); }}>×</button>
      </div>
      {loadingBackups ? (
        <p>Loading backups...</p>
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
        <p className="no-backups">No backups available for this note. AI edits will appear here.</p>
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
                  Compare Diff
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => handleRestoreBackup(backup.id)}
                >
                  Restore this version
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
