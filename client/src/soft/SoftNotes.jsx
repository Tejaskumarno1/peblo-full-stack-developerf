import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import LiveDot from '../components/LiveDot';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ClipboardCopy, Copy, FileDown, FolderInput, Keyboard, MoveHorizontal, Share2, Trash2, Type, Plus, Check, Sparkles, ArrowUp, History, X, Loader2, Pin, Link2, Maximize2, Minimize2, Search, Star, SlidersHorizontal, SquareCheck, Folder, Zap, Tag as TagIcon, Image as PicIcon } from 'lucide-react';
import { marked } from 'marked';
import TaskSheet from './TaskSheet';
import ShareDialog from './ShareDialog';
import VersionDiff from './VersionDiff';
import { ViewPopover, MoveSheet, TagSheet, NewFolderSheet, SmartFolderPage, DEFAULT_VIEW, useOutside } from './NotesPanelParts';
import { colorOf, withLegacy, inFolder, smartMatch } from './folders';
import { useAuth } from '../context/AuthContext';
import './notespanel.css';
import TagManager from './TagManager';
import Gallery from './Gallery';
import { inlineMedia } from '../utils/imageData';
import TaskLinker from './TaskLinker';
import { notesAPI, todosAPI } from '../api';
import { useAutoSave } from '../hooks';
import { saveNoteSafe, setNoteBase, getNoteBase, isNoteLive } from '../utils/noteSync';
import BlockEditor from '../components/BlockEditor';
import ShareChips from '../components/ShareChips';
import { useLive } from '../utils/liveStore';
import { peerColor, peersBySection } from '../utils/peerCursors';
import { toneOf, toneVar, relTime, snippetOf, timeOf } from './softUtils';

