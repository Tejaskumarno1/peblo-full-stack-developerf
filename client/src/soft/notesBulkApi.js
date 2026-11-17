import api from '../api/client';

/*
 * Notes actions that change many notes in one request (server/src/routes/notesBulk.ts). Each runs in one transaction on the
 * server, in the current space (the x-peblo-space header the api client adds), so a failure cannot leave notes half changed.
 */
export const notesBulkAPI = {
  /** Every note of yours in this space that is in folder `from` moves to `to`. Answers { count }. */
  renameFolder: (from, to) => api.post('/notes/folders/rename', { from, to }),
  /** Every note of yours in this space that is in folder `name` leaves it. Answers { count }. */
  clearFolder: (name) => api.post('/notes/folders/clear', { name }),
  /** { retentionDays (null: kept until deleted), purges } for the Trash of this space. */
  trashInfo: () => api.get('/notes/trash/info'),
  /** Deletes the Trash of this space for good. Answers { count }. */
  emptyTrash: () => api.post('/notes/trash/empty'),
  /** Puts every note of the Trash back. Answers { count }. */
  restoreTrash: () => api.post('/notes/trash/restore'),
};
