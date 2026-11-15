import { Eye } from 'lucide-react';

/** What the editor knows about a Team note (audit R26, R27, R33). The fields come from server/src/utils/teamNoteInfo.ts. */
export const noteManageable = (doc, spaceRole) => {
  if (!doc) return true;
  if (spaceRole === 'viewer') return false;
  if (!doc.access || doc.access === 'owner') return true;
  return doc.canManage === true; // a team lead may manage a colleague's note; a plain writer or a viewer may not
};

/** Beside the title of a Team note: who wrote it and who saved it last, plus a "View only" chip when the author shared it to read only. */
export function TeamNoteByline({ doc, me }) {
  if (!doc?.team || !doc.owner) return null;
  const mine = doc.owner.id === me;
  const last = doc.lastEditedBy && doc.lastEditedBy !== doc.owner.name ? doc.lastEditedBy : null;
  return (
    <span className="oa-chip" data-testid="team-byline" style={{ cursor: 'default' }} title="Who wrote this note and who saved it last">
      {doc.access === 'view' && !mine && <><Eye size={13} /> View only. </>}
      {mine ? 'By you' : `By ${doc.owner.name}`}{last ? ` · last edited by ${last}` : ''}
    </span>
  );
}
