import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notesAPI, todosAPI } from '../api';
import { useAutoSave } from './index';
import { saveNoteSafe, setNoteBase, getNoteBase, isNoteLive } from '../utils/noteSync';

const editable = (title) => (!title || title === 'Untitled' ? '' : title);

/** The starting text of a meeting note: when it is, then the usual sections. */
const meetingTemplate = (when) => (when ? '**When:** ' + when + '\n\n' : '') + '## Agenda\n\n- \n\n## Notes\n\n- \n\n## Decisions\n\n- \n\n## Action items\n\n- [ ] \n';
/** Text with the empty list markers and spacing removed, to tell an untouched template from a note. */
const bare = (s) => (s || '').replace(/\[ ?\]|[\s*\\-]/g, '');

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
  const docRef = useRef(null);

  const { data: allNotes = [] } = useQuery({
    queryKey: ['notes', 'sidebar'],
    queryFn: () => notesAPI.getAll({ sort: 'updated' }).then((r) => r.data.notes || []),
  });

  const open = useCallback((note) => {
    setDoc({ ...note, title: editable(note.title), content: note.content || '', tags: note.tags || [] });
    setEditorKey(`${note.id}-${Date.now()}`);
  }, []);

  // `forTask`: the draft belongs to a task (River's "Take notes"); the task is linked when the note is first saved.
  const startDraft = useCallback((tags, forTask, template) => {
    // a meeting note starts with the meeting's name as its title and a #meeting tag
    const meetingTags = template ? [...new Set([...(tags || draftTags), 'meeting'])] : null;
    setDoc({ id: '__draft__', isDraft: true, forTask: forTask || null, title: template && forTask?.text ? forTask.text : '', content: template || '', template: template || null, tags: meetingTags || tags || draftTags, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    setEditorKey(`draft-${Date.now()}`);
  }, [draftTags]);

  useEffect(() => {
    if (params.get('new') === '1') {
      const tag = params.get('tag');
      setParams({}, { replace: true });
      const forTask = params.get('forTask');
      startDraft(
        tag ? tag.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
        forTask ? { id: forTask, text: params.get('forTaskText') || '' } : undefined,
        params.get('tpl') === 'meeting' ? meetingTemplate(params.get('when')) : undefined,
      );
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
    // A draft that is still only the template is not worth saving yet
    const untouched = doc.template && bare(doc.content) === bare(doc.template) && (!doc.title.trim() || doc.title === doc.forTask?.text);
    if (doc.isDraft && (untouched || (!doc.title.trim() && !doc.content.trim()))) return null;
    return { title: doc.title, content: doc.content, tags: doc.tags };
  }, [doc?.title, doc?.content, doc?.tags, doc?.isDraft, doc?.isDeleted, doc?.template]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveFn = useCallback(async (id, payload) => {
    if (id === '__draft__') {
      const forTask = docRef.current?.forTask;
      const fallback = forTask?.text ? `${forTask.text} · notes` : 'Untitled';
      const { data } = await notesAPI.create({ ...payload, title: payload.title || fallback });
      const created = data.note;
      if (forTask?.id) {
        try { await todosAPI.update(forTask.id, { noteId: created.id }); } catch { /* the note is saved either way */ }
        queryClient.invalidateQueries({ queryKey: ['todos'] });
      }
      setNoteBase(created.id, created.updatedAt, payload.content);
      setDoc((d) => (d && d.isDraft ? { ...d, id: created.id, isDraft: false, createdAt: created.createdAt, updatedAt: created.updatedAt } : d));
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      navigate(`/notes/${created.id}`, { replace: true });
      return;
    }
    const res = await saveNoteSafe(id, { ...payload, title: payload.title || 'Untitled' });
    const now = res?.updatedAt ? new Date(res.updatedAt).toISOString() : new Date().toISOString();
    setDoc((d) => (d && d.id === id ? { ...d, updatedAt: now } : d));
    queryClient.setQueriesData({ queryKey: ['notes'] }, (old) => (Array.isArray(old)
      ? old.map((n) => (n.id === id ? { ...n, ...payload, title: payload.title || 'Untitled', updatedAt: now } : n))
      : old));
  }, [navigate, queryClient]);

  const { saveStatus, forceSave } = useAutoSave(doc?.id, saveData, saveFn);
  docRef.current = doc;

  // What the editor loaded is what later saves are merged against.
  useEffect(() => {
    const d = docRef.current;
    if (d && !d.isDraft) setNoteBase(d.id, d.updatedAt, d.content);
  }, [editorKey]);
  // A save that had to be merged with someone else's edit (a shared link): show the combined text.
  useEffect(() => {
    const onMerged = (e) => {
      const m = e.detail;
      const d = docRef.current;
      if (!d || d.id !== m.id || d.content !== m.sent) return; // typed more meanwhile: the next save merges again
      setDoc((cur) => ({ ...cur, content: m.content, updatedAt: new Date(m.updatedAt).toISOString() }));
      setEditorKey(`merged-${Date.now()}`);
    };
    window.addEventListener('pb-note-merged', onMerged);
    return () => window.removeEventListener('pb-note-merged', onMerged);
  }, []);
  // Someone else saved this note (list refreshed through the socket) and this editor has nothing unsaved: load their text.
  useEffect(() => {
    const d = docRef.current;
    if (!d || d.isDraft || saveStatus === 'saving' || saveStatus === 'unsaved') return;
    if (isNoteLive(d.id)) return; // the live room already has it
    const f = allNotes.find((n) => n.id === d.id);
    const base = getNoteBase(d.id);
    if (!f || !base || typeof f.content !== 'string' || f.content === d.content || d.content !== base.content) return; // only when nothing was typed since the last load or save
    if (new Date(f.updatedAt).getTime() <= new Date(base.updatedAt).getTime()) return;
    setDoc((cur) => ({ ...cur, content: f.content, title: editable(f.title), updatedAt: f.updatedAt }));
    setEditorKey(`remote-${Date.now()}`);
  }, [allNotes]); // eslint-disable-line react-hooks/exhaustive-deps
  const patch = (p) => setDoc((d) => ({ ...d, ...p }));
  // Replace the text from outside the editor (templates, find & replace): remounts the editor with the new content
  const applyContent = (p) => { setDoc((d) => ({ ...d, ...p })); setEditorKey(`apply-${Date.now()}`); };

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
        : (doc?.isDraft && !saveData ? 'Not saved yet. It saves when you write' : 'Saved to your account');

  return {
    routeId, doc, setDoc, editorKey, allNotes, open, startDraft, patch, applyContent, forceSave,
    saveStatus, saved, archive, trash, restore, exportMd, addTag, removeTag,
    noteId: doc && !doc.isDraft ? doc.id : null,
  };
}