const editable = (title) => (!title || title === 'Untitled' ? '' : title);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Soft Studio · Notes (mockup: SoftNotes). List, editor and helpers, with its own layout. */
export default function SoftNotes() {
  const { id: routeId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const store = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
  const [filter, setFilter] = useState(() => (new URLSearchParams(window.location.search).get('filter') === 'trash' ? 'trash' : 'all'));
  const [selTags, setSelTags] = useState(() => (params.get('tag') ? [params.get('tag')] : []));
  const [tagMatch, setTagMatch] = useState('any');
  const [collapsed, setCollapsed] = useState(() => { try { return JSON.parse(localStorage.getItem('peblo-notes-collapsed') || '{}') || {}; } catch { return {}; } });
  const toggleGroup = (k) => setCollapsed((c) => {
    const n = { ...c, [k]: !c[k] };
    if (!n[k]) delete n[k];
    try { localStorage.setItem('peblo-notes-collapsed', JSON.stringify(n)); } catch { /* ignore */ }
    return n;
  });
  const [focus, setFocus] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [wide, setWide] = useState(() => store('peblo-focus-width', 'wide'));
  const [doc, setDoc] = useState(null); // the open note (local copy while editing)
  const [editorKey, setEditorKey] = useState('none');
  const [preview, setPreview] = useState(false);
  const [tagDraft, setTagDraft] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const pillRef = useRef(null);
  const [pill, setPill] = useState(null); // selection toolbar {x, y, text}
  const [toast, setToast] = useState('');
  const [q, setQ] = useState(''); // the search box
  const [dq, setDq] = useState(''); // what was typed, after a short pause
  const [diffV, setDiffV] = useState(null); // the earlier version being compared
  const [typewriter, setTypewriter] = useState(() => store('peblo-typewriter', 'off'));
  const [font, setFont] = useState(() => store('peblo-note-font', 'm')); // s, m, l, xl
  const [savedQ, setSavedQ] = useState(() => { try { return JSON.parse(localStorage.getItem('peblo-saved-searches') || '[]'); } catch { return []; } });
  const keep = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
  // folders, view options and bulk actions (Notes panel)
  const { settings: acct, updateSettings } = useAuth();
  const [view, setViewState] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem('peblo-notes-view') || 'null'); if (v && typeof v === 'object') return { ...DEFAULT_VIEW, ...v }; } catch { /* ignore */ }
    const old = { sort: store('peblo-notes-sort', 'updated'), group: store('peblo-notes-group', 'date') };
    return { ...DEFAULT_VIEW, sort: ['updated', 'created', 'title'].includes(old.sort) ? old.sort : 'updated', pinFirst: old.sort === 'pinned' || true, group: ['date', 'folder', 'tag', 'none'].includes(old.group) ? old.group : 'date' };
  });
  const setView = (v) => { setViewState(v); try { localStorage.setItem('peblo-notes-view', JSON.stringify(v)); } catch { /* ignore */ } };
  const sort = view.sort;
  const group = view.group;
  const [viewOpen, setViewOpen] = useState(false);
  const [fSel, setFSel] = useState(null); // { kind: 'folder' | 'smart', id }
  const [sheet, setSheet] = useState(null); // 'move' | 'tag' | 'folder'
  const [folderEdit, setFolderEdit] = useState(null); // the folder being edited (or {} for a new one)
  const [smartPage, setSmartPage] = useState(null); // { initial, startName }
  const [moveAfter, setMoveAfter] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [picked, setPicked] = useState([]);
  const defs = Array.isArray(acct?.noteFolders) ? acct.noteFolders : [];
  const saveSearch = () => { const t = q.trim(); if (!t || savedQ.includes(t)) return; const n = [t, ...savedQ].slice(0, 8); setSavedQ(n); keep('peblo-saved-searches', JSON.stringify(n)); };
  const dropSearch = (t) => { const n = savedQ.filter((x) => x !== t); setSavedQ(n); keep('peblo-saved-searches', JSON.stringify(n)); };
  const FONTS = ['s', 'm', 'l', 'xl'];
  const FONT_NAME = { s: 'Small', m: 'Medium', l: 'Large', xl: 'Extra large' };
  const bodyRef = useRef(null);

  // ---------- data ----------
  const { data: allNotes = [] } = useQuery({
    queryKey: ['notes', 'sidebar'],
    queryFn: () => notesAPI.getAll({ sort: 'updated' }).then((r) => r.data.notes || []),
  });
  const listParams = filter === 'archive' ? { archived: 'true' } : filter === 'trash' ? { deleted: 'true' } : filter === 'all' ? {} : { tag: filter };
  const { data: listed = [] } = useQuery({
    queryKey: ['notes', 'soft', filter],
    queryFn: () => notesAPI.getAll({ sort: 'updated', ...listParams }).then((r) => r.data.notes || []),
  });
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const { data: found = [] } = useQuery({
    queryKey: ['notes', 'find', dq, filter],
    enabled: dq.length > 0,
    queryFn: () => notesAPI.getAll({ search: dq, snippet: '1', ...listParams }).then((r) => r.data.notes || []),
  });
  const noteId = doc && !doc.isDraft ? doc.id : null;
  const { data: linked = [] } = useQuery({
    queryKey: ['todos', 'note', noteId],
    queryFn: () => todosAPI.getAll({ noteId }).then((r) => r.data.todos || []),
    enabled: !!noteId,
  });
  const { data: versions = [] } = useQuery({
    queryKey: ['notes', 'backups', noteId],
    queryFn: () => notesAPI.getBackups(noteId).then((r) => r.data.backups || r.data || []),
    enabled: !!noteId,
  });

  const tagCounts = useMemo(() => {
    const m = new Map();
    for (const n of allNotes) for (const t of n.tags || []) if (t !== 'inbox' && t !== 'private') m.set(t, (m.get(t) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [allNotes]);
  const inboxCount = allNotes.filter((n) => (n.tags || []).includes('inbox')).length;
  const pinnedCount = allNotes.filter((n) => n.meta?.pinned && !n.isDeleted && !n.isArchived).length;
  const allDefs = useMemo(() => withLegacy(defs, allNotes), [defs, allNotes]);
  const normalDefs = useMemo(() => allDefs.filter((d) => !d.smart), [allDefs]);
  const smartDefs = useMemo(() => allDefs.filter((d) => d.smart), [allDefs]);
  const selDef = fSel ? allDefs.find((d) => d.id === fSel.id) : null;
  const folders = useMemo(() => normalDefs.map((d) => d.name), [normalDefs]);
  const passes = (n) => {
    if (!selDef) return true;
    return selDef.smart ? smartMatch(n, selDef.smart) : inFolder(n, selDef, allDefs, view.subs);
  };
  const folderCount = (d) => allNotes.filter((n) => (d.smart ? smartMatch(n, d.smart) : inFolder(n, d, allDefs, view.subs))).length;
  const groups = useMemo(() => {
    if (dq) return [{ key: 'found', label: '', notes: found.filter(passes) }]; // best match first, as the server ranked them
    let base = (filter === 'all' || filter === 'inbox' ? allNotes : listed).filter(passes);
    if (filter === 'inbox') base = base.filter((n) => (n.tags || []).includes('inbox'));
    if (filter !== 'archive' && filter !== 'trash' && selTags.length) {
      base = base.filter((n) => (tagMatch === 'all' ? selTags.every((t) => (n.tags || []).includes(t)) : selTags.some((t) => (n.tags || []).includes(t))));
    }
    const isPin = (n) => !!n.meta?.pinned;
    const time = (n, k) => new Date(n[k] || 0).getTime();
    const cmp = (a, b) => {
      if (view.pinFirst && group === 'none' && isPin(a) !== isPin(b)) return isPin(b) ? 1 : -1;
      if (sort === 'title') return (a.title || '').localeCompare(b.title || '');
      if (sort === 'created') return time(b, 'createdAt') - time(a, 'createdAt');
      return time(b, 'updatedAt') - time(a, 'updatedAt');
    };
    const sorted = [...base].sort(cmp);
    if (filter === 'archive' || filter === 'trash' || group === 'none') return [{ key: 'all', label: '', notes: sorted }];
    const out = [];
    const pins = view.pinFirst ? sorted.filter(isPin) : [];
    if (pins.length) out.push({ key: 'pin', label: 'Pinned', notes: pins });
    const rest = view.pinFirst ? sorted.filter((n) => !isPin(n)) : sorted;
    if (group === 'tag') {
      const m = new Map();
      for (const n of rest) { const t = (n.tags || []).find((x) => x !== 'inbox') || 'untagged'; if (!m.has(t)) m.set(t, []); m.get(t).push(n); }
      for (const [t, notes] of [...m.entries()].sort((a, b) => b[1].length - a[1].length)) out.push({ key: `t-${t}`, label: `#${t}`, notes });
    } else if (group === 'folder') {
      const m = new Map();
      for (const n of rest) { const t = n.meta?.folder || 'No folder'; if (!m.has(t)) m.set(t, []); m.get(t).push(n); }
      for (const [t, notes] of [...m.entries()].sort((a, b) => (a[0] === 'No folder') - (b[0] === 'No folder') || a[0].localeCompare(b[0]))) out.push({ key: `f-${t}`, label: t, notes });
    } else {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const week = start.getTime() - 6 * 86400000;
      const buckets = [['today', 'Today', []], ['week', 'This week', []], ['earlier', 'Earlier', []]];
      for (const n of rest) { const t = time(n, sort === 'created' ? 'createdAt' : 'updatedAt'); (t >= start.getTime() ? buckets[0] : t >= week ? buckets[1] : buckets[2])[2].push(n); }
      for (const [key, label, notes] of buckets) if (notes.length) out.push({ key, label, notes });
    }
    return out;
  }, [allNotes, listed, filter, selTags, tagMatch, view, dq, found, fSel, allDefs]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownList = useMemo(() => groups.flatMap((g) => g.notes), [groups]);
  const { data: openTasks = [] } = useQuery({
    queryKey: ['todos', 'open-unlinked'],
    queryFn: () => todosAPI.getAll({}).then((r) => (r.data.todos || []).filter((t) => !t.completed && !t.noteId)),
    enabled: !!noteId,
  });
  const [taskDraft, setTaskDraft] = useState('');
  const [sheetTask, setSheetTask] = useState(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkQ, setLinkQ] = useState('');

  // ---------- open a note ----------
  const open = useCallback((note) => {
    setDoc({ ...note, title: editable(note.title), content: note.content || '', tags: note.tags || [] });
    setEditorKey(`${note.id}-${Date.now()}`);
    setPreview(!!note.isDeleted);
    setTagDraft(null);
    setMenuOpen(false);
    setHistoryOpen(false);
    setPill(null);
  }, []);

  const startDraft = useCallback(() => {
    setDoc({ id: '__draft__', isDraft: true, title: '', content: '', tags: selTags.length ? selTags : filter === 'inbox' ? ['inbox'] : [], createdAt: new Date().toISOString() });
    setEditorKey(`draft-${Date.now()}`);
    setPreview(false);
    navigate('/notes', { replace: true });
  }, [filter, navigate]);

  useEffect(() => {
    if (params.get('new') === '1') {
      setParams({}, { replace: true });
      startDraft();
      return;
    }
    if (!routeId) {
      if (!doc && allNotes[0]) navigate(`/notes/${allNotes[0].id}`, { replace: true });
      return;
    }
    if (doc?.id === routeId) return;
    const found = allNotes.find((n) => n.id === routeId) || listed.find((n) => n.id === routeId);
    if (found) open(found);
    else notesAPI.get(routeId).then((r) => open(r.data.note)).catch(() => navigate('/notes', { replace: true }));
  }, [routeId, allNotes, listed, params]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- saving ----------
  const saveData = useMemo(() => {
    if (!doc || doc.isDeleted) return null;
    if (doc.isDraft && !doc.title.trim() && !doc.content.trim()) return null;
    return { title: doc.title, content: doc.content, tags: doc.tags };
  }, [doc?.title, doc?.content, doc?.tags, doc?.isDraft, doc?.isDeleted]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveFn = useCallback(async (id, payload) => {
    if (id === '__draft__') {
      const { data } = await notesAPI.create({ ...payload, title: payload.title || 'Untitled' });
      const created = data.note;
      // Keep the editor as it is; only the id changes.
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
  const docRef = useRef(null);
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
  // Someone else saved this note and this editor has nothing unsaved: load their text.
  useEffect(() => {
    const d = docRef.current;
    if (!d || d.isDraft || saveStatus === 'saving' || saveStatus === 'unsaved') return;
    if (isNoteLive(d.id)) return; // the live room already has it
    const f = allNotes.find((n) => n.id === d.id);
    const base = getNoteBase(d.id);
    if (!f || !base || typeof f.content !== 'string' || f.content === d.content || d.content !== base.content) return; // only when nothing was typed since the last load or save
    if (new Date(f.updatedAt).getTime() <= new Date(base.updatedAt).getTime()) return;
    setDoc((cur) => ({ ...cur, content: f.content, updatedAt: f.updatedAt }));
    setEditorKey(`remote-${Date.now()}`);
  }, [allNotes]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (p) => setDoc((d) => ({ ...d, ...p }));

  // ---------- note actions ----------
  const refreshLists = () => {
    queryClient.invalidateQueries({ queryKey: ['notes'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const archive = async () => {
    setMenuOpen(false);
    await notesAPI.archive(doc.id);
    refreshLists();
    setDoc(null);
    navigate('/notes', { replace: true });
  };
  const trash = async () => {
    setMenuOpen(false);
    if (!window.confirm(doc.isDeleted ? 'Delete this note forever? This cannot be undone.' : 'Move this note to the Trash?')) return;
    await notesAPI.delete(doc.id);
    refreshLists();
    setDoc(null);
    navigate('/notes', { replace: true });
  };
  const restore = async () => {
    await notesAPI.restore(doc.id);
    refreshLists();
    patch({ isDeleted: false });
    setPreview(false);
  };
  const exportMd = async () => {
    setMenuOpen(false);
    const blob = new Blob([`# ${doc.title || 'Untitled'}\n\n${await inlineMedia(doc.content)}`], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(doc.title || 'Untitled').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'note'}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const fileBase = () => (doc.title || 'Untitled').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'note';
  const noteHtml = async () => `<h1>${(doc.title || 'Untitled').replace(/</g, '&lt;')}</h1>${marked.parse(await inlineMedia(doc.content || ''))}`;
  const exportWord = async () => {
    setMenuOpen(false);
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${fileBase()}</title></head><body style="font-family:Calibri,Arial,sans-serif">${await noteHtml()}</body></html>`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff', html], { type: 'application/msword' }));
    a.download = `${fileBase()}.doc`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const exportPdf = async () => {
    setMenuOpen(false);
    const { default: html2pdf } = await import('html2pdf.js');
    const el = document.createElement('div');
    el.style.cssText = 'font-family:Arial,sans-serif;font-size:13px;line-height:1.5;padding:8px;color:#111;max-width:680px';
    el.innerHTML = await noteHtml();
    el.querySelectorAll('img').forEach((i) => { i.style.maxWidth = '100%'; });
    await html2pdf().set({ margin: 14, filename: `${fileBase()}.pdf`, image: { type: 'jpeg', quality: 0.92 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4' } }).from(el).save();
  };
  const togglePin = async () => {
    setMenuOpen(false);
    const next = !doc.meta?.pinned;
    if (next && pinnedCount >= 3) { flash('You can pin up to 3 notes. Unpin one first.'); return; }
    await notesAPI.update(doc.id, { meta: { pinned: next } });
    patch({ meta: { ...(doc.meta || {}), pinned: next || undefined } });
    refreshLists();
    flash(next ? 'Pinned to Home' : 'Unpinned');
  };
  const addLinkedTask = async (e) => {
    e.preventDefault();
    const text = taskDraft.trim();
    if (!text || !noteId) return;
    setTaskDraft('');
    await todosAPI.create({ text, priority: 'medium', noteId });
    queryClient.invalidateQueries({ queryKey: ['todos'] });
  };
  const linkTask = async (id) => {
    if (!id) return;
    await todosAPI.update(id, { noteId });
    queryClient.invalidateQueries({ queryKey: ['todos'] });
  };
  const unlinkTask = async (t) => {
    await todosAPI.update(t.id, { noteId: null });
    queryClient.invalidateQueries({ queryKey: ['todos'] });
  };
  const restoreVersion = async (v) => {
    await notesAPI.revertBackup(doc.id, v.id);
    const { data } = await notesAPI.get(doc.id);
    open(data.note);
    refreshLists();
    queryClient.invalidateQueries({ queryKey: ['notes', 'backups', doc.id] });
  };

  const moveTo = async (name) => {
    setSheet(null);
    const ids = selectMode && picked.length ? picked : doc ? [doc.id] : [];
    try {
      await Promise.all(ids.map((id) => notesAPI.update(id, { meta: { folder: name || '' } })));
      if (!selectMode && doc) patch({ meta: { ...(doc.meta || {}), folder: name || '' } });
      refreshLists();
      flash(name ? `Moved to ${name}` : 'Removed from folder');
    } catch { flash('Could not move'); }
    setPicked([]); setSelectMode(false);
  };
  const saveDefs = (next) => updateSettings({ noteFolders: next });
  const saveFolder = async (def) => {
    const old = defs.find((d) => d.id === def.id);
    const legacyOld = !old ? allDefs.find((d) => d.id === def.id) : null; // an older folder that had no definition yet
    const next = old || legacyOld ? [...defs.filter((d) => d.id !== def.id), { ...(old || {}), ...def }] : [...defs, def];
    const was = (old || legacyOld)?.name;
    setSheet(null); setFolderEdit(null); setSmartPage(null);
    await saveDefs(next);
    if (was && !def.smart && was !== def.name) {
      try { await Promise.all(allNotes.filter((n) => n.meta?.folder === was).map((n) => notesAPI.update(n.id, { meta: { folder: def.name } }))); refreshLists(); } catch { flash('Could not rename the folder on every note'); }
    }
    if (moveAfter && !def.smart) { setMoveAfter(false); await moveTo(def.name); return; }
    setFSel({ kind: def.smart ? 'smart' : 'folder', id: def.id });
    setFilter('all');
    flash(old ? 'Folder saved' : def.smart ? 'Smart folder created' : 'Folder created');
  };
  const deleteFolder = async (def) => {
    const count = def.smart ? 0 : allNotes.filter((n) => n.meta?.folder === def.name).length;
    if (!window.confirm(def.smart ? `Delete the smart folder "${def.name}"? Your notes are not touched.` : `Delete the folder "${def.name}"?${count ? ` Its ${count} note${count === 1 ? '' : 's'} stay, just out of the folder.` : ''}`)) return;
    setSheet(null); setFolderEdit(null); setSmartPage(null);
    await saveDefs(defs.filter((d) => d.id !== def.id).map((d) => (d.parent === def.id ? { ...d, parent: undefined } : d)));
    if (count) { try { await Promise.all(allNotes.filter((n) => n.meta?.folder === def.name).map((n) => notesAPI.update(n.id, { meta: { folder: '' } }))); refreshLists(); } catch { flash('Could not take every note out'); } }
    if (fSel?.id === def.id) setFSel(null);
  };
  const openEdit = (d) => { if (d.smart) setSmartPage({ initial: d }); else { setFolderEdit(d); setSheet('folder'); } };
  const openNew = (andMove = false) => { setMoveAfter(andMove); setFolderEdit({}); setSheet('folder'); };
  const outsideMenu = useRef(null);
  const outsideHist = useRef(null);
  useOutside(outsideMenu, menuOpen, () => setMenuOpen(false));
  useOutside(outsideHist, historyOpen, () => setHistoryOpen(false));
  const bulk = async (kind) => {
    if (!picked.length) return;
    if (kind === 'trash' && !window.confirm(`Move ${picked.length} note(s) to the Trash?`)) return;
    try {
      if (kind === 'pin') {
        const sel = allNotes.filter((n) => picked.includes(n.id));
        const unpin = sel.every((n) => n.meta?.pinned);
        const room = 3 - pinnedCount;
        const todo = unpin ? sel : sel.filter((n) => !n.meta?.pinned).slice(0, Math.max(room, 0));
        if (!unpin && todo.length < sel.filter((n) => !n.meta?.pinned).length) flash('You can pin up to 3 notes.');
        await Promise.all(todo.map((n) => notesAPI.update(n.id, { meta: { pinned: !unpin } })));
        refreshLists();
        if (!unpin && todo.length === 0) { return; }
        flash(unpin ? 'Unpinned' : 'Pinned to Home');
      } else {
        await Promise.all(picked.map((id) => (kind === 'trash' ? notesAPI.delete(id) : notesAPI.update(id, { isArchived: true }))));
        refreshLists();
        flash(kind === 'trash' ? 'Moved to the Trash' : 'Archived');
        if (picked.includes(routeId)) navigate('/notes');
      }
    } catch { flash('Something went wrong'); }
    setPicked([]); setSelectMode(false);
  };
  const tagPicked = async (tag) => {
    setSheet(null);
    try {
      await Promise.all(allNotes.filter((n) => picked.includes(n.id)).map((n) => ((n.tags || []).includes(tag) ? null : notesAPI.update(n.id, { tags: [...(n.tags || []), tag] }))));
      refreshLists();
      flash(`Tagged #${tag}`);
    } catch { flash('Could not add the tag'); }
    setPicked([]); setSelectMode(false);
  };
  const duplicate = async () => {
    setMenuOpen(false);
    forceSave();
    try {
      const { data } = await notesAPI.create({ title: `Copy of ${doc.title || 'Untitled'}`, content: doc.content || '', tags: doc.tags || [] });
      refreshLists();
      navigate(`/notes/${data.note.id}`);
      flash('Duplicated');
    } catch { flash('Could not duplicate the note'); }
  };

  const addTag = (raw) => {
    const t = raw.trim().replace(/^#/, '').toLowerCase();
    if (t && !doc.tags.includes(t)) patch({ tags: [...doc.tags, t] });
    setTagDraft(null);
  };

  const ask = (q) => {
    const text = q.trim();
    if (!text || !noteId) return;
    forceSave();
    const p = new URLSearchParams({ q: text, note: noteId, noteTitle: doc.title || 'This note' });
    navigate(`/ai?${p.toString()}`);
  };

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2200); };
  const toggleTask = async (t) => {
    queryClient.setQueryData(['todos', 'note', noteId], (old) => (old || []).map((x) => (x.id === t.id ? { ...x, completed: !x.completed } : x)));
    await todosAPI.update(t.id, { completed: !t.completed });
    queryClient.invalidateQueries({ queryKey: ['todos'] });
  };

  useEffect(() => {
    if (!focus) return undefined;
    const esc = (e) => { if (e.key === 'Escape' && !document.querySelector('.bn-suggestion-menu')) setFocus(false); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [focus]);
  const outline = useMemo(() => (doc?.content || '').split('\n').map((l) => /^(#{1,3})\s+(.+)$/.exec(l)).filter(Boolean).map((m) => ({ level: m[1].length, text: m[2].replace(/[*_`]/g, '').trim() })), [doc?.content]);
  // who else is in which section (shown as dots on the Outline card)
  const live = useLive();
  const [sec, setSec] = useState({});
  useEffect(() => {
    const peers = (live.noteId === doc?.id ? live.viewers : []).filter((v) => !v.self);
    const titles = outline.map((h) => h.text);
    const tick = () => { const next = peersBySection(peers, titles); setSec((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next)); };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [live.viewers, live.noteId, outline, doc?.id]);
  const jump = (text) => {
    const el = [...document.querySelectorAll('.s-note-body [data-content-type="heading"]')].find((h) => h.textContent.trim() === text);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const plainText = useMemo(() => (doc?.content || '').replace(/<figure>[\s\S]*?<\/figure>/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/[#*_>`|]/g, ' '), [doc?.content]);
  const words = useMemo(() => plainText.trim().split(/\s+/).filter(Boolean).length, [plainText]);
  const chars = useMemo(() => plainText.replace(/\s+/g, ' ').trim().length, [plainText]);

  // Keep the Explain / Make a task pill clear of the formatting toolbar, wherever that one opens.
  useLayoutEffect(() => {
    const el = pillRef.current;
    const box = bodyRef.current;
    if (!pill || !el || !box) return;
    const place = () => {
    const tb = document.querySelector('.bn-toolbar');
    const b = box.getBoundingClientRect();
    let top = pill.y;
    if (tb) {
      const t = tb.getBoundingClientRect();
      const h = el.offsetHeight || 44;
      const mine = { top: b.top + top - box.scrollTop, bottom: b.top + top - box.scrollTop + h };
      if (t.bottom + 6 > mine.top && t.top - 6 < mine.bottom) {
        // overlap: slip below the toolbar if there is room, otherwise above it
        const below = t.bottom + 8 - b.top + box.scrollTop;
        const above = t.top - 8 - h - b.top + box.scrollTop;
        top = (t.bottom + 8 + h < window.innerHeight) ? below : above;
      }
    }
    el.style.top = Math.max(top, 0) + 'px';
    };
    place();
    const t1 = window.setTimeout(place, 120);
    const t2 = window.setTimeout(place, 400);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [pill]);

  // ---------- selection toolbar ----------
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection();
      const box = bodyRef.current;
      if (!sel || sel.isCollapsed || !box || !sel.rangeCount || !box.contains(sel.anchorNode)) { setPill(null); return; }
      const text = sel.toString().trim();
      if (text.length < 3) { setPill(null); return; }
      const r = sel.getRangeAt(0).getBoundingClientRect();
      const b = box.getBoundingClientRect();
      setPill({ x: Math.min(Math.max(r.left + r.width / 2 - b.left, 150), b.width - 150), y: r.bottom - b.top + 10 + box.scrollTop, text: text.slice(0, 400) });
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);
  const pillAction = async (kind) => {
    const text = pill?.text;
    setPill(null);
    if (!text) return;
    if (kind === 'task') {
      if (!noteId) { flash('Type something first so the note is saved.'); return; }
      await todosAPI.create({ text: text.length > 120 ? `${text.slice(0, 117)}…` : text, priority: 'medium', noteId });
      queryClient.invalidateQueries({ queryKey: ['todos'] });
      flash('Task added and linked to this note');
    } else if (kind === 'explain') ask(`Explain this simply: "${text}"`);
    else ask(`Quiz me on this: "${text}"`);
  };

  // Notes that mention this note's title
  const mentions = useMemo(() => {
    const title = (doc?.title || '').trim().toLowerCase();
    if (title.length < 4) return [];
    return allNotes.filter((n) => n.id !== doc.id && (n.content || '').toLowerCase().includes(title)).slice(0, 4);
  }, [allNotes, doc?.id, doc?.title]);

  const crumb = doc?.isDeleted ? 'Trash' : doc?.isArchived ? 'Archive' : doc?.tags?.[0] ? cap(doc.tags[0]) : null;
  const saved = saveStatus === 'saving' ? { text: 'Saving…', icon: <Loader2 size={14} className="s-spin" /> }
    : saveStatus === 'unsaved' ? { text: 'Editing…', icon: null }
      : saveStatus === 'error' ? { text: "Couldn't save", icon: null, bad: true }
        : { text: 'Saved to your account', icon: <Check size={14} strokeWidth={2.4} /> };

  const listTitle = filter === 'archive' ? 'Archive' : filter === 'trash' ? 'Trash' : 'Notes';

  return (
    <div className={`soft-page s-notes${focus ? ' focus' : ''}`} data-width={wide}>
      {diffV && doc && <VersionDiff doc={doc} version={diffV} onClose={() => setDiffV(null)} onRestore={async (v) => { setDiffV(null); await restoreVersion(v); }} />}
      {shareOpen && doc && !doc.isDraft && <ShareDialog kind="note" id={doc.id} title={doc.title} onClose={() => setShareOpen(false)} />}
      {/* ---------- list ---------- */}
      <aside className={`s-notes-list np${view.density === 'compact' ? ' compact' : ''}${selectMode ? ' selecting' : ''}`} aria-label="Notes">
        {selectMode ? (
          <div className="np-selhead"><button type="button" onClick={() => { setSelectMode(false); setPicked([]); setSheet(null); }}>Cancel</button><b>{picked.length} selected</b><button type="button" onClick={() => setPicked(picked.length === shownList.length ? [] : shownList.map((n) => n.id))}>{picked.length && picked.length === shownList.length ? 'Clear' : 'Select all'}</button></div>
        ) : (
          <div className="np-head">
            <h1 className="s-notes-h1">{listTitle}</h1>
            <div className="np-hb">
              <button type="button" className="np-ib" aria-label="Select notes" title="Select notes" aria-pressed={selectMode} onClick={() => { setSelectMode(true); setPicked([]); }}><SquareCheck size={18} strokeWidth={1.8} /></button>
              <button type="button" className="s-new" aria-label="New note" title="New note" onClick={startDraft}><Plus size={18} strokeWidth={2.6} /></button>
            </div>
          </div>
        )}
        {!selectMode && (
          <div className="np-bar">
            <label className="s-nsearch"><Search size={18} strokeWidth={1.8} aria-hidden="true" /><input aria-label="Search notes" placeholder="Search notes" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setQ(''); }} />{q.trim() && <button type="button" className="save" aria-label="Save this search" title="Save this search" onClick={saveSearch}><Star size={13} fill={savedQ.includes(q.trim()) ? 'currentColor' : 'none'} /></button>}{q && <button type="button" aria-label="Clear search" onClick={() => setQ('')}><X size={12} /></button>}</label>
            <button type="button" className="np-view" aria-haspopup="dialog" aria-expanded={viewOpen} onClick={() => setViewOpen((v) => !v)}><SlidersHorizontal size={16} strokeWidth={1.8} />View</button>
          </div>
        )}
        {!selectMode && savedQ.length > 0 && <div className="s-saved-searches" aria-label="Saved searches">{savedQ.map((t) => <span key={t} className={t === q.trim() ? 'on' : ''}><button type="button" onClick={() => setQ(t)}>{t}</button><button type="button" className="x" aria-label={`Forget the search ${t}`} onClick={() => dropSearch(t)}>×</button></span>)}</div>}
        {filter !== 'archive' && filter !== 'trash' && (
          <div className="np-row" role="tablist" aria-label="Folders">
            <button type="button" role="tab" aria-selected={filter === 'all' && !fSel} className={`np-chip${filter === 'all' && !fSel ? ' on' : ''}`} onClick={() => { setFilter('all'); setFSel(null); }}>All <i>{allNotes.length}</i></button>
            <button type="button" role="tab" aria-selected={filter === 'inbox'} className={`np-chip${filter === 'inbox' ? ' on' : ''}`} onClick={() => { setFilter('inbox'); setFSel(null); }}><span className="np-dot" style={{ background: '#FFB48C' }} />Inbox <i>{inboxCount}</i></button>
            {normalDefs.filter((d) => !d.parent).map((d) => (
              <Fragment key={d.id}>
                <button type="button" role="tab" aria-selected={fSel?.id === d.id} className={`np-chip${fSel?.id === d.id ? ' on' : ''}`} title="Double-click to edit" onClick={() => { setFilter('all'); setFSel({ kind: 'folder', id: d.id }); }} onDoubleClick={() => openEdit(d)} onContextMenu={(e) => { e.preventDefault(); openEdit(d); }}><span className="np-dot" style={{ background: colorOf(d.color)[2] }} />{d.name} <i>{folderCount(d)}</i></button>
                {(fSel?.id === d.id || normalDefs.some((k) => k.parent === d.id && fSel?.id === k.id)) && normalDefs.filter((k) => k.parent === d.id).map((k) => (
                  <button key={k.id} type="button" role="tab" aria-selected={fSel?.id === k.id} className={`np-chip kid${fSel?.id === k.id ? ' on' : ''}`} onClick={() => { setFilter('all'); setFSel({ kind: 'folder', id: k.id }); }} onDoubleClick={() => openEdit(k)} onContextMenu={(e) => { e.preventDefault(); openEdit(k); }}><span className="np-dot" style={{ background: colorOf(k.color)[2] }} />{k.name} <i>{folderCount(k)}</i></button>
                ))}
              </Fragment>
            ))}
            {smartDefs.map((d) => (
              <button key={d.id} type="button" role="tab" aria-selected={fSel?.id === d.id} className={`np-chip sm${fSel?.id === d.id ? ' on' : ''}`} title="Double-click to edit" onClick={() => { setFilter('all'); setFSel({ kind: 'smart', id: d.id }); }} onDoubleClick={() => openEdit(d)} onContextMenu={(e) => { e.preventDefault(); openEdit(d); }}><Zap size={14} strokeWidth={1.8} />{d.name} <i>{folderCount(d)}</i></button>
            ))}
            <button type="button" className="np-chip new" aria-label="New folder" title="New folder" onClick={() => openNew(false)}><Plus size={15} strokeWidth={1.8} /></button>
          </div>
        )}
        {!selectMode && filter !== 'archive' && filter !== 'trash' && (viewOpen || sort !== 'updated' || group !== 'date' || selTags.length > 0) && (
          <div className="np-sum"><span>Sorted by {{ updated: 'edited', created: 'created', title: 'title' }[sort]}</span><span>Group: {{ date: 'Date', folder: 'Folder', tag: 'Tag', none: 'None' }[group]}</span>{selTags.map((t) => <span key={t}>#{t}<button type="button" aria-label={`Remove tag ${t}`} style={{ border: 0, background: 'transparent', padding: '0 0 0 6px', cursor: 'pointer', color: 'inherit', display: 'grid' }} onClick={() => setSelTags(selTags.filter((x) => x !== t))}><X size={12} strokeWidth={2.6} /></button></span>)}</div>
        )}
        <div className="s-notes-rows">
          {shownList.length === 0 && <p className="s-empty" style={{ padding: '8px 12px' }}>{filter === 'trash' ? 'The Trash is empty.' : filter === 'archive' ? 'Nothing archived.' : dq ? `Nothing matches “${dq}”.` : selDef ? (selDef.smart ? 'No notes match this smart folder yet.' : 'This folder is empty.') : 'No notes here yet.'}</p>}
          {groups.map((g) => (<div key={g.key} className="s-grp">{g.label && <button type="button" className="s-grp-h s-grp-toggle" aria-expanded={!collapsed[`${group}:${g.key}`]} onClick={() => toggleGroup(`${group}:${g.key}`)}>{g.label}<span className="cnt">{g.notes.length}</span></button>}{!collapsed[`${group}:${g.key}`] && g.notes.map((n) => {
            const on = doc?.id === n.id;
            const fdef = n.meta?.folder ? normalDefs.find((d) => d.name === n.meta.folder) : null;
            const w = (n.content || '').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').split(/\s+/).filter(Boolean).length;
            const sel = selectMode && picked.includes(n.id);
            return (
              <Link key={n.id} to={`/notes/${n.id}`} className={`s-note-row${on && !selectMode ? ' on' : ''}${selectMode ? ` pick${sel ? ' sel' : ''}` : ''}`} onClick={(e) => { if (selectMode) { e.preventDefault(); setPicked((p) => (p.includes(n.id) ? p.filter((x) => x !== n.id) : [...p, n.id])); } else forceSave(); }}>
                {selectMode && <span className={`np-ck${sel ? ' on' : ''}`} role="checkbox" aria-checked={sel} aria-label={`Select ${n.title || 'Untitled'}`}>{sel && <Check size={14} strokeWidth={2.6} />}</span>}
                <span className="txt">
                  <span className={`t${n.meta?.pinned ? ' pin' : ''}`}><LiveDot id={n.id} />{n.meta?.pinned && <Pin size={12} strokeWidth={2.6} aria-label="Pinned" />}{n.title && n.title !== 'Untitled' ? n.title : 'Untitled'}</span>
                  {!selectMode && view.preview && <span className="s">{dq && n.matchSnippet ? <Hl text={n.matchSnippet} q={dq} /> : snippetOf(n.content) || 'Empty note'}</span>}
                  <span className="m">{view.labels && n.meta?.folder && <span className="np-pill"><span className="np-dot" style={{ background: colorOf(fdef?.color || 'sand')[2] }} />{n.meta.folder}</span>}<span>{(n.tags || []).find((t) => t !== 'inbox') ? `#${(n.tags || []).find((t) => t !== 'inbox')} · ` : ''}{relTime(n.updatedAt)}{n.taskCount > 0 ? ` · ${n.taskCount} task${n.taskCount > 1 ? 's' : ''}` : ''}{w >= 30 ? ` · ${w} words` : ''}</span></span>
                </span>
              </Link>
            );
          })}</div>))}
        </div>
        {selectMode ? (
          <div className="np-actions" role="toolbar" aria-label="Bulk actions">
            <button type="button" className={sheet === 'move' ? 'on' : ''} disabled={!picked.length} onClick={() => setSheet(sheet === 'move' ? null : 'move')}><Folder size={18} strokeWidth={1.8} />Move</button>
            <button type="button" className={sheet === 'tag' ? 'on' : ''} disabled={!picked.length} onClick={() => setSheet(sheet === 'tag' ? null : 'tag')}><TagIcon size={18} strokeWidth={1.8} />Tag</button>
            <button type="button" disabled={!picked.length} onClick={() => bulk('pin')}><Pin size={18} strokeWidth={1.8} />Pin</button>
            <button type="button" disabled={!picked.length} onClick={() => bulk('archive')}><Archive size={18} strokeWidth={1.8} />Archive</button>
            <button type="button" disabled={!picked.length} onClick={() => bulk('trash')}><Trash2 size={18} strokeWidth={1.8} />Delete</button>
          </div>
        ) : (
          <div className="s-notes-foot">
            <button type="button" className={filter === 'archive' ? 'on' : ''} onClick={() => setFilter(filter === 'archive' ? 'all' : 'archive')}><Archive size={18} strokeWidth={1.8} />Archive</button>
            <button type="button" className={filter === 'trash' ? 'on' : ''} onClick={() => setFilter(filter === 'trash' ? 'all' : 'trash')}><Trash2 size={18} strokeWidth={1.8} />Trash</button>
            <button type="button" onClick={() => setTagsOpen(true)}><TagIcon size={18} strokeWidth={1.8} />Tags</button>
            <button type="button" onClick={() => setGalleryOpen(true)}><PicIcon size={18} strokeWidth={1.8} />Pictures</button>
            {filter === 'trash' && shownList.length > 0 && <button type="button" className="danger" onClick={async () => { if (!window.confirm(`Delete all ${shownList.length} notes in the Trash forever? This cannot be undone.`)) return; try { await Promise.all(shownList.map((n) => notesAPI.delete(n.id))); refreshLists(); flash('Trash emptied'); if (doc?.isDeleted) navigate('/notes'); } catch { flash('Could not empty the Trash'); } }}><Trash2 size={18} strokeWidth={1.8} />Empty</button>}
          </div>
        )}
        {viewOpen && <><div className="np-dim" style={{ background: 'rgba(58,42,26,.18)' }} aria-hidden="true" /><ViewPopover view={view} setView={setView} onClose={() => setViewOpen(false)} /></>}
        {sheet === 'move' && <MoveSheet folders={normalDefs} current={selectMode ? '' : doc?.meta?.folder || ''} count={selectMode ? picked.length : 1} bare={selectMode} onMove={moveTo} onNew={() => openNew(true)} onClose={() => setSheet(null)} />}
        {sheet === 'tag' && <TagSheet tags={tagCounts} count={picked.length} bare onApply={tagPicked} onClose={() => setSheet(null)} />}
        {sheet === 'folder' && folderEdit && <NewFolderSheet defs={allDefs} notes={allNotes} initial={folderEdit} onSave={saveFolder} onSmart={(nm) => { setSheet(null); setFolderEdit(null); setSmartPage({ startName: nm }); }} onDelete={() => deleteFolder(folderEdit)} onClose={() => { setSheet(null); setFolderEdit(null); setMoveAfter(false); }} />}
        {smartPage && <SmartFolderPage defs={allDefs} notes={allNotes} tags={tagCounts} folderNames={folders} initial={smartPage.initial} startName={smartPage.startName} onSave={saveFolder} onKind={(nm) => { setSmartPage(null); setFolderEdit({ name: nm || '' }); setSheet('folder'); }} onDelete={() => deleteFolder(smartPage.initial)} onClose={() => setSmartPage(null)} />}
        {galleryOpen && <Gallery notes={allNotes} onClose={() => setGalleryOpen(false)} onOpen={(id) => { setGalleryOpen(false); navigate(`/notes/${id}`); }} />}
        {tagsOpen && <TagManager onClose={() => setTagsOpen(false)} onChanged={() => refreshLists()} />}
      </aside>

      {/* ---------- editor ---------- */}
      <main className="s-note-main" aria-label="Note">
        {!doc ? (
          <div className="s-note-empty">
            <h2 className="s-h2">Write something</h2>
            <p className="s-empty">Pick a note on the left, or start a new one.</p>
            <button type="button" className="s-accent-btn" onClick={startDraft}>New note</button>
          </div>
        ) : (
          <>
            <div className="s-note-bar">
              <span className="s-crumb">Notes{crumb ? `  ›  ${crumb}` : ''}</span>
              <span className={`s-saved${saved.bad ? ' bad' : ''}`}>{saved.icon}{saved.text}</span>
              {!doc.isDraft && <ShareChips noteId={doc.id} />}
              <span className="grow" />
              {doc.isDeleted ? (
                <button type="button" className="s-outline" onClick={restore}>Restore</button>
              ) : (
                <button type="button" className="s-outline" onClick={() => setPreview((v) => !v)} aria-pressed={preview}>{preview ? 'Edit' : 'Preview'}</button>
              )}
              {focus && (
                <select className="s-outline s-focus-width" aria-label="Writing width" value={wide} onChange={(e) => { setWide(e.target.value); try { localStorage.setItem('peblo-focus-width', e.target.value); } catch { /* ignore */ } }}>
                  <option value="narrow">Width: Narrow</option><option value="wide">Width: Wide</option><option value="full">Width: Full</option>
                </select>
              )}
              <button type="button" className="s-outline" onClick={() => setFocus((v) => !v)} aria-pressed={focus} title={focus ? 'Exit full screen (Esc)' : 'Full screen'}>
                {focus ? <><Minimize2 size={14} /> Exit</> : <><Maximize2 size={14} /> Full screen</>}
              </button>
              <div className="s-menu-wrap" ref={outsideMenu}>
                <button type="button" className="s-outline round" aria-label="More" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>···</button>
                {menuOpen && !doc.isDraft && (
                  <div className="s-menu" role="menu">
                    {!doc.isDeleted && <button type="button" role="menuitem" onClick={archive}><Archive size={15} />{doc.isArchived ? 'Unarchive' : 'Archive'}</button>}
                    {!doc.isDeleted && <button type="button" role="menuitem" onClick={togglePin}><Pin size={15} />{doc.meta?.pinned ? 'Unpin from Home' : 'Pin to Home'}</button>}
                    <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); window.dispatchEvent(new Event('pb-find-open')); }}><Search size={15} />Find in note  (Ctrl+F)</button>
                    <button type="button" role="menuitem" onClick={duplicate}><Copy size={15} />Duplicate note</button>
          <button type="button" role="menuitem" onClick={async () => { setMenuOpen(false); try { await navigator.clipboard.writeText(`# ${doc.title || 'Untitled'}\n\n${await inlineMedia(doc.content || '')}`); flash('Copied as Markdown'); } catch { flash('Could not copy'); } }}><ClipboardCopy size={15} />Copy as Markdown</button>
          <button type="button" role="menuitem" onClick={async () => { setMenuOpen(false); try { await navigator.clipboard.writeText(`${window.location.origin}/notes/${doc.id}`); flash('Link copied'); } catch { flash('Could not copy'); } }}><Link2 size={15} />Copy link to note</button>
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setSelectMode(false); setSheet('move'); }}><FolderInput size={15} />{doc.meta?.folder ? `Folder: ${doc.meta.folder}…` : 'Move to folder…'}</button>
                    <button type="button" role="menuitem" onClick={() => { const n = FONTS[(FONTS.indexOf(font) + 1) % FONTS.length]; setFont(n); keep('peblo-note-font', n); }}><Type size={15} />Text size: {FONT_NAME[font]}</button>
                    <button type="button" role="menuitem" onClick={() => { const n = wide === 'narrow' ? 'wide' : 'narrow'; setWide(n); keep('peblo-focus-width', n); }}><MoveHorizontal size={15} />Page width: {wide === 'narrow' ? 'Narrow' : 'Wide'}</button>
                    <button type="button" role="menuitem" onClick={() => { const n = typewriter === 'on' ? 'off' : 'on'; setTypewriter(n); keep('peblo-typewriter', n); }}><Keyboard size={15} />Typewriter focus: {typewriter === 'on' ? 'On' : 'Off'}</button>
                    <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setShareOpen(true); }}><Share2 size={15} />Share link…</button>
                    <button type="button" role="menuitem" onClick={exportPdf}><FileDown size={15} />Export as PDF</button>
                    <button type="button" role="menuitem" onClick={exportWord}><FileDown size={15} />Export as Word</button>
                    <button type="button" role="menuitem" onClick={exportMd}><FileDown size={15} />Export as Markdown</button>
                    <button type="button" role="menuitem" className="danger" onClick={trash}><Trash2 size={15} />{doc.isDeleted ? 'Delete forever' : 'Move to Trash'}</button>
                  </div>
                )}
              </div>
            </div>

            {focus && (
              <nav className="s-focus-outline" aria-label="Outline">
                <span className="lab">Outline</span>
                {outline.length === 0 && <span className="none">Add a heading to see it here.</span>}
                {outline.map((h, i) => <button key={i} type="button" style={{ paddingLeft: 12 + (h.level - 1) * 12 }} onClick={() => jump(h.text)}>{h.text}{(sec[h.text] || []).length > 0 && <span className="s-pips" data-testid="outline-pips">{sec[h.text].map((p) => <i key={p.id} title={`${p.name} is here`} style={{ background: peerColor(p.id) }} />)}</span>}</button>)}
                <span className="lab" style={{ marginTop: 14 }}>This note</span>
                <span className="none">{words} words · {Math.max(1, Math.round(words / 200))} min read</span>
                <span className="none">{linked.length} linked task{linked.length === 1 ? '' : 's'}</span>
              </nav>
            )}
            <label htmlFor="s-note-title" className="s-sr">Title</label>
            <textarea
              id="s-note-title"
              className="s-note-title"
              rows={1}
              value={doc.title}
              placeholder="Untitled note"
              ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
              onChange={(e) => patch({ title: e.target.value.replace(/\n/g, ' ') })}
              onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
              disabled={doc.isDeleted}
            />
            <div className="s-note-meta">
            <div className="s-note-tags">
              {doc.tags.map((t) => (
                <span key={t} className="s-tag s-note-tag" style={{ background: toneVar(toneOf(t)) }}>
                  #{t}
                  {!doc.isDeleted && <button type="button" aria-label={`Remove tag ${t}`} onClick={() => patch({ tags: doc.tags.filter((x) => x !== t) })}><X size={12} strokeWidth={2.6} /></button>}
                </span>
              ))}
              {tagDraft === null ? (
                !doc.isDeleted && <button type="button" className="s-dashed s-add-tag" onClick={() => setTagDraft('')}>+ tag</button>
              ) : (
                <input
                  className="s-tag-input"
                  aria-label="New tag"
                  autoFocus
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(tagDraft); } if (e.key === 'Escape') setTagDraft(null); }}
                  onBlur={() => (tagDraft.trim() ? addTag(tagDraft) : setTagDraft(null))}
                  placeholder="tag"
                />
              )}
            </div>

            {!doc.isDraft && <div className="s-note-stats" aria-label="Length of this note">{words} word{words === 1 ? '' : 's'} · {chars} characters · {Math.max(1, Math.round(words / 200))} min read</div>}
            </div>
            <div className="s-note-body" ref={bodyRef} data-font={font}>
              <BlockEditor
          mentions={false}
                noteId={doc.id}
                key={editorKey}
                initialContent={doc.content}
                onChange={(md) => patch({ content: md })}
                editable={!preview && !doc.isDeleted}
                focusMode={typewriter === 'on'}
                formattingToolbar
              />
              {pill && !preview && (
                <div className="s-sel-pill" ref={pillRef} style={{ left: pill.x, top: Math.max(pill.y, 0) }} onMouseDown={(e) => e.preventDefault()}>
                  <button type="button" className="on" onClick={() => pillAction('explain')}>Explain</button>
                  <button type="button" onClick={() => pillAction('task')}>Make a task</button>
                  <button type="button" onClick={() => pillAction('quiz')}>Quiz me</button>
                </div>
              )}
            </div>
            {toast && <div className="s-toast" role="status">{toast}</div>}
          </>
        )}
      </main>

      {/* ---------- helpers ---------- */}
      <aside className="s-note-side" aria-label="About this note">
        <form className="s-note-ask" onSubmit={(e) => { e.preventDefault(); ask(question); setQuestion(''); }}>
          <label htmlFor="s-note-ask" className="s-ask-label" style={{ fontSize: 15 }}><Sparkles size={17} /> Ask about this note</label>
          <div className="s-ask-row small">
            <input id="s-note-ask" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={noteId ? 'What should I remember from this?' : 'Save the note to ask about it'} disabled={!noteId} autoComplete="off" />
            <button type="submit" className="s-send small" aria-label="Ask" disabled={!question.trim() || !noteId}><ArrowUp size={16} strokeWidth={2.4} /></button>
          </div>
          <div className="s-chips" style={{ gap: 6 }}>
            <button type="button" className="s-chip small" disabled={!noteId} onClick={() => ask('Summarise this note in a few short bullet points.')}>Summarise</button>
            <button type="button" className="s-chip small" disabled={!noteId} onClick={() => ask('Make 8 flashcards (question and answer) from this note.')}>Flashcards</button>
            <button type="button" className="s-chip small" disabled={!noteId} onClick={() => ask('List the tasks and to-dos hidden in this note.')}>Find tasks</button>
          </div>
        </form>

        <section className="s-side-card" style={{ background: 'var(--s-peach)' }} aria-labelledby="s-linked">
          <h3 id="s-linked" className="s-h3">Linked tasks <span className="s-cnt">{linked.length}</span></h3>
          {linked.length === 0 && <p className="s-empty small">Add a task below, link one you already have, or select text and press Make a task.</p>}
          {linked.slice(0, 8).map((t) => (
            <div key={t.id} className="s-linked-row">
              <label className={`s-side-task${t.completed ? ' done' : ''}`}>
                <input type="checkbox" className="s-check small" checked={!!t.completed} onChange={() => toggleTask(t)} />
                <button type="button" className="t s-linked-open" onClick={(e) => { e.preventDefault(); setSheetTask({ ...t, note: { id: doc.id, title: doc.title } }); }}>{t.text}</button>
                {timeOf(t) && <span className={`time${t.priority === 'high' ? ' hot' : ''}`}>{timeOf(t)}</span>}
              </label>
              <button type="button" className="s-unlink" aria-label={`Unlink ${t.text}`} title="Unlink" onClick={() => unlinkTask(t)}><X size={12} /></button>
            </div>
          ))}
          {noteId && (
            <form className="s-linked-add" onSubmit={addLinkedTask}>
              <input aria-label="Add a task to this note" value={taskDraft} onChange={(e) => setTaskDraft(e.target.value)} placeholder="Add a task…" autoComplete="off" />
              <button type="submit" aria-label="Add task" disabled={!taskDraft.trim()}><Plus size={14} strokeWidth={2.6} /></button>
            </form>
          )}
          {noteId && (
            <div className="s-link-existing">
              <button type="button" className="s-link-toggle" aria-expanded={linkOpen} onClick={() => setLinkOpen((v) => !v)}><Link2 size={13} /> Link existing</button>
              {linkOpen && (
                <TaskLinker
                  noteTitle={doc.title}
                  tasks={openTasks}
                  onLink={(id) => { linkTask(id); setLinkOpen(false); }}
                  onCreate={async (text) => { await todosAPI.create({ text, priority: 'medium', noteId }); queryClient.invalidateQueries({ queryKey: ['todos'] }); setLinkOpen(false); }}
                  onClose={() => setLinkOpen(false)}
                />
              )}
            </div>
          )}
          {sheetTask && <TaskSheet task={sheetTask} onClose={() => setSheetTask(null)} />}
        </section>

        {outline.length >= 2 && (
          <section className="s-side-card s-outline-card" style={{ background: 'var(--s-butter)' }} aria-labelledby="s-outl">
            <h3 id="s-outl" className="s-h3">Outline <span className="s-cnt">{outline.length}</span></h3>
            {outline.slice(0, 20).map((h, i) => <button key={i} type="button" className="s-side-link s-outl-item" style={{ paddingLeft: (h.level - 1) * 12 }} onClick={() => jump(h.text)}>{h.text}{(sec[h.text] || []).length > 0 && <span className="s-pips" data-testid="outline-pips">{sec[h.text].map((p) => <i key={p.id} title={`${p.name} is here`} style={{ background: peerColor(p.id) }} />)}</span>}</button>)}
          </section>
        )}

        <section className="s-side-card" style={{ background: 'var(--s-mint)' }} aria-labelledby="s-mentions">
          <h3 id="s-mentions" className="s-h3">Mentioned in</h3>
          {mentions.length === 0 && <p className="s-empty small">{(doc?.title || '').trim().length < 4 ? 'Give the note a title to see where it is mentioned.' : 'No other note mentions this one yet.'}</p>}
          {mentions.map((n) => <Link key={n.id} to={`/notes/${n.id}`} className="s-side-link">{n.title || 'Untitled'}</Link>)}
        </section>

        {noteId && (
          <div className="s-menu-wrap" ref={outsideHist}>
            <button type="button" className="s-versions" onClick={() => setHistoryOpen((v) => !v)} aria-expanded={historyOpen}>
              <History size={15} strokeWidth={2.2} /> {versions.length ? `${versions.length} version${versions.length === 1 ? '' : 's'} kept` : 'No earlier versions'}
            </button>
            {historyOpen && versions.length > 0 && (
              <div className="s-menu up" role="menu">
                {versions.slice(0, 8).map((v) => (
                  <button key={v.id} type="button" role="menuitem" onClick={() => { setHistoryOpen(false); setDiffV(v); }}>
                    Compare · {relTime(v.createdAt)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

// Shows the words that matched in bold-yellow.
function Hl({ text, q }) {
  const words = [...new Set(q.toLowerCase().replace(/#/g, ' ').split(/\s+/).filter(Boolean))].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return text;
  const parts = text.split(new RegExp(`(${words.join('|')})`, 'ig'));
  return parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p));
}