import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notesAPI } from '../api';
import { useAutoSave } from './index';

const editable = (title) => (!title || title === 'Untitled' ? '' : title);

/**
 * One open note for the River and Orbit note screens: loads it from the route,
 * starts drafts (?new=1, optionally ?tag=x), saves as you type and offers the note actions.
 * Drafts are only created on the server once they have a title or text.
 */
export default function useNoteDoc({ draftTags = [] } = {}) {
  const { id: routeId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [doc, setDoc] = useState(null);
  const [editorKey, setEditorKey] = useState('none');

  const { data: allNotes = [] } = useQuery({
    queryKey: ['notes', 'sidebar'],
    queryFn: () => notesAPI.getAll({ sort: 'updated' }).then((r) => r.data.notes || []),
  });

  const open = useCallback((note) => {
    setDoc({ ...note, title: editable(note.title), content: note.content || '', tags: note.tags || [] });
    setEditorKey(`${note.id}-${Date.now()}`);
  }, []);

  const startDraft = useCallback((tags) => {
    setDoc({ id: '__draft__', isDraft: true, title: '', content: '', tags: tags || draftTags, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    setEditorKey(`draft-${Date.now()}`);
  }, [draftTags]);

  useEffect(() => {
    if (params.get('new') === '1') {
      const tag = params.get('tag');
      setParams({}, { replace: true });
      startDraft(tag ? tag.split(',').map((t) => t.trim()).filter(Boolean) : undefined);
      return;
    }
    if (!routeId) {
      // Back on the list: close the note (a draft stays open until it is saved)
      if (doc && !doc.isDraft) setDoc(null);
      return;
    }
    if (doc?.id === routeId) return;
    const found = allNotes.find((n) => n.id === routeId);
    if (found) open(found);
    else notesAPI.get(routeId).then((r) => open(r.data.note)).catch(() => navigate('/notes', { replace: true }));
  }, [routeId, allNotes, params]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveData = useMemo(() => {
    if (!doc || doc.isDeleted) return null;
    if (doc.isDraft && !doc.title.trim() && !doc.content.trim()) return null;
    return { title: doc.title, content: doc.content, tags: doc.tags };
  }, [doc?.title, doc?.content, doc?.tags, doc?.isDraft, doc?.isDeleted]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveFn = useCallback(async (id, payload) => {
    if (id === '__draft__') {
      const { data } = await notesAPI.create({ ...payload, title: payload.title || 'Untitled' });
      const created = data.note;
      setDoc((d) => (d && d.isDraft ? { ...d, id: created.id, isDraft: false, createdAt: created.createdAt, updatedAt: created.updatedAt } : d));
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      navigate(`/notes/${created.id}`, { replace: true });
      return;
    }
    await notesAPI.update(id, { ...payload, title: payload.title || 'Untitled' });
    const now = new Date().toISOString();
    setDoc((d) => (d && d.id === id ? { ...d, updatedAt: now } : d));
    queryClient.setQueriesData({ queryKey: ['notes'] }, (old) => (Array.isArray(old)
      ? old.map((n) => (n.id === id ? { ...n, ...payload, title: payload.title || 'Untitled', updatedAt: now } : n))
      : old));
  }, [navigate, queryClient]);

  const { saveStatus, forceSave } = useAutoSave(doc?.id, saveData, saveFn);
  const patch = (p) => setDoc((d) => ({ ...d, ...p }));

  const refreshLists = () => {
    queryClient.invalidateQueries({ queryKey: ['notes'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const archive = async (after = '/notes') => {
    await notesAPI.archive(doc.id);
    refreshLists();
    setDoc(null);
    navigate(after, { replace: true });
  };
  const trash = async (after = '/notes') => {
    if (!window.confirm(doc.isDeleted ? 'Delete this note forever? This cannot be undone.' : 'Move this note to the Trash?')) return;
    await notesAPI.delete(doc.id);
    refreshLists();
    setDoc(null);
    navigate(after, { replace: true });
  };
  const restore = async () => {
    await notesAPI.restore(doc.id);
    refreshLists();
    patch({ isDeleted: false });
  };
  const exportMd = () => {
    const blob = new Blob([`# ${doc.title || 'Untitled'}\n\n${doc.content}`], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(doc.title || 'Untitled').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'note'}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const addTag = (raw) => {
    const t = raw.trim().replace(/^#/, '').toLowerCase();
    if (t && !doc.tags.includes(t)) patch({ tags: [...doc.tags, t] });
  };
  const removeTag = (t) => patch({ tags: doc.tags.filter((x) => x !== t) });

  const saved = saveStatus === 'saving' ? 'Saving…'
    : saveStatus === 'unsaved' ? 'Editing…'
      : saveStatus === 'error' ? "Couldn't save"
        : 'Saved on this computer';

  return {
    routeId, doc, setDoc, editorKey, allNotes, open, startDraft, patch, forceSave,
    saveStatus, saved, archive, trash, restore, exportMd, addTag, removeTag,
    noteId: doc && !doc.isDraft ? doc.id : null,
  };
}
