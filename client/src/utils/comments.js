import api from '../api/client';

/*
 * Comments and suggestions on a note. The owner uses their sign-in; a person on an editing share link uses the link
 * and their viewer session. Both talk to the same table on the server.
 */

/** Who is commenting: the owner of an open note, or a person on a share link. null = comments are not available. */
export function commentTarget({ noteId, collab }) {
  if (collab?.share) return { kind: 'guest', share: collab.share, sid: collab.sid, name: collab.name };
  if (noteId && noteId !== '__draft__') return { kind: 'owner', noteId };
  return null;
}

const base = (t) => (t.kind === 'owner' ? `/collab/comments/${t.noteId}` : `/public/collab/${t.share}/comments`);
const qs = (t) => (t.kind === 'guest' ? { params: { sid: t.sid, name: t.name } } : undefined);
const who = (t) => (t.kind === 'guest' ? { sid: t.sid, name: t.name } : {});

export const commentsApi = {
  list: (t) => api.get(base(t), qs(t)).then((r) => r.data.comments || []),
  add: (t, payload) => api.post(base(t), { ...payload, ...who(t) }).then((r) => r.data),
  status: (t, id, status) => api.patch(`${base(t)}/${id}`, { status, ...who(t) }),
  remove: (t, id) => api.delete(`${base(t)}/${id}`, qs(t)),
};

/** Where a quoted piece of text sits in the editor's document: { from, to }, or null if the words are not there any more. */
export function findQuote(doc, quote) {
  const needle = String(quote || '').split('\n')[0].trim().slice(0, 300);
  if (!needle) return null;
  let hit = null;
  doc.descendants((node, pos) => {
    if (hit) return false;
    if (!node.isTextblock) return true;
    const at = node.textContent.indexOf(needle);
    if (at < 0) return false;
    let off = 0;
    let from = null;
    let to = null;
    node.forEach((child, childOffset) => {
      if (!child.isText) return;
      const start = off;
      const end = off + child.text.length;
      if (from === null && at >= start && at < end) from = pos + 1 + childOffset + (at - start);
      const stop = at + needle.length;
      if (to === null && stop > start && stop <= end) to = pos + 1 + childOffset + (stop - start);
      off = end;
    });
    if (from !== null && to !== null) hit = { from, to };
    return false;
  });
  return hit;
}

export const ago = (iso) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
