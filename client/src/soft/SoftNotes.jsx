import { Fragment, memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import LiveDot from '../components/LiveDot';
import NoteTabs from './NoteTabs';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, Archive, ClipboardCopy, Copy, FileDown, FolderInput, Keyboard, MoveHorizontal, Share2, Trash2, Plus, Check, Sparkles, History, X, Loader2, Pin, Link2, Maximize2, Minimize2, Eye, Pencil, Search, Star, SlidersHorizontal, SquareCheck, Folder, Zap, Tag as TagIcon, Image as PicIcon, MousePointer2, MoreHorizontal, ChevronDown, ChevronLeft, Lock, LockOpen, Type, RotateCcw } from 'lucide-react';
import { marked } from 'marked';
import TaskSheet from './TaskSheet';
import ShareDialog from './ShareDialog';
import { useShareAllowed, ShareBlocked } from './useShareAllowed';
import MoveNote from './MoveNote';
import ShareToTeam, { useShareTargets } from './ShareToTeam';
import TeamNoteStrip from './TeamNoteStrip';
import NoteTasks from './NoteTasks';
import { useSpaceRole, useCurrentSpace, useWorkspaces } from './spaces';
import { AccessChip, NoAccess } from './OfficeAccess';
import CompareBox from '../components/CompareBox';
import { effectiveDensity, effectiveNoteFont } from '../utils/appearance';
import { ViewPopover, MoveSheet, TagSheet, NewFolderSheet, SmartFolderPage, DEFAULT_VIEW, useOutside } from './NotesPanelParts';
import { FOLDER_COLORS, colorOf, toneVars, withLegacy, inFolder, smartMatch } from './folders';
import { FolderChip } from './FolderLook';
import { countWords, noteStats } from './noteStats';
import { groupByTag, alsoIn, uniqueNotes, rowTags, rowTitle, rowStamp } from './noteGroups';
import { useSavedSearches } from './useSavedSearches';
import { migrateView } from './viewMigrate';
import { useAuth } from '../context/AuthContext';
import './notespanel.css';
import './notesV2.css';
import { EditorSkeleton, RailSkeleton } from './Skeletons';
import TagManager from './TagManager';
import Gallery from './Gallery';
import { inlineMedia } from '../utils/imageData';
import { sanitizeHtml } from '../utils/safeHtml';
import TaskLinker from './TaskLinker';
import { notesAPI, todosAPI } from '../api';
import { usePublicUrl } from '../api/publicUrl';
import { useAutoSave } from '../hooks';
import { saveNoteSafe, saveNoteOnUnload, setNoteBase, getNoteBase, isNoteLive, rememberNoteSpace, noteSpaceCfg, setNoteFlusher, peekFinalText } from '../utils/noteSync';
import BlockEditor from '../components/BlockEditor';
import { confirmDialog } from './ConfirmDialog';
import { mentionsToText } from '../utils/mentions';
import FocusChrome, { useFocusPrefs, useFocusKeys } from '../components/FocusMode';
import ShareChips, { useShareParts } from '../components/ShareChips';
import { usePresence, appPref, setPresence, restoreAppPresence } from '../utils/presencePref';
import { useLive } from '../utils/liveStore';
import { peerColor, peersBySection } from '../utils/peerCursors';
import { toneOf, toneVar, relTime, snippetOf, timeOf } from './softUtils';
import Toast from '../components/Toast';
import NavMenu from './NavMenu';
import { TagFilterBar, BulkFailDialog, SegRow, NoteAskPanel, captureCaret, restoreCaret } from './NotesExtras';
import { notesBulkAPI } from './notesBulkApi';
import { getSpace } from '../api/space';
import { useNotesKeys } from './notesKeys';
import { bulkRun, partialText } from './bulkRun';
import { folderCounts } from './folderCounts';
import { TeamNoteByline, noteManageable } from './TeamNoteInfo';

// The space the sidebar list was last loaded for (R30: tabs are only pruned against the right space's notes). Module level, not a
// ref: the page is mounted again on a space change while the old instance's request may still finish.
const sidebarSpace = { current: undefined };
const editable = (title) => (!title || title === 'Untitled' ? '' : title);
// the first line of a note, used as its name while it has no title
const firstLine = (content) => {
  for (const raw of String(content || '').split('\n')) {
    const t = raw.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/<[^>]*>/g, '').replace(/^\s*(?:#{1,6}\s+|>\s*|[-*]\s+(?:\[[ xX]\]\s*)?)+/, '').replace(/[*_`]/g, '').trim();
    if (t) return t.length > 60 ? `${t.slice(0, 57)}…` : t;
  }
  return '';
};
const rowFirst = new WeakMap();
const firstOfNote = (n) => { let v = rowFirst.get(n); if (v === undefined) { v = firstLine(typeof n.content === 'string' ? n.content : n.snippet); rowFirst.set(n, v); } return v; };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// Per-note numbers shown in the list rows, worked out once per note object. Without this every keystroke in the open note
// re-scanned the text of every note in the list (about 11 MB for 3000 notes) and typing lagged by half a second or more.
const rowWords = new WeakMap();
const wordsOfNote = (n) => { let v = rowWords.get(n); if (v === undefined) { v = typeof n.wordCount === 'number' ? n.wordCount : countWords(n.content); rowWords.set(n, v); } return v; }; // the light list sends wordCount and no text
const rowSnippets = new WeakMap();
const snippetOfNote = (n) => { let v = rowSnippets.get(n); if (v === undefined) { v = typeof n.snippet === 'string' ? n.snippet : snippetOf(n.content); rowSnippets.set(n, v); } return v; };

// One row of the notes list. Memoised so that typing in the open note (which re-renders the whole page on every pause) does not
// rebuild thousands of rows that did not change.
const NoteRow = memo(function NoteRow({ n, on, selectMode, sel, preview, labels, dq, fdef, sortBy, hint, onPick, onLeave, onCtx, onDrag }) {
  const w = wordsOfNote(n);
  const tags = rowTags(n, 2); // N45: up to two tags
  const stamp = rowStamp(n, sortBy); // N45: the created time when the list is sorted by created
  const untitled = !n.title || n.title === 'Untitled';
  const first = untitled ? firstOfNote(n) : '';
  return (
      <Link key={n.id} to={`/notes/${n.id}`} title={rowTitle(n) || undefined} className={`s-note-row${on && !selectMode ? ' on' : ''}${selectMode ? ` pick${sel ? ' sel' : ''}` : ''}`} onClick={(e) => { if (selectMode) { e.preventDefault(); onPick(n.id, e.shiftKey); } else onLeave(); }}
        draggable={!selectMode && !(n.access && n.access !== 'owner' && !n.canManage)}
        onDragStart={(e) => { e.dataTransfer.setData('application/x-peblo-note', n.id); e.dataTransfer.effectAllowed = 'move'; if (onDrag) setTimeout(() => onDrag(n.id), 0); }}
        onDragEnd={() => { if (onDrag) setTimeout(() => onDrag(null), 0); }}
        onContextMenu={(e) => { if (onCtx) { e.preventDefault(); onCtx(e, n); } }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          const rows = [...document.querySelectorAll('.s-notes-rows .s-note-row')];
          const nx = rows[rows.indexOf(e.currentTarget) + (e.key === 'ArrowDown' ? 1 : -1)];
          if (nx) { e.preventDefault(); nx.focus(); }
        }}>
        {selectMode && <span className={`np-ck${sel ? ' on' : ''}`} role="checkbox" aria-checked={sel} aria-label={`Select ${n.title || 'Untitled'}`}>{sel && <Check size={14} strokeWidth={2.6} />}</span>}
        <span className="txt">
          <span className={`t${n.meta?.pinned ? ' pin' : ''}${untitled && first ? ' fb' : ''}`}><LiveDot id={n.id} />{n.meta?.pinned && <Pin size={12} strokeWidth={2.6} aria-label="Pinned" />}{untitled ? first || 'Untitled' : n.title}</span>
          {!selectMode && preview && <span className="s">{dq && n.matchSnippet ? <Hl text={n.matchSnippet} q={dq} /> : untitled && first ? 'No title yet' : snippetOfNote(n) || 'Empty note'}</span>}
          <span className="m">{n.access && n.access !== 'owner' && <span className="oa-own">{n.owner?.name ? `by ${n.owner.name} · ` : ''}</span>}{labels && n.meta?.folder && <span className="np-pill"><span className="np-dot" style={{ background: colorOf(fdef?.color || 'sand')[2] }} />{n.meta.folder}</span>}{(n.meta?.favourite || n.meta?.locked) && <span className="np-lockb">{n.meta?.favourite && <Star size={11} fill="currentColor" aria-label="Favourite" />}{n.meta?.locked && <Lock size={11} aria-label="Locked" />}</span>}<span data-testid="row-meta">{tags.length ? `${tags.map((t) => `#${t}`).join(' ')} · ` : ''}{stamp.label ? `${stamp.label} ${relTime(stamp.at)}` : relTime(stamp.at)}{n.team && n.lastEditedBy && n.lastEditedBy !== n.owner?.name ? ` · edited by ${n.lastEditedBy}` : ''}{n.taskCount > 0 ? ` · ${n.taskCount} task${n.taskCount > 1 ? 's' : ''}` : ''}{w >= 30 ? ` · ${w} words` : ''}</span>{hint && <span className="np-also" data-testid="also-in">{hint}</span>}</span>
        </span>
      </Link>

  );
});

/** Soft Studio — Notes (mockup: SoftNotes). List, editor and helpers, with its own layout. */
export default function SoftNotes() {
  const { id: routeId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const store = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
  const [filter, setFilter] = useState(() => (new URLSearchParams(window.location.search).get('filter') === 'trash' ? 'trash' : 'all'));
  const [favOnly, setFavOnly] = useState(false); // N39: only favourite notes
  const [selTags, setSelTags] = useState(() => (params.get('tag') ? [params.get('tag')] : []));
  const [tagMatch, setTagMatch] = useState('any');
  const [collapsed, setCollapsed] = useState(() => { try { if (JSON.parse(localStorage.getItem('peblo-settings') || '{}').rememberFolds === false) return {}; return JSON.parse(localStorage.getItem('peblo-notes-collapsed') || '{}') || {}; } catch { return {}; } });
  const toggleGroup = (k) => setCollapsed((c) => {
    const n = { ...c, [k]: !c[k] };
    if (!n[k]) delete n[k];
    try { localStorage.setItem('peblo-notes-collapsed', JSON.stringify(n)); } catch { /* ignore */ }
    return n;
  });
  const jumpTo = (k) => {
    setCollapsed((c) => { const n = { ...c }; delete n[`${group}:${k}`]; try { localStorage.setItem('peblo-notes-collapsed', JSON.stringify(n)); } catch { /* ignore */ } return n; });
    requestAnimationFrame(() => { const el = [...document.querySelectorAll('[data-gk]')].find((e) => e.getAttribute('data-gk') === k); el?.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
  };
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches);
  useEffect(() => { const m = window.matchMedia('(max-width: 700px)'); const f = () => setPhone(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  const [railOpen, setRailOpen] = useState({}); // empty side cards fold to one line until clicked
  const [phRail, setPhRail] = useState(null); // phone: which helper card is open as a sheet ('ask' | 'tasks' | 'ment')
  const [focus, setFocus] = useState(false);
  const [cursorsOn, setCursors] = usePresence();
  // in full screen people's live cursors are on by themselves; leaving it puts the earlier choice back (off unless it was turned on)
  useEffect(() => {
    if (!focus) return undefined;
    const prev = appPref();
    setPresence(true);
    return () => restoreAppPresence(prev);
  }, [focus]);
  const [fsp, setFsp] = useFocusPrefs(); // full-screen choices (width, text size, theme, tools), kept per person in this browser
  
  const [shareOpen, setShareOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const shareTargets = useShareTargets();
  const [wide, setWide] = useState(() => store('peblo-focus-width', 'wide'));
  const [doc, setDoc] = useState(null); // the open note (local copy while editing)
  const shareOk = useShareAllowed(doc?.id, !!doc && !doc.isDraft); // hides "Share link" with a reason where the policy or the team does not allow it
  const [editorKey, setEditorKey] = useState('none');
  const [preview, setPreview] = useState(false);
  const [tagDraft, setTagDraft] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [toastAct, setToastAct] = useState(null); // { label, run }: a button on the message (Undo)
  const toastTimer = useRef(null);
  const [allLinked, setAllLinked] = useState(false);
  const publicUrl = usePublicUrl();
  const spaceRole = useSpaceRole();
  const { data: wsData } = useWorkspaces();
  const curSpace = useCurrentSpace();
  const isOffice = (wsData?.orgs || []).flatMap((o) => o.spaces).find((x) => x.id === curSpace)?.kind === 'office';
  const [own, setOwn] = useState('all'); // Office only: all | mine | shared with me
  const [denied, setDenied] = useState(null);
  const viewer = spaceRole === 'viewer' || doc?.access === 'view';
  const locked = !!doc?.meta?.locked; // N39: a locked note is read only for everyone until it is unlocked
  const manageable = noteManageable(doc, spaceRole); // R27: archive, pin, move, trash, duplicate and share need the author or a team lead
  const canPurge = !spaceRole || spaceRole === 'lead';
  const [q, setQ] = useState(() => params.get('q') || ''); // the search box (the palette's "See all" arrives with ?q=)
  const [dq, setDq] = useState(''); // what was typed, after a short pause
  const [diffV, setDiffV] = useState(null); // the earlier version being compared
  const [typewriter, setTypewriter] = useState(() => store('peblo-typewriter', 'off'));
  const { list: savedQ, add: addSavedSearch, drop: dropSearch } = useSavedSearches(); // N46: kept in the account, this device's old list is moved up once
  const keep = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
  // folders, view options and bulk actions (Notes panel)
  const { settings: acct, updateSettings } = useAuth();
  const [viewBase, setViewState] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem('peblo-notes-view') || 'null'); if (v && typeof v === 'object') return { ...DEFAULT_VIEW, ...migrateView(v) }; } catch { /* ignore */ }
    const old = { sort: store('peblo-notes-sort', 'updated'), group: store('peblo-notes-group', '') };
    return { ...DEFAULT_VIEW, ...(['cozy', 'compact'].includes(acct?.noteDensity) ? { density: acct.noteDensity } : {}), sort: ['updated', 'created', 'title'].includes(old.sort) ? old.sort : 'updated', pinFirst: old.sort === 'pinned' || true, group: ['date', 'folder', 'tag', 'none'].includes(old.group) ? old.group : (['date', 'folder', 'tag', 'none'].includes(acct?.noteGroup) ? acct.noteGroup : 'date') };
  });
  // Density has one source, the account's noteDensity (Settings > Notes, the Compact switch and this list's View menu share it).
  const density = effectiveDensity(acct);
  const view = useMemo(() => ({ ...viewBase, density }), [viewBase, density]);
  const setView = (v) => {
    if (v.density && v.density !== density) updateSettings({ noteDensity: v.density });
    const { density: _d, ...rest } = v;
    setViewState(rest); try { localStorage.setItem('peblo-notes-view', JSON.stringify(rest)); } catch { /* ignore */ }
  };
  // one-off migration: a compact choice made only in this list's old View menu moves to the account
  useEffect(() => { try { if (acct?.noteDensity === undefined && JSON.parse(localStorage.getItem('peblo-notes-view') || '{}').density === 'compact') updateSettings({ noteDensity: 'compact' }); } catch { /* ignore */ } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const sort = view.sort;
  const group = view.group;
  const layout = ['cards', 'sections', 'classic'].includes(acct?.noteLayout) ? acct.noteLayout : 'cards';
  const [viewOpen, setViewOpen] = useState(false);
  // { kind: 'folder' | 'smart', id }. N11: the open folder is also in the address (?folder=<id>), so refresh, Back and links keep it.
  const [fSel, setFSelState] = useState(() => { const id = new URLSearchParams(window.location.search).get('folder'); return id ? { kind: 'folder', id } : null; });
  const setFSel = useCallback((v) => {
    setFSelState(v);
    const id = v?.id || null;
    const sp = new URLSearchParams(window.location.search);
    if ((sp.get('folder') || null) === id) return;
    if (id) sp.set('folder', id); else sp.delete('folder');
    const qs = sp.toString();
    navigate(`${window.location.pathname}${qs ? `?${qs}` : ''}`); // a new history step: Back returns to the folder before
  }, [navigate]);
  const [cards, setCards] = useState(false); // the folder cards view
  const [gSel, setGSel] = useState(null); // the date or tag card that is open
  const [sheet, setSheet] = useState(null); // 'move' | 'tag' | 'folder'
  const [cardMenu, setCardMenu] = useState(null); // the "..." menu of a folder card: { d, x, y }
  const [folderEdit, setFolderEdit] = useState(null); // the folder being edited (or {} for a new one)
  const [smartPage, setSmartPage] = useState(null); // { initial, startName }
  const [moveAfter, setMoveAfter] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [picked, setPicked] = useState([]);
  const defs = Array.isArray(acct?.noteFolders) ? acct.noteFolders : [];
  const saveSearch = () => addSavedSearch(q);
  const bodyRef = useRef(null);
  // the note text size is Settings > Notes > Text size in notes (settings.fontSize); the old per-note 'peblo-note-font' is still read
  // N32: Text size is chosen from the note's "..." menu too (S / M / L shown at once); it is the account's settings.fontSize
  const pickFont = (k) => {
    try { localStorage.removeItem('peblo-note-font'); } catch { /* ignore */ } // the old per-device choice would win over 'medium'
    updateSettings({ fontSize: { s: 'small', m: 'medium', l: 'large' }[k] });
  };
  const noteFont = useMemo(() => ({ small: 's', medium: 'm', large: 'l' }[effectiveNoteFont(acct, (() => { try { return localStorage.getItem('peblo-note-font'); } catch { return null; } })())] || 'm'), [acct?.fontSize]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- data ----------
  const { data: allNotes = [], isSuccess: sidebarOk } = useQuery({
    queryKey: ['notes', 'soft-sidebar'], // not 'sidebar': other screens share that key and expect full text
    queryFn: () => { const sp = getSpace() || null; return notesAPI.getAll({ sort: 'updated', fields: 'list' }).then((r) => { sidebarSpace.current = sp; return r.data.notes || []; }); },
  });
  const listParams = filter === 'archive' ? { archived: 'true' } : filter === 'trash' ? { deleted: 'true' } : filter === 'all' ? {} : { tag: filter };
  const { data: listed = [] } = useQuery({
    queryKey: ['notes', 'soft', filter],
    queryFn: () => notesAPI.getAll({ sort: 'updated', fields: 'list', ...listParams }).then((r) => r.data.notes || []),
  });
  useEffect(() => { const t = setTimeout(() => { const v = q.trim(); setDq(v.length >= 2 ? v : ''); /* the server wants two characters */ }, 250); return () => clearTimeout(t); }, [q]);
  const searchOn = dq.length >= 2;
  const typing = q.trim().length >= 2 && q.trim() !== dq; // waiting for the 250 ms pause
  const { data: found = [], isFetching: searching } = useQuery({
    queryKey: ['notes', 'find-soft', dq, filter],
    enabled: searchOn,
    queryFn: () => notesAPI.getAll({ search: dq, fields: 'list', ...listParams }).then((r) => r.data.notes || []),
  });
  // The Gallery reads picture links out of the text, which the light list does not carry: fetch the full list only while it is open
  const { data: galleryNotes = [] } = useQuery({
    queryKey: ['notes', 'gallery'],
    queryFn: () => notesAPI.getAll({ sort: 'updated' }).then((r) => r.data.notes || []),
    enabled: galleryOpen,
    staleTime: 60000,
  });
  const noteId = doc && !doc.isDraft ? doc.id : null;
  const { data: linked = [] } = useQuery({
    queryKey: ['todos', 'note', noteId],
    queryFn: () => todosAPI.getAll({ noteId }).then((r) => r.data.todos || []),
    enabled: !!noteId,
  });
  const versionsQ = useQuery({
    queryKey: ['notes', 'backups', noteId],
    queryFn: () => notesAPI.getBackups(noteId).then((r) => r.data.backups || r.data || []),
    enabled: !!noteId,
    retry: (n, e) => ![403, 404].includes(e?.response?.status) && n < 2, // no access / not found will not get better by asking again
  });
  const versions = versionsQ.data || [];
  const vErr = versionsQ.error?.response?.status;
  const vErrText = vErr === 403 ? "You do not have access to this note's history" : vErr === 404 ? 'History is not available for this note' : '';

  const tagCounts = useMemo(() => {
    const m = new Map();
    for (const n of allNotes) for (const t of n.tags || []) if (t !== 'inbox' && t !== 'private') m.set(t, (m.get(t) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [allNotes]);
  const inboxCount = useMemo(() => allNotes.filter((n) => (n.tags || []).includes('inbox')).length, [allNotes]);
  const favCount = useMemo(() => allNotes.filter((n) => n.meta?.favourite && !n.isDeleted && !n.isArchived).length, [allNotes]);
  const pinnedCount = useMemo(() => allNotes.filter((n) => n.meta?.pinned && !n.isDeleted && !n.isArchived).length, [allNotes]);
  const allDefs = useMemo(() => withLegacy(defs, allNotes), [defs, allNotes]);
  const normalDefs = useMemo(() => allDefs.filter((d) => !d.smart), [allDefs]);
  const smartDefs = useMemo(() => allDefs.filter((d) => d.smart), [allDefs]);
  const selDef = fSel ? allDefs.find((d) => d.id === fSel.id) : null;
  const folders = useMemo(() => normalDefs.map((d) => d.name), [normalDefs]);
  // N11: the folder in the address may be a smart folder, or gone
  useEffect(() => {
    if (!fSel) return;
    if (selDef) { const k = selDef.smart ? 'smart' : 'folder'; if (k !== fSel.kind) setFSelState({ kind: k, id: fSel.id }); }
    else if (sidebarOk && acct) setFSel(null); // a folder that no longer exists
  }, [fSel, selDef, sidebarOk]); // eslint-disable-line react-hooks/exhaustive-deps
  // Back / Forward: the open folder follows the address
  useEffect(() => {
    const on = () => { const id = new URLSearchParams(window.location.search).get('folder'); setFSelState((cur) => ((cur?.id || null) === id ? cur : id ? { kind: 'folder', id } : null)); };
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  // opening a note (rows link to /notes/<id>) keeps the open folder in the address, so a refresh keeps it too
  const loc = useLocation();
  useEffect(() => {
    if (!fSel) return;
    const sp = new URLSearchParams(loc.search);
    if (sp.get('folder') === fSel.id) return;
    sp.set('folder', fSel.id);
    navigate(`${loc.pathname}?${sp.toString()}`, { replace: true });
  }, [loc.pathname, loc.search, fSel]); // eslint-disable-line react-hooks/exhaustive-deps
  const passes = (n) => {
    if (!selDef) return true;
    return selDef.smart ? smartMatch(n, selDef.smart, selDef.smartMode) : inFolder(n, selDef, allDefs, view.subs);
  };
  const fCounts = useMemo(() => folderCounts(allNotes, allDefs, view.subs), [allNotes, allDefs, view.subs]); // one pass for every folder (audit R36)
  const folderCount = (d) => fCounts.get(d.id) || 0;
  const groups = useMemo(() => {
    const ownOk = (n) => !isOffice || own === 'all' || (own === 'mine' ? n.access === 'owner' : n.access && n.access !== 'owner');
    if (dq) return [{ key: 'found', label: '', notes: found.filter((n) => passes(n) && ownOk(n)) }]; // best match first, as the server ranked them
    let base = (filter === 'all' || filter === 'inbox' ? allNotes : listed).filter((n) => passes(n) && ownOk(n));
    if (filter === 'inbox') base = base.filter((n) => (n.tags || []).includes('inbox'));
    if (favOnly && filter !== 'archive' && filter !== 'trash') base = base.filter((n) => !!n.meta?.favourite);
    if (filter !== 'archive' && filter !== 'trash' && selTags.length) {
      base = base.filter((n) => (tagMatch === 'all' ? selTags.every((t) => (n.tags || []).includes(t)) : selTags.some((t) => (n.tags || []).includes(t))));
    }
    if (isOffice && own === 'all' && filter !== 'archive' && filter !== 'trash') { // an Office: your notes, then the ones shared with you (mockup E01)
      const byNew = (x, y) => new Date(y.updatedAt || 0) - new Date(x.updatedAt || 0);
      const out2 = [['ofc-mine', 'Mine', base.filter((n) => n.access === 'owner' || !n.access).sort(byNew)], ['ofc-shared', 'Shared with me', base.filter((n) => n.access && n.access !== 'owner').sort(byNew)]];
      return out2.filter((g) => g[2].length).map(([key, label, notes]) => ({ key, label, notes }));
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
      for (const g of groupByTag(rest)) out.push({ key: `t-${g.tag}`, tag: g.tag, label: g.tag === 'untagged' ? 'Untagged' : `#${g.tag}`, notes: g.notes }); // N42
    } else if (group === 'folder') {
      const m = new Map();
      for (const n of rest) { const t = n.meta?.folder || 'No folder'; if (!m.has(t)) m.set(t, []); m.get(t).push(n); }
      for (const [t, notes] of [...m.entries()].sort((a, b) => (a[0] === 'No folder') - (b[0] === 'No folder') || a[0].localeCompare(b[0]))) out.push({ key: `f-${t}`, label: t, notes });
    } else {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const week = start.getTime() - 6 * 86400000;
      const buckets = [['today', 'Today', []], ['week', 'This week', []]];
      const older = new Map(); // month and year groups, newest first because the notes are already sorted
      for (const n of rest) {
        const t = time(n, sort === 'created' ? 'createdAt' : 'updatedAt');
        if (t >= start.getTime()) buckets[0][2].push(n);
        else if (t >= week) buckets[1][2].push(n);
        else {
          const d = new Date(t);
          const k = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`;
          if (!older.has(k)) older.set(k, { label: d.toLocaleDateString('en-GB', { month: 'long', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }), notes: [] });
          older.get(k).notes.push(n);
        }
      }
      for (const [key, label, notes] of buckets) if (notes.length) out.push({ key, label, notes });
      for (const [k, g] of older) out.push({ key: `m-${k}`, label: g.label, notes: g.notes });
    }
    return out;
  }, [allNotes, listed, filter, selTags, tagMatch, view, dq, found, fSel, allDefs, isOffice, own, favOnly]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownGroups = gSel && !dq ? groups.filter((g) => g.key === gSel) : groups;
  const dateTagCards = !isOffice && layout === 'cards' && (group === 'date' || group === 'tag') && !dq && filter === 'all' && !selectMode && !fSel && !cards;
  const gOpen = !isOffice && layout === 'cards' && !!gSel && !dq && !fSel && (group === 'date' || group === 'tag') && filter === 'all' && !selectMode;
  const folderMode = group === 'folder' && !dq && filter === 'all' && !selectMode; // Group by Folder shows the folder cards
  useEffect(() => { setGSel(null); }, [group, filter]);
  const shownList = useMemo(() => uniqueNotes(groups.flatMap((g) => g.notes)), [groups]); // a note under several tag groups is one note here
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
    rememberNoteSpace(note.id);
    setDoc({ ...note, title: editable(note.title), content: peekFinalText(note.id) ?? (note.content || ''), tags: note.tags || [] }); // peekFinalText: text typed a moment ago that is still on its way to the server
    setEditorKey(`${note.id}-${Date.now()}`);
    setPreview(!!note.isDeleted || new URLSearchParams(window.location.search).get('view') === 'reader'); // Open as > Reader view
    setTagDraft(null);
    setMenuOpen(false);
    setHistoryOpen(false);
  }, []);

  // set when the person closed every tab on purpose: the list must not open a note again by itself
  const noAuto = useRef(false);
  const loadingId = useRef(null); // the note whose full text is being fetched for the editor
  const closeDoc = useCallback(() => { noAuto.current = true; setDoc(null); setEditorKey('none'); navigate('/notes', { replace: true }); }, [navigate]);
  // R30: a note of the old space must not stay open (and become a tab) in the new space. Its last words were already sent to
  // the space it was opened in (useSwitchSpace flushes, and every save goes to the note's own space).
  const prevSpace = useRef(curSpace);
  useEffect(() => {
    if (prevSpace.current === curSpace) return;
    prevSpace.current = curSpace;
    if (docRef.current && !docRef.current.isDraft) { noAuto.current = false; setDoc(null); setEditorKey('none'); }
  }, [curSpace]);
  useEffect(() => { if (doc?.id && !doc.isDraft && params.get('view') === 'reader') setPreview(true); }, [doc?.id, params.get('view')]); // eslint-disable-line react-hooks/exhaustive-deps -- Open as > Reader view

  const draftKeyRef = useRef(null); // which draft '__draft__' means right now (N28)
  const draftJobs = useRef(new Map()); // draft key -> the request creating it: later saves of that draft wait for it and save into it
  const startDraft = useCallback(() => {
    noAuto.current = false;
    rememberNoteSpace('__draft__');
    const draftKey = `d${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    draftKeyRef.current = draftKey;
    const folderName = selDef && !selDef.smart ? selDef.name : '';
    setDoc({ id: '__draft__', isDraft: true, draftKey, title: '', content: '', tags: selTags.length ? selTags : filter === 'inbox' ? ['inbox'] : [], meta: folderName ? { folder: folderName } : undefined, createdAt: new Date().toISOString() });
    setEditorKey(`draft-${Date.now()}`);
    setPreview(false);
    navigate('/notes', { replace: true });
  }, [filter, navigate, selDef, selTags]);

  useEffect(() => {
    if (params.get('new') === '1') {
      setParams({}, { replace: true });
      startDraft();
      return;
    }
    if (!routeId) {
      if (!doc && !noAuto.current && allNotes[0] && !phone) navigate(`/notes/${allNotes[0].id}`, { replace: true });
      return;
    }
    setDenied(null);
    if (doc?.id === routeId) return;
    noAuto.current = false;
    const found = allNotes.find((n) => n.id === routeId) || listed.find((n) => n.id === routeId);
    if (found && typeof found.content === 'string') open(found);
    else if (loadingId.current !== routeId) { // a list entry has no text (light list), or the note is not in the list: load it whole
      loadingId.current = routeId;
      notesAPI.get(routeId, { deleted: !!found?.isDeleted }).then((r) => { if (loadingId.current === routeId) open(r.data.note); }).finally(() => { if (loadingId.current === routeId) loadingId.current = null; }).catch((e) => { if (loadingId.current !== null && loadingId.current !== routeId) return; /* moved on to another note while this one loaded */ if (e.response?.status === 403 && e.response?.data?.code === 'no_access') setDenied({ owner: e.response.data.owner }); else { flash(e.response?.status === 404 ? 'That note is not here. It may be in another space, in the Trash, or deleted.' : 'Could not open that note.'); navigate('/notes', { replace: true }); } });
    }
  }, [routeId, allNotes, listed, params]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- saving ----------
  const saveData = useMemo(() => {
    if (!doc || doc.isDeleted || viewer) return null; // a view-only note never autosaves
    if (doc.isDraft && !doc.title.trim() && !doc.content.trim()) return null;
    return { title: doc.title, content: doc.content, tags: doc.tags };
  }, [doc?.title, doc?.content, doc?.tags, doc?.isDraft, doc?.isDeleted, viewer]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveFn = useCallback(async (id, payload) => {
    if (id === '__draft__') {
      // N28: one draft is created once. A save that comes while the note is being created (typing on, a retry, the flush when
      // the id changes) waits for that request and saves into the new note instead of creating a second one.
      const key = draftKeyRef.current;
      const running = draftJobs.current.get(key);
      if (running) {
        const made = await running;
        await saveNoteSafe(made.id, { ...payload, title: payload.title || 'Untitled' });
        return { newId: made.id };
      }
      const dm = docRef.current?.isDraft && docRef.current.draftKey === key ? docRef.current.meta : null;
      const spaceCfg = noteSpaceCfg('__draft__');
      const job = notesAPI.create({ ...payload, title: payload.title || 'Untitled', ...(dm?.folder ? { meta: { folder: dm.folder } } : {}) }, spaceCfg).then((r) => r.data.note);
      draftJobs.current.set(key, job);
      job.catch(() => { if (draftJobs.current.get(key) === job) draftJobs.current.delete(key); }); // a failed create may be tried again
      const created = await job;
      rememberNoteSpace(created.id, spaceCfg?.spaceOverride ?? null);
      // Keep the editor as it is; only the id changes.
      setNoteBase(created.id, created.updatedAt, payload.content);
      const still = docRef.current?.isDraft && docRef.current.draftKey === key; // not if the person started another draft meanwhile
      setDoc((d) => (d && d.isDraft && d.draftKey === key ? { ...d, id: created.id, isDraft: false, meta: created.meta || d.meta, createdAt: created.createdAt, updatedAt: created.updatedAt } : d));
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      if (still) navigate(`/notes/${created.id}${window.location.search}`, { replace: true });
      return { newId: created.id };
    }
    let res;
    try { res = await saveNoteSafe(id, { ...payload, title: payload.title || 'Untitled' }); } catch (e) {
      if (e?.response?.data?.code === 'locked') { // locked on another device meanwhile: the editor becomes read only; the text stays in the local copy
        setDoc((d) => (d && d.id === id ? { ...d, meta: { ...(d.meta || {}), locked: true } } : d));
        lockedFlash.current?.();
      }
      throw e;
    }
    const now = res?.updatedAt ? new Date(res.updatedAt).toISOString() : new Date().toISOString();
    setDoc((d) => (d && d.id === id ? { ...d, updatedAt: now } : d));
    // the cached list entry is updated in place; a light entry (no text) gets a fresh snippet and word count instead of the text
    queryClient.setQueriesData({ queryKey: ['notes'] }, (old) => (Array.isArray(old)
      ? old.map((n) => {
        if (n.id !== id) return n;
        if (n.light) {
          const { content: text, ...rest } = payload;
          const hasText = typeof text === 'string';
          return { ...n, ...rest, title: payload.title || 'Untitled', updatedAt: now, ...(hasText ? { snippet: snippetOf(text, 140), wordCount: countWords(text), hasPics: /!\[|<figure>/.test(text) } : {}) };
        }
        return { ...n, ...payload, title: payload.title || 'Untitled', updatedAt: now };
      })
      : old));
  }, [navigate, queryClient]);

  const lockedFlash = useRef(null);
  const { saveStatus, forceSave } = useAutoSave(doc?.id, saveData, saveFn, 1000, saveNoteOnUnload);
  // "Saved" is shown for two seconds after a save finishes, then fades back to the quiet tick
  const [justSaved, setJustSaved] = useState(false);
  const prevSave = useRef(saveStatus);
  useEffect(() => {
    const was = prevSave.current; prevSave.current = saveStatus;
    if (was === 'saving' && saveStatus === 'saved') { setJustSaved(true); const t = setTimeout(() => setJustSaved(false), 2000); return () => clearTimeout(t); }
    setJustSaved(false); // any other change (typing again, another note) ends the "Saved" message
    return undefined;
  }, [saveStatus]);
  const forceSaveRef = useRef(forceSave);
  forceSaveRef.current = forceSave;
  const leaveNote = useCallback(() => forceSaveRef.current(), []);
  useEffect(() => { setNoteFlusher(() => forceSaveRef.current()); return () => setNoteFlusher(null); }, []); // stable, so the memoised rows are not rebuilt when the save function changes
  const lastPick = useRef(null); // the row last ticked: shift-click ticks (or clears) everything between it and the clicked row
  const visibleRef = useRef([]);
  const pickNote = useCallback((id, shift) => {
    const list = visibleRef.current;
    const a = lastPick.current;
    const i = shift && a ? list.indexOf(a) : -1;
    const j = list.indexOf(id);
    lastPick.current = id;
    if (i >= 0 && j >= 0) {
      const range = list.slice(Math.min(i, j), Math.max(i, j) + 1);
      setPicked((p) => (p.includes(id) ? p.filter((x) => !range.includes(x)) : [...new Set([...p, ...range])]));
    } else setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }, []);
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
      const caret = captureCaret(bodyRef.current); // N27: the editor is rebuilt with the merged text; put the cursor back where it was
      setDoc((cur) => ({ ...cur, content: m.content, updatedAt: new Date(m.updatedAt).toISOString() }));
      setEditorKey(`merged-${Date.now()}`);
      if (caret) setTimeout(() => restoreCaret(bodyRef.current, caret), 60);
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
    if (!f || !base || d.content !== base.content) return; // only when nothing was typed since the last load or save
    if (new Date(f.updatedAt).getTime() <= new Date(base.updatedAt).getTime()) return;
    const apply = (content, updatedAt) => {
      const cur = docRef.current;
      if (!cur || cur.id !== d.id || cur.content !== d.content || content === cur.content) return; // typed, or switched note, meanwhile
      const caret = captureCaret(bodyRef.current);
      setDoc((c) => ({ ...c, content, updatedAt }));
      setEditorKey(`remote-${Date.now()}`);
      if (caret) setTimeout(() => restoreCaret(bodyRef.current, caret), 60);
    };
    if (typeof f.content === 'string') { if (f.content !== d.content) apply(f.content, f.updatedAt); return; }
    notesAPI.get(d.id).then((r) => apply(r.data.note.content || '', r.data.note.updatedAt)).catch(() => {}); // a light list entry has no text: fetch the note
  }, [allNotes]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (p) => setDoc((d) => (d ? { ...d, ...p } : d));

  // ---------- note actions ----------
  const refreshLists = () => {
    queryClient.invalidateQueries({ queryKey: ['notes'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const archive = async () => {
    setMenuOpen(false);
    await notesAPI.archive(doc.id);
    refreshLists();
    closeDoc();
  };
  const trash = async () => {
    setMenuOpen(false);
    const perm = !!doc.isDeleted;
    const id = doc.id; // read before the question: the person may open another note meanwhile
    if (perm && !(await confirmDialog({ title: 'Delete this note forever?', body: 'This cannot be undone.', confirmLabel: 'Delete forever', danger: true }))) return; // only the final delete asks; the Trash can be undone
    await notesAPI.delete(id, { permanent: perm });
    refreshLists();
    if (docRef.current?.id === id) closeDoc();
    if (!perm) flash('Moved to the Trash', { label: 'Undo', run: async () => { await notesAPI.restore(id); refreshLists(); navigate(`/notes/${id}`); } });
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
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const fileBase = () => (doc.title || 'Untitled').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'note';
  const noteHtml = async () => sanitizeHtml(`<h1>${(doc.title || 'Untitled').replace(/</g, '&lt;')}</h1>${marked.parse(await inlineMedia(mentionsToText(doc.content || '')))}`);
  const exportWord = async () => {
    setMenuOpen(false);
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${fileBase()}</title></head><body style="font-family:Calibri,Arial,sans-serif">${await noteHtml()}</body></html>`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff', html], { type: 'application/msword' }));
    a.download = `${fileBase()}.doc`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
  // N50: the server also stops a 4th pin (409 pin_limit); say so plainly
  const pinLimit = (e) => {
    if (e?.response?.data?.code !== 'pin_limit') return false;
    flash(e.response.data.error || 'You can pin up to 3 notes. Unpin one first.');
    return true;
  };
  // N39: favourite and lock are note meta (the same keys Orbit uses: meta.favourite, meta.locked)
  const setFlag = async (key, next, doneMsg) => {
    try { await notesAPI.update(doc.id, { meta: { [key]: next } }); } catch (e) { if (pinLimit(e)) return; flash('Could not change that. Try again.'); return; }
    patch({ meta: { ...(doc.meta || {}), [key]: next || undefined } });
    refreshLists();
    flash(doneMsg);
  };
  const toggleFav = () => { setMenuOpen(false); return setFlag('favourite', !doc.meta?.favourite, doc.meta?.favourite ? 'Removed from favourites' : 'Added to favourites'); };
  const toggleLock = () => { setMenuOpen(false); return setFlag('locked', !doc.meta?.locked, doc.meta?.locked ? 'Unlocked. You can edit this note again.' : 'Locked. Nobody can edit it until you unlock it.'); };
  const togglePin = async () => {
    setMenuOpen(false);
    const next = !doc.meta?.pinned;
    if (next && pinnedCount >= 3) { flash('You can pin up to 3 notes. Unpin one first.'); return; }
    try { await notesAPI.update(doc.id, { meta: { pinned: next } }); } catch (e) { if (pinLimit(e)) return; throw e; }
    patch({ meta: { ...(doc.meta || {}), pinned: next || undefined } });
    refreshLists();
    flash(next ? 'Pinned to Home' : 'Unpinned');
  };
  const addLinkedTask = async (e) => {
    e.preventDefault();
    const text = taskDraft.trim();
    if (!text || !noteId) return;
    setTaskDraft('');
    try { await todosAPI.create({ text, priority: 'medium', noteId }); } catch { setTaskDraft(text); flash('Could not add the task'); return; }
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
  const loadVersionText = useCallback((v) => notesAPI.getBackup(doc.id, v.id).then((r) => r.data?.backup?.content ?? ''), [doc?.id]);
  const keepAsNote = async ({ title, content }) => {
    try {
      const { data } = await notesAPI.create({ title, content, tags: doc.tags || [] });
      refreshLists();
      setDiffV(null);
      flash('Saved as its own note');
      return data.note;
    } catch { flash('Could not save a separate note'); return null; }
  };
  const restoreVersion = async (v) => {
    try { await notesAPI.revertBackup(doc.id, v.id); } catch (e) {
      const st = e.response?.status;
      flash(st === 403 ? (e.response?.data?.error || 'You do not have permission to restore versions of this note.') : st === 404 ? 'That version or note is no longer there.' : 'Could not restore that version');
      return;
    }
    const { data } = await notesAPI.get(doc.id, { deleted: !!doc.isDeleted });
    open(data.note);
    refreshLists();
    queryClient.invalidateQueries({ queryKey: ['notes', 'backups', doc.id] });
  };

  const leaveInbox = useRef(false); // set by the row menu on an Inbox note: moving it to a folder also takes it out of the Inbox (N14)
  const moveTo = async (name, only) => {
    setSheet(null);
    const outOfInbox = leaveInbox.current && !!name;
    leaveInbox.current = false;
    let ids = only ? [only] : selectMode && picked.length ? picked : doc ? [doc.id] : [];
    if (!(doc?.isDraft && ids.length === 1 && ids[0] === doc.id)) { ids = manageableIds(ids, { skipLocked: true }); if (!ids.length) { setPicked([]); setSelectMode(false); return; } }
    if (!only && !selectMode && doc?.isDraft) { // not saved yet: the folder is used when the note is first saved
      patch({ meta: name ? { ...(doc.meta || {}), folder: name } : undefined });
      flash(name ? `Will be saved in ${name}` : 'No folder');
      setPicked([]); setSelectMode(false);
      return;
    }
    // a folder that also collects by tag would pull a note back in, so taking a note out drops those tags too
    const collecting = (n) => (name ? (outOfInbox && (n.tags || []).includes('inbox') ? ['inbox'] : []) : allDefs.filter((d) => !d.smart && d.tag && (n.tags || []).includes(d.tag)).map((d) => d.tag));
    const dropped = new Set();
    const res = await runBulk(ids, (id) => {
      const n = id === doc?.id ? doc : allNotes.find((x) => x.id === id);
      const drop = n ? collecting(n) : [];
      drop.forEach((t) => dropped.add(t));
      return notesAPI.update(id, { meta: { folder: name || '' }, ...(drop.length ? { tags: (n.tags || []).filter((t) => !drop.includes(t)) } : {}) });
    });
    if (!selectMode && doc && (!only || only === doc.id) && res.done.includes(doc.id)) {
      const drop = collecting(doc);
      patch({ meta: { ...(doc.meta || {}), folder: name || '' }, ...(drop.length ? { tags: (doc.tags || []).filter((t) => !drop.includes(t)) } : {}) });
    }
    refreshLists();
    if (bulkReport(res, ids.length, { oneFail: 'Could not move' })) flash(plusSkipped(name ? `Moved to ${name}` : dropped.size ? `Removed from the folder (and ${[...dropped].map((t) => `#${t}`).join(', ')})` : 'Removed from folder', ids));
    setPicked([]); setSelectMode(false);
  };
  // ---- right-click menu on a note row, and dropping a note on a folder
  const [rowMenu, setRowMenu] = useState(null); // { n, x, y }
  const [dragId, setDragId] = useState(null); // the note being dragged: a tray of folders shows meanwhile
  const openRowMenu = useCallback((e, n) => setRowMenu({ n, x: e.clientX, y: e.clientY }), []);
  useEffect(() => {
    if (!rowMenu) return undefined;
    const off = () => setRowMenu(null);
    const esc = (e) => { if (e.key === 'Escape') setRowMenu(null); };
    window.addEventListener('pointerdown', off); window.addEventListener('keydown', esc); window.addEventListener('scroll', off, true);
    return () => { window.removeEventListener('pointerdown', off); window.removeEventListener('keydown', esc); window.removeEventListener('scroll', off, true); };
  }, [rowMenu]);
  const rowAct = async (fn, fail) => { setRowMenu(null); try { await fn(); } catch { flash(fail); } };
  const rowPin = (n) => rowAct(async () => {
    const next = !n.meta?.pinned;
    if (next && pinnedCount >= 3) { flash('You can pin up to 3 notes. Unpin one first.'); return; }
    try { await notesAPI.update(n.id, { meta: { pinned: next } }); } catch (e) { if (pinLimit(e)) return; throw e; }
    refreshLists(); flash(next ? 'Pinned to Home' : 'Unpinned');
  }, 'Could not change the pin');
  const rowFav = (n) => rowAct(async () => { await notesAPI.update(n.id, { meta: { favourite: !n.meta?.favourite } }); refreshLists(); flash(n.meta?.favourite ? 'Removed from favourites' : 'Added to favourites'); }, 'Could not change the favourite');
  const rowArchive = (n) => rowAct(async () => { await notesAPI.archive(n.id); refreshLists(); if (doc?.id === n.id) closeDoc(); flash('Archived'); }, 'Could not archive the note');
  const rowTrash = (n) => rowAct(async () => {
    await notesAPI.delete(n.id);
    refreshLists(); if (doc?.id === n.id) closeDoc();
    flash('Moved to the Trash', { label: 'Undo', run: async () => { await notesAPI.restore(n.id); refreshLists(); } });
  }, 'Could not delete the note');
  const rowUnlock = (n) => rowAct(async () => {
    await notesAPI.update(n.id, { meta: { locked: false } });
    if (docRef.current?.id === n.id) patch({ meta: { ...(docRef.current.meta || {}), locked: undefined } });
    refreshLists(); flash('Unlocked. You can edit, move or delete it again.');
  }, 'Could not unlock the note');
  const rowRestore = (n) => rowAct(async () => { await notesAPI.restore(n.id); refreshLists(); flash('Restored'); }, 'Could not restore the note');
  const rowDeleteForever = (n) => rowAct(async () => {
    if (!(await confirmDialog({ title: 'Delete this note forever?', body: 'This cannot be undone.', confirmLabel: 'Delete forever', danger: true }))) return;
    await notesAPI.delete(n.id, { permanent: true }); refreshLists(); if (doc?.id === n.id) closeDoc();
  }, 'Could not delete the note');
  const rowMove = (n) => { setRowMenu(null); leaveInbox.current = (n.tags || []).includes('inbox'); setSelectMode(true); setPicked([n.id]); setSheet('move'); };
  const rowCopyLink = (n) => rowAct(async () => { await navigator.clipboard.writeText(`${publicUrl || window.location.origin}/notes/${n.id}`); flash(publicUrl ? 'Link copied' : 'Link copied. It only works on this computer.'); }, 'Could not copy');
  const dropProps = (d) => (d.smart ? {} : {
    onDragOver: (e) => { if (e.dataTransfer.types.includes('application/x-peblo-note')) { e.preventDefault(); e.currentTarget.classList.add('drop'); } },
    onDragLeave: (e) => e.currentTarget.classList.remove('drop'),
    onDrop: (e) => {
      e.preventDefault(); e.currentTarget.classList.remove('drop'); setDragId(null);
      const id = e.dataTransfer.getData('application/x-peblo-note');
      const n = allNotes.find((x) => x.id === id);
      if (!id || !n) return;
      if (!mayManage(n)) { flash('Only the owner or a team lead can move this note'); return; }
      moveTo(d.name, id);
    },
  });
  const saveDefs = (next) => updateSettings({ noteFolders: next });
  const saveFolder = async (def) => {
    const old = defs.find((d) => d.id === def.id);
    const legacyOld = !old ? allDefs.find((d) => d.id === def.id) : null; // an older folder that had no definition yet
    const next = old || legacyOld ? [...defs.filter((d) => d.id !== def.id), { ...(old || {}), ...def }] : [...defs, def];
    const was = (old || legacyOld)?.name;
    setSheet(null); setFolderEdit(null); setSmartPage(null);
    if ((await saveDefs(next)) === false) { flash('Could not save the folder. Nothing was changed.'); return; } // do not touch the notes when the account did not take it
    if (was && !def.smart && was !== def.name) {
      // N4: one request renames the folder on every note of yours in this space, in one transaction (all or nothing)
      try { await notesBulkAPI.renameFolder(was, def.name); } catch {
        await saveDefs(defs); // put the old name back, so the folder and its notes still match
        refreshLists();
        flash('Could not rename the folder. Nothing was changed.');
        return;
      }
      refreshLists();
    }
    if (moveAfter && !def.smart) { setMoveAfter(false); await moveTo(def.name); return; }
    setFSel({ kind: def.smart ? 'smart' : 'folder', id: def.id });
    setFilter('all');
    flash(old ? 'Folder saved' : def.smart ? 'Smart folder created' : 'Folder created');
  };
  const deleteFolder = async (def) => {
    const count = def.smart ? 0 : allNotes.filter((n) => n.meta?.folder === def.name).length;
    if (!(await confirmDialog({ title: def.smart ? `Delete the smart folder "${def.name}"?` : `Delete the folder "${def.name}"?`, body: def.smart ? 'Your notes are not touched.' : count ? `Its ${count} note${count === 1 ? '' : 's'} stay, just out of the folder.` : '', confirmLabel: 'Delete folder', danger: true }))) return;
    setSheet(null); setFolderEdit(null); setSmartPage(null);
    if ((await saveDefs(defs.filter((d) => d.id !== def.id).map((d) => (d.parent === def.id ? { ...d, parent: undefined } : d)))) === false) { flash('Could not delete the folder. Nothing was changed.'); return; }
    if (count) {
      try { await notesBulkAPI.clearFolder(def.name); } catch { // N4: one request; on failure the folder comes back, so no note is left in a folder that is gone
        await saveDefs(defs);
        refreshLists();
        flash('Could not delete the folder. Nothing was changed.');
        return;
      }
      refreshLists();
    }
    if (fSel?.id === def.id) setFSel(null);
  };
  const openEdit = (d) => { if (d.smart) setSmartPage({ initial: d }); else { setFolderEdit(d); setSheet('folder'); } };
  const openNew = (andMove = false) => { setMoveAfter(andMove); setFolderEdit({}); setSheet('folder'); };
  const outsideMenu = useRef(null);
  const outsideHist = useRef(null);
  useOutside(outsideMenu, menuOpen, () => setMenuOpen(false));
  useOutside(outsideHist, historyOpen, () => setHistoryOpen(false));
  // Only notes this person may manage (the author or a team lead; nobody in a view-only space) are archived, pinned, moved or trashed in bulk.
  const mayManage = (n) => spaceRole !== 'viewer' && (!n || !n.access || n.access === 'owner' || n.canManage === true);
  // Returns the ids that may be changed. What was left out is said at once when nothing is left, otherwise it rides on the
  // final message (`.skipped`), so "Moved 3 to the Trash" does not hide "2 locked notes skipped".
  const manageableIds = (ids, { skipLocked = false } = {}) => {
    const noteOf = (id) => (id === doc?.id ? doc : allNotes.find((x) => x.id === id));
    const ok = ids.filter((id) => mayManage(noteOf(id)));
    const free = skipLocked ? ok.filter((id) => !noteOf(id)?.meta?.locked) : ok; // a locked note is not trashed, moved or archived (unlock it first)
    const notMine = ids.length - ok.length;
    const lockedN = ok.length - free.length;
    const parts = [];
    if (notMine) parts.push(`${notMine} note${notMine === 1 ? '' : 's'} skipped: only the author or a team lead can change ${notMine === 1 ? 'it' : 'them'}.`);
    if (lockedN) parts.push(`${lockedN} locked note${lockedN === 1 ? '' : 's'} skipped. Unlock ${lockedN === 1 ? 'it' : 'them'} first.`);
    free.skipped = parts.join(' ');
    if (free.skipped && !free.length) flash(free.skipped);
    return free;
  };
  const plusSkipped = (msg, ids) => (ids?.skipped ? `${msg}. ${ids.skipped}` : msg);
  const bulk = async (kind) => {
    if (!picked.length) return;
    const ids = manageableIds([...picked], { skipLocked: kind !== 'pin' });
    if (!ids.length) { setPicked([]); setSelectMode(false); return; }
    if (kind === 'pin') {
      const sel = allNotes.filter((n) => ids.includes(n.id));
      const unpin = sel.every((n) => n.meta?.pinned);
      const room = 3 - pinnedCount;
      const todo = unpin ? sel : sel.filter((n) => !n.meta?.pinned).slice(0, Math.max(room, 0));
      if (!unpin && todo.length < sel.filter((n) => !n.meta?.pinned).length) flash('You can pin up to 3 notes.');
      const res = await runBulk(todo.map((n) => n.id), (id) => notesAPI.update(id, { meta: { pinned: !unpin } }));
      refreshLists();
      if (!unpin && todo.length === 0) { return; }
      if (bulkReport(res, todo.length, { oneFail: 'Could not change the pin' })) flash(unpin ? 'Unpinned' : 'Pinned to Home');
    } else {
      const res = await runBulk(ids, (id) => (kind === 'trash' ? notesAPI.delete(id) : notesAPI.update(id, { isArchived: true })));
      refreshLists();
      const undo = kind === 'trash' && res.done.length ? async () => { const r = await runBulk(res.done, (id) => notesAPI.restore(id)); refreshLists(); if (r.failed.length) flash(partialText(r, res.done.length)); } : null;
      if (bulkReport(res, ids.length, { oneFail: kind === 'trash' ? 'Could not delete the note' : 'Could not archive the note', extra: undo && { label: `Undo the ${res.done.length} moved`, run: undo } })) {
        flash(plusSkipped(kind === 'trash' ? `Moved ${ids.length} to the Trash` : 'Archived', ids), undo ? { label: 'Undo', run: undo } : undefined);
      }
      if (doc && res.done.includes(doc.id)) closeDoc();
    }
    setPicked([]); setSelectMode(false);
  };
  const tagPicked = async (tag) => {
    setSheet(null);
    const want = allNotes.filter((n) => picked.includes(n.id) && !(n.tags || []).includes(tag));
    const todo = want.filter((n) => !n.meta?.locked); // the server refuses tag changes on a locked note
    const lockedN = want.length - todo.length;
    const skipped = lockedN ? `${lockedN} locked note${lockedN === 1 ? '' : 's'} skipped. Unlock ${lockedN === 1 ? 'it' : 'them'} first.` : '';
    const res = await runBulk(todo.map((n) => n.id), (id) => notesAPI.update(id, { tags: [...(allNotes.find((x) => x.id === id)?.tags || []), tag] }));
    refreshLists();
    if (bulkReport(res, todo.length, { oneFail: 'Could not add the tag' })) flash(todo.length ? `Tagged #${tag}${skipped ? `. ${skipped}` : ''}` : skipped || `Tagged #${tag}`);
    setPicked([]); setSelectMode(false);
  };
  // N49: emptying and restoring the Trash are one request each (one transaction on the server, this space only)
  const emptyTrash = async () => {
    if (!(await confirmDialog({ title: `Delete all ${shownList.length} notes in the Trash forever?`, body: 'This cannot be undone.', confirmLabel: 'Empty Trash', danger: true }))) return;
    try {
      const { data } = await notesBulkAPI.emptyTrash();
      flash(data?.count === 1 ? 'Trash emptied (1 note)' : `Trash emptied (${data?.count ?? 0} notes)`);
    } catch (e) { flash(e?.response?.data?.error || 'Could not empty the Trash. Nothing was deleted.'); return; } finally { refreshLists(); }
    if (doc?.isDeleted) closeDoc();
  };
  const restoreAllTrash = async () => {
    try {
      const { data } = await notesBulkAPI.restoreTrash();
      flash(data?.count === 1 ? 'Restored 1 note' : `Restored ${data?.count ?? 0} notes`);
      if (doc?.isDeleted) patch({ isDeleted: false });
    } catch (e) { flash(e?.response?.data?.error || 'Could not restore the Trash. Nothing was changed.'); } finally { refreshLists(); }
  };
  const { data: trashInfo } = useQuery({ queryKey: ['notes', 'trash-info'], queryFn: () => notesBulkAPI.trashInfo().then((r) => r.data), enabled: filter === 'trash', staleTime: 300000 });
  const duplicateTab = async (id) => {
    forceSave();
    let n = id === doc?.id ? doc : allNotes.find((x) => x.id === id);
    if (!n) return;
    if (!mayManage(n)) { flash('Only the author or a team lead can duplicate this note.'); return; }
    try {
      if (typeof n.content !== 'string') n = (await notesAPI.get(id)).data.note; // the list has no text
      const { data } = await notesAPI.create({ title: `Copy of ${n.title || 'Untitled'}`, content: n.content || '', tags: n.tags || [], ...(n.meta?.folder ? { meta: { folder: n.meta.folder } } : {}) });
      refreshLists();
      navigate(`/notes/${data.note.id}`);
      flash('Duplicated');
    } catch { flash('Could not duplicate the note'); }
  };
  const duplicate = async () => {
    setMenuOpen(false);
    forceSave();
    try {
      const { data } = await notesAPI.create({ title: `Copy of ${doc.title || 'Untitled'}`, content: doc.content || '', tags: doc.tags || [], ...(doc.meta?.folder ? { meta: { folder: doc.meta.folder } } : {}) });
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

  const flash = (msg, act) => {
    clearTimeout(toastTimer.current); // one timer: a newer message is not cut short by the older one
    setToast(msg); setToastAct(act || null);
    toastTimer.current = setTimeout(() => { setToast(''); setToastAct(null); }, act ? 6000 : 2200);
  };
  lockedFlash.current = () => flash('This note was locked on another device. Your last changes are kept on this device; unlock it to save them.');
  // bulk actions: at most 5 requests at a time; a partly failed run says "N of M done, K failed" with a Show button
  const [fails, setFails] = useState(null); // { list, extra }
  const titleOf = (id) => { const n = id === doc?.id ? doc : allNotes.find((x) => x.id === id); return !n ? 'Untitled' : n.title && n.title !== 'Untitled' ? n.title : firstOfNote(n) || 'Untitled'; };
  const runBulk = (ids, fn) => bulkRun(ids.map((id) => ({ id, title: titleOf(id) })), (it) => fn(it.id));
  const bulkReport = (res, total, { oneFail, extra } = {}) => { // true when everything worked
    if (!res.failed.length) return true;
    if (total === 1 && oneFail) flash(oneFail);
    else flash(partialText(res, total), { label: 'Show', run: () => setFails({ list: res.failed, extra }) });
    return false;
  };
  // runs an action and shows a message instead of failing silently
  const guarded = (fn, msg) => (...a) => Promise.resolve().then(() => fn(...a)).catch(() => flash(msg));
  const toggleTask = async (t) => {
    queryClient.setQueryData(['todos', 'note', noteId], (old) => (old || []).map((x) => (x.id === t.id ? { ...x, completed: !x.completed } : x)));
    try { await todosAPI.update(t.id, { completed: !t.completed }); } catch { flash('Could not update that task'); }
    queryClient.invalidateQueries({ queryKey: ['todos'] });
  };

  const visibleIds = useMemo(() => [...new Set(shownGroups.flatMap((g) => (collapsed[`${group}:${g.key}`] ? [] : g.notes.map((n) => n.id))))], [shownGroups, collapsed, group]);
  visibleRef.current = visibleIds;
  useNotesKeys({ selectMode, sheetOpen: !!sheet, visibleIds: visibleRef.current, hasDoc: !!doc, onPickAll: (ids) => setPicked(ids), onLeaveSelect: () => { setSelectMode(false); setPicked([]); setSheet(null); } });
  useFocusKeys({ enabled: !!doc && !doc.isDeleted, active: focus, toggle: () => setFocus((v) => !v), exit: () => { setFocus(false); } });
  const getFsScroller = useCallback(() => document.querySelector('.s-notes.focus .s-note-main'), []);
  const outline = useMemo(() => {
    const out = [];
    let fence = false;
    for (const l of (doc?.content || '').split('\n')) {
      if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; } // a # line inside a code block is not a heading
      if (fence) continue;
      const m = /^(#{1,3})\s+(.+)$/.exec(l);
      if (m) out.push({ level: m[1].length, text: m[2].replace(/[*_`]/g, '').trim() });
    }
    return out;
  }, [doc?.content]);
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
  const stats = useMemo(() => noteStats(doc?.content), [doc?.content]); // N38: words, not Markdown symbols or links
  const words = stats.words;
  const chars = stats.chars;

  // Notes that mention this note's title
  const deferredTitle = useDeferredValue(doc?.title); // a title keystroke should not wait for a scan of every note
  // The list has no note text any more, so the server finds them (it matches the saved title; refetched when the lists refresh).
  const mentionTitleOk = (deferredTitle || '').trim().length >= 4;
  const { data: mentionRows = [] } = useQuery({
    queryKey: ['notes', 'mentions', noteId],
    queryFn: () => notesAPI.mentions(noteId).then((r) => r.data.mentions || []),
    enabled: !!noteId && mentionTitleOk,
    staleTime: 30000,
    retry: false,
  });
  const mentions = useMemo(() => (doc && mentionTitleOk ? mentionRows.filter((n) => n.id !== doc.id).slice(0, 4) : []), [mentionRows, doc?.id, mentionTitleOk]); // eslint-disable-line react-hooks/exhaustive-deps

  const crumb = doc?.isDeleted ? 'Trash' : doc?.isArchived ? 'Archive' : doc?.meta?.folder ? doc.meta.folder : doc?.tags?.[0] ? cap(doc.tags[0]) : null;
  const saved = saveStatus === 'saving' ? { text: 'Saving…', icon: <Loader2 size={14} className="s-spin" /> }
    : saveStatus === 'unsaved' ? { text: 'Editing…', icon: null }
      : saveStatus === 'error' ? { text: "Couldn't save", icon: null, bad: true }
        : { text: 'Saved to your account', icon: <Check size={14} strokeWidth={2.4} /> };

  const listTitle = filter === 'archive' ? 'Archive' : filter === 'trash' ? 'Trash' : 'Notes';

  const fsParts = useShareParts(doc?.id);
  const renderTags = () => (
    <div className="s-note-tags">
      {viewer && <span className="s-viewer-note" data-testid="viewer-note"><Lock size={13} /> View only</span>}
      {locked && !viewer && <span className="s-lockb" data-testid="lock-badge"><Lock size={13} /> Locked{manageable && !doc.isDeleted && <button type="button" data-testid="unlock-btn" onClick={guarded(toggleLock, 'Could not unlock the note')}>Unlock</button>}</span>}
                {doc.tags.map((t) => (
                  <span key={t} className="s-tag s-note-tag" style={{ background: toneVar(toneOf(t)) }}>
                    #{t}
                    {!doc.isDeleted && !viewer && !locked && <button type="button" aria-label={`Remove tag ${t}`} onClick={() => patch({ tags: doc.tags.filter((x) => x !== t) })}><X size={12} strokeWidth={2.6} /></button>}
                  </span>
                ))}
                {tagDraft === null ? (
                  !doc.isDeleted && !viewer && !locked && <button type="button" className="s-dashed s-add-tag" onClick={() => setTagDraft('')}>+ tag</button>
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
                {!doc.isDeleted && !doc.isDraft && manageable && !viewer && !locked && <MoveNote noteId={doc.id} title={doc.title} mine={!doc.access || doc.access === 'owner' || doc.owner?.id === wsData?.me?.id} author={doc.owner?.name} />}
              </div>
  );
  const renderMenuItems = () => (
    <>
      {!doc.isDeleted && manageable && !locked && <button type="button" role="menuitem" data-testid="menu-archive" onClick={guarded(archive, 'Could not archive the note')}><Archive size={15} />{doc.isArchived ? 'Unarchive' : 'Archive'}</button>}
                    {!doc.isDeleted && manageable && <button type="button" role="menuitem" data-testid="menu-pin" onClick={guarded(togglePin, 'Could not change the pin')}><Pin size={15} />{doc.meta?.pinned ? 'Unpin from Home' : 'Pin to Home'}</button>}
                    {!doc.isDeleted && !viewer && <button type="button" role="menuitem" data-testid="menu-fav" onClick={guarded(toggleFav, 'Could not change the favourite')}><Star size={15} />{doc.meta?.favourite ? 'Remove from favourites' : 'Add to favourites'}</button>}
                    {!doc.isDeleted && manageable && <button type="button" role="menuitem" data-testid="menu-lock" onClick={guarded(toggleLock, 'Could not change the lock')}>{locked ? <LockOpen size={15} /> : <Lock size={15} />}{locked ? 'Unlock note' : 'Lock note (read only)'}</button>}
                    <div className="s-menu-sep" role="separator" />
      <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); window.dispatchEvent(new Event('pb-find-open')); }}><Search size={15} />Find in note  (Ctrl+F)</button>
                    {manageable && <button type="button" role="menuitem" data-testid="menu-duplicate" onClick={duplicate}><Copy size={15} />Duplicate note</button>}
          <button type="button" role="menuitem" onClick={async () => { setMenuOpen(false); try { await navigator.clipboard.writeText(`# ${doc.title || 'Untitled'}\n\n${await inlineMedia(doc.content || '')}`); flash('Copied as Markdown'); } catch { flash('Could not copy'); } }}><ClipboardCopy size={15} />Copy as Markdown</button>
          <button type="button" role="menuitem" onClick={async () => { setMenuOpen(false); try { await navigator.clipboard.writeText(`${publicUrl || window.location.origin}/notes/${doc.id}`); flash(publicUrl ? 'Link copied' : 'Link copied. It only works on this computer.'); } catch { flash('Could not copy'); } }}><Link2 size={15} />Copy link to note</button>
          {manageable && !locked && <button type="button" role="menuitem" data-testid="menu-move" onClick={() => { setMenuOpen(false); setSelectMode(false); setSheet('move'); }}><FolderInput size={15} />{doc.meta?.folder ? `Folder: ${doc.meta.folder}…` : 'Move to folder…'}</button>}
                    <SegRow label="Text size" icon={<Type size={15} />} testid="seg-size" value={noteFont} options={[['s', 'S', 'Small text'], ['m', 'M', 'Medium text'], ['l', 'L', 'Large text']]} onPick={pickFont} />
                    <SegRow label="Page width" icon={<MoveHorizontal size={15} />} testid="seg-width" value={wide === 'narrow' ? 'narrow' : 'wide'} options={[['narrow', 'Narrow'], ['wide', 'Wide']]} onPick={(n) => { setWide(n); keep('peblo-focus-width', n); }} />
                    <button type="button" role="menuitem" onClick={() => { const n = typewriter === 'on' ? 'off' : 'on'; setTypewriter(n); keep('peblo-typewriter', n); }}><Keyboard size={15} />Typewriter focus: {typewriter === 'on' ? 'On' : 'Off'}</button>
                    {!doc.isDeleted && !doc.isDraft && <button type="button" role="menuitem" data-testid="menu-versions" disabled={!versions.length} onClick={() => { setMenuOpen(false); if (versions[0]) setDiffV(versions[0]); }}><History size={15} />{vErrText || (versions.length ? `Version history (${versions.length} kept)` : 'No earlier versions')}</button>}
{!curSpace && !doc.isDeleted && !doc.isDraft && shareTargets.length > 0 && <button type="button" role="menuitem" data-testid="menu-team-share" className="ts-menu-hot" onClick={() => { setMenuOpen(false); setTeamOpen(true); }}><Users size={15} />Share with team...</button>}
          <div className="s-menu-sep" role="separator" />
      {manageable && (shareOk.allowed ? <button type="button" role="menuitem" data-testid="menu-share" onClick={() => { setMenuOpen(false); setShareOpen(true); }}><Share2 size={15} />Share link…</button> : <ShareBlocked reason={shareOk.reason} />)}
                    <button type="button" role="menuitem" onClick={guarded(exportPdf, 'Could not export the PDF')}><FileDown size={15} />Export as PDF</button>
                    <button type="button" role="menuitem" onClick={guarded(exportWord, 'Could not export to Word')}><FileDown size={15} />Export as Word</button>
                    <button type="button" role="menuitem" onClick={guarded(exportMd, 'Could not export the note')}><FileDown size={15} />Export as Markdown</button>
                    <div className="s-menu-sep" role="separator" />
      {manageable && (!doc.isDeleted || canPurge) && !(locked && !doc.isDeleted) && <button type="button" role="menuitem" className="danger" data-testid="menu-trash" onClick={guarded(trash, 'Could not delete the note')}><Trash2 size={15} />{doc.isDeleted ? 'Delete forever' : 'Move to Trash'}</button>}
    </>
  );
  const quickTask = async (text) => { await todosAPI.create({ text, priority: 'medium', noteId: doc.id }); queryClient.invalidateQueries({ queryKey: ['todos'] }); };
  return (
    <div className={`soft-page s-notes${focus ? ' focus' : ''}${phone ? (routeId ? ' ph-note' : ' ph-list') : ''}`} data-width={wide}>
      {diffV && doc && !doc.isDraft && <CompareBox title={doc.title || 'Untitled'} now={{ content: doc.content || '', at: doc.updatedAt }} versions={versions} loadVersion={loadVersionText} initialId={diffV.id}
        onClose={() => setDiffV(null)} onRestore={async (v) => { setDiffV(null); await guarded(restoreVersion, 'Could not restore that version')(v); }} onKeep={keepAsNote} />}
      {teamOpen && doc && !doc.isDraft && <ShareToTeam noteId={doc.id} title={doc.title} onClose={() => setTeamOpen(false)} onDone={({ team, tasks }) => flash(`Shared with ${team.name}${tasks ? ` with ${tasks} task${tasks === 1 ? '' : 's'}` : ''}`)} />}
      {shareOpen && doc && !doc.isDraft && <ShareDialog kind="note" id={doc.id} title={doc.title} onClose={() => setShareOpen(false)} />}
      {fails && <BulkFailDialog fails={fails.list} extra={fails.extra} onClose={() => setFails(null)} />}
      {/* ---------- list ---------- */}
      {dragId && (
        <div className="np-droptray" data-testid="drop-tray" role="group" aria-label="Drop the note on a folder">
          <span className="lab">Drop on a folder</span>
          {[...normalDefs.filter((d) => !d.parent), ...normalDefs.filter((d) => d.parent)].map((d) => (
            <span key={d.id} className="np-drop" data-testid="drop-folder" {...dropProps(d)}><span className="np-dot" style={{ background: colorOf(d.color)[2] }} />{d.name}</span>
          ))}
          <span className="np-drop none" data-testid="drop-none" {...dropProps({ name: '' })}>No folder</span>
        </div>
      )}
      {cardMenu && (() => {
        const d = cardMenu.d;
        return (
          <NavMenu onClose={() => setCardMenu(null)} className="s-tab-menu s-row-menu" data-testid="folder-card-menu" style={{ left: Math.min(cardMenu.x, window.innerWidth - 260), top: Math.min(cardMenu.y, window.innerHeight - 200) }} onPointerDown={(e) => e.stopPropagation()}>
            <button type="button" role="menuitem" data-testid="fcm-edit" onClick={() => { setCardMenu(null); openEdit(d); }}>Edit</button>
            {!d.smart && !d.parent && <button type="button" role="menuitem" data-testid="fcm-sub" onClick={() => { setCardMenu(null); setMoveAfter(false); setFolderEdit({ parent: d.id }); setSheet('folder'); }}>New subfolder</button>}
            <button type="button" role="menuitem" className="danger" data-testid="fcm-delete" onClick={() => { setCardMenu(null); deleteFolder(d); }}>Delete</button>
          </NavMenu>
        );
      })()}
      {rowMenu && (() => {
        const n = rowMenu.n; const mine = mayManage(n); const lockedRow = !!n.meta?.locked && !n.isDeleted;
        return (
          <NavMenu onClose={() => setRowMenu(null)} className="s-tab-menu s-row-menu" data-testid="row-menu" style={{ left: Math.min(rowMenu.x, window.innerWidth - 260), top: Math.min(rowMenu.y, window.innerHeight - 280) }} onPointerDown={(e) => e.stopPropagation()}>
            <button type="button" role="menuitem" onClick={() => { setRowMenu(null); navigate(`/notes/${n.id}`); }}>Open</button>
            {mine && !n.isDeleted && <button type="button" role="menuitem" data-testid="rm-pin" onClick={() => rowPin(n)}>{n.meta?.pinned ? 'Unpin from Home' : 'Pin to Home'}</button>}
            {mine && lockedRow && <button type="button" role="menuitem" data-testid="rm-unlock" onClick={() => rowUnlock(n)}><LockOpen size={14} /> Unlock</button>}
            {mine && !n.isDeleted && !lockedRow && <button type="button" role="menuitem" data-testid="rm-move" className={(n.tags || []).includes('inbox') ? 'hot' : undefined} onClick={() => rowMove(n)}>{(n.tags || []).includes('inbox') ? 'Move to folder (out of Inbox)…' : 'Move to folder…'}</button>}
            {mine && !n.isDeleted && <button type="button" role="menuitem" data-testid="rm-fav" onClick={() => rowFav(n)}>{n.meta?.favourite ? 'Remove from favourites' : 'Add to favourites'}</button>}
            {!n.isDeleted && <button type="button" role="menuitem" data-testid="rm-dup" onClick={() => { setRowMenu(null); duplicateTab(n.id); }}>Duplicate</button>}
            <button type="button" role="menuitem" onClick={() => rowCopyLink(n)}>Copy link</button>
            {mine && !n.isDeleted && !lockedRow && <button type="button" role="menuitem" data-testid="rm-archive" onClick={() => rowArchive(n)}>Archive</button>}
            {mine && !n.isDeleted && !lockedRow && <button type="button" role="menuitem" className="danger" data-testid="rm-trash" onClick={() => rowTrash(n)}>Move to Trash</button>}
            {mine && n.isDeleted && <button type="button" role="menuitem" data-testid="rm-restore" onClick={() => rowRestore(n)}>Restore</button>}
            {mine && n.isDeleted && <button type="button" role="menuitem" className="danger" onClick={() => rowDeleteForever(n)}>Delete forever</button>}
          </NavMenu>
        );
      })()}
      <aside className={`s-notes-list np lay-${layout}${view.density === 'compact' ? ' compact' : ''}${selectMode ? ' selecting' : ''}`} aria-label="Notes">
        {selectMode ? (
          <div className="np-selhead"><button type="button" onClick={() => { setSelectMode(false); setPicked([]); setSheet(null); }}>Cancel</button><b>{picked.length} selected</b><button type="button" onClick={() => setPicked(picked.length === shownList.length ? [] : shownList.map((n) => n.id))}>{picked.length && picked.length === shownList.length ? 'Clear' : 'Select all'}</button></div>
        ) : gOpen ? (
          <div className="np-head np-fhead">
            <button type="button" className="np-ib" aria-label={`Back to ${group === 'tag' ? 'tags' : 'dates'}`} title="Back" onClick={() => setGSel(null)}><ChevronLeft size={18} strokeWidth={1.9} /></button>
            <div className="np-ftitle"><small>{group === 'tag' ? 'Tag' : 'Date'}</small><h1 className="s-notes-h1">{groups.find((g) => g.key === gSel)?.label || ''}</h1></div>
          </div>
        ) : fSel && selDef && filter !== 'archive' && filter !== 'trash' ? (
          <div className="np-head np-fhead">
            <button type="button" className="np-ib" aria-label="Back to folders" title="Back to folders" onClick={() => { setFSel(selDef.parent ? { kind: 'folder', id: selDef.parent } : null); if (!selDef.parent) setCards(true); }}><ChevronLeft size={18} strokeWidth={1.9} /></button>
            <div className="np-ftitle"><small>{selDef.smart ? 'Smart folder' : selDef.parent ? `Folders / ${normalDefs.find((d) => d.id === selDef.parent)?.name || ''}` : 'Folders'}</small><h1 className="s-notes-h1">{selDef.name}</h1></div>
            {!selDef.smart && <button type="button" className="s-new" data-testid="folder-new-note" aria-label={`New note in ${selDef.name}`} title={`New note in ${selDef.name}`} onClick={startDraft}><Plus size={18} strokeWidth={2.6} /></button>}
            <button type="button" className="np-ib" aria-label="Edit this folder" title="Edit this folder" onClick={() => openEdit(selDef)}><Pencil size={15} strokeWidth={1.8} /></button>
            <button type="button" className="np-ib" aria-label="Show all notes" title="Show all notes" onClick={() => { setFSel(null); setCards(false); if (folderMode) setView({ ...view, group: 'date' }); }}><X size={16} strokeWidth={2} /></button>
          </div>
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
            <button type="button" className={`np-view${group !== 'date' || sort !== 'updated' ? ' set' : ''}`} aria-label="View options" aria-haspopup="dialog" aria-expanded={viewOpen} onClick={() => setViewOpen((v) => !v)}><SlidersHorizontal size={16} strokeWidth={1.8} />{group !== 'date' || sort !== 'updated' ? { date: 'Date', folder: 'Folder', tag: 'Tag', none: 'None' }[group] : 'View'}</button>
          </div>
        )}
        {!selectMode && savedQ.length > 0 && <div className="s-saved-searches" aria-label="Saved searches">{savedQ.map((t) => <span key={t} className={t === q.trim() ? 'on' : ''}><button type="button" onClick={() => setQ(t)}>{t}</button><button type="button" className="x" aria-label={`Forget the search ${t}`} onClick={() => dropSearch(t)}><X size={12} /></button></span>)}</div>}
        {isOffice && filter !== 'archive' && filter !== 'trash' && (
          <div className="np-row" role="tablist" aria-label="Whose notes" data-testid="office-owner-chips">
            {[['all', 'All'], ['mine', 'Mine'], ['shared', 'Shared with me']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={own === k} className={`np-chip${own === k ? ' on' : ''}`} onClick={() => setOwn(k)}>{l}</button>)}
          </div>
        )}
        {filter !== 'archive' && filter !== 'trash' && !(fSel && selDef) && !gOpen && (
          <div className="np-row" role="tablist" aria-label="Folders">
            <button type="button" role="tab" aria-selected={filter === 'all' && !fSel} className={`np-chip${filter === 'all' && !fSel ? ' on' : ''}`} onClick={() => { setFilter('all'); setFSel(null); setCards(false); }}>All <i>{allNotes.length}</i></button>
            <button type="button" role="tab" aria-selected={filter === 'inbox'} title="Notes tagged inbox are new, unsorted notes" data-testid="chip-inbox" className={`np-chip${filter === 'inbox' ? ' on' : ''}`} onClick={() => { setFilter('inbox'); setFSel(null); }}><span className="np-dot" style={{ background: '#FFB48C' }} />Inbox <i>{inboxCount}</i></button>
            <button type="button" role="tab" aria-selected={favOnly} data-testid="chip-fav" title="Only your favourite notes" className={`np-chip${favOnly ? ' on' : ''}`} onClick={() => setFavOnly((v) => !v)}><Star size={13} strokeWidth={1.8} fill={favOnly ? 'currentColor' : 'none'} />Favourites <i>{favCount}</i></button>
            <button type="button" role="tab" aria-selected={cards || folderMode || !!fSel} className={`np-chip fold${cards || folderMode || fSel ? ' on' : ''}`} onClick={() => { setFilter('all'); setFSel(null); if (folderMode) { setView({ ...view, group: 'date' }); setCards(false); } else setCards((v) => !v); }}><Folder size={14} strokeWidth={1.8} />Folders <i>{normalDefs.filter((d) => !d.parent).length + smartDefs.length}</i></button>
            <button type="button" className="np-chip new" aria-label="New folder" title="New folder" onClick={() => openNew(false)}><Plus size={15} strokeWidth={1.8} /></button>
          </div>
        )}
        {filter === 'inbox' && !selectMode && <p className="np-help" data-testid="inbox-help">Notes tagged inbox are new, unsorted notes. Use a note's menu, Move to folder, to file it and clear it from the Inbox.</p>}
        {!selectMode && filter !== 'archive' && filter !== 'trash' && <TagFilterBar tags={tagCounts} sel={selTags} setSel={setSelTags} match={tagMatch} setMatch={setTagMatch} />}
        {(cards || folderMode || fSel) && filter !== 'archive' && filter !== 'trash' && (() => {
          const parent = fSel && fSel.kind === 'folder' ? normalDefs.find((d) => d.id === fSel.id) : null;
          const top = parent && parent.parent ? normalDefs.find((d) => d.id === parent.parent) : null;
          const list = fSel ? (parent ? normalDefs.filter((k) => k.parent === parent.id) : []) : [...normalDefs.filter((d) => !d.parent), ...smartDefs];
          const openCardMenu = (d, el) => { const b = el.getBoundingClientRect(); setCardMenu({ d, x: b.left, y: b.bottom + 4 }); };
          const card = (d) => (
            <div key={d.id} role="listitem" className="np-cardw">
              <button type="button" className={`np-card${d.smart ? ' sm' : ''}`} data-testid="folder-card" onClick={() => { setFilter('all'); setFSel({ kind: d.smart ? 'smart' : 'folder', id: d.id }); }} onDoubleClick={() => openEdit(d)} onContextMenu={(e) => { e.preventDefault(); openEdit(d); }} onKeyDown={(e) => { if (e.key === 'F2') { e.preventDefault(); openEdit(d); } }} {...dropProps(d)} title="Click or press Enter to open, double-click or F2 to edit" aria-keyshortcuts="F2">
                {d.smart ? <span className="np-card-ic"><Zap size={20} strokeWidth={1.8} /></span> : <FolderChip tone={d.color} icon={d.icon} size={20} className="np-card-ic" />}
                <b>{d.name}</b><i>{folderCount(d)} {folderCount(d) === 1 ? 'note' : 'notes'}</i>
              </button>
              <button type="button" className="np-card-more" data-testid="folder-card-more" aria-label={`Folder options for ${d.name}`} aria-haspopup="menu" onClick={(e) => openCardMenu(d, e.currentTarget)}><MoreHorizontal size={16} strokeWidth={2} /></button>
            </div>
          );
          return (
            <div className="np-cards-wrap">
              {fSel && !selDef && (
                <nav className="np-crumbs" aria-label="Folder path">
                  <button type="button" onClick={() => { setFSel(null); setCards(true); }}>Folders</button>
                  {top && <><span>/</span><button type="button" onClick={() => setFSel({ kind: 'folder', id: top.id })}>{top.name}</button></>}
                  {selDef && <><span>/</span><b>{selDef.name}</b></>}
                  {selDef && <button type="button" className="np-crumb-edit" aria-label="Edit this folder" title="Edit this folder" onClick={() => openEdit(selDef)}><Pencil size={13} strokeWidth={1.8} /></button>}
                  <button type="button" className="np-crumb-all" aria-label="Show all notes" title="Show all notes" onClick={() => { setFSel(null); setCards(false); if (folderMode) setView({ ...view, group: 'date' }); }}><X size={14} strokeWidth={2} /></button>
                </nav>
              )}
              {list.length > 0 && <div className="np-cards cards-w" role="list" aria-label="Folders">{list.map((d) => card(d))}</div>}
              {!fSel && list.length === 0 && (
                <div className="np-empty"><span className="np-empty-ic"><Folder size={22} strokeWidth={1.8} /></span><b>No folders yet</b><small>Folders keep related notes together. Smart folders fill themselves from a rule.</small><button type="button" className="np-empty-btn" onClick={() => openNew(false)}><Plus size={15} strokeWidth={2.2} />New folder</button></div>
              )}
            </div>
          );
        })()}
        {!isOffice && layout === 'sections' && !dq && !cards && !fSel && (group === 'date' || group === 'tag') && filter !== 'archive' && filter !== 'trash' && groups.length > 1 && (
          <div className="np-cards mini" role="list" aria-label={group === 'tag' ? 'Jump to a tag' : 'Jump to a date'}>
            {groups.map((g) => (
              <button key={g.key} type="button" role="listitem" className={`np-card mini${gSel === g.key ? ' on' : ''}`} onClick={() => jumpTo(g.key)}><b>{g.label}</b><i>{g.notes.length}</i></button>
            ))}
          </div>
        )}
        {dateTagCards && !gSel && (
          <div className="np-cards-wrap">
            <div className="np-cards gcards" role="list" aria-label={group === 'tag' ? 'Tags' : 'Dates'}>
              {groups.map((g, i) => {
                const col = FOLDER_COLORS[i % FOLDER_COLORS.length];
                return (
                  <button key={g.key} type="button" role="listitem" className="np-card gcard" onClick={() => setGSel(g.key)}>
                    <span className="np-card-ic fc" style={toneVars(col[0])}>{g.key === 'pin' ? <Pin size={20} strokeWidth={1.8} /> : <Folder size={20} strokeWidth={1.8} />}</span>
                    <b>{g.label}</b><i>{g.notes.length} {g.notes.length === 1 ? 'note' : 'notes'}</i>
                  </button>
                );
              })}
              {groups.length === 0 && <p className="s-empty" style={{ padding: '8px 12px' }}>No notes here yet.</p>}
            </div>
            {shownList.length > 0 && (
              <div className="np-recent" aria-label="Recent notes">
                <h3>Recent</h3>
                {[...shownList].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)).slice(0, 3).map((n) => (
                  <NoteRow key={n.id} n={n} on={doc?.id === n.id} selectMode={false} sel={false} preview={view.preview} labels={view.labels} dq="" fdef={n.meta?.folder ? normalDefs.find((d) => d.name === n.meta.folder) : null} sortBy={sort} onPick={pickNote} onLeave={leaveNote} onCtx={openRowMenu} onDrag={setDragId} />
                ))}
              </div>
            )}
          </div>
        )}
        {((!cards && !folderMode && !(dateTagCards && !gSel)) || fSel) && <div className="s-notes-rows">
          {spaceRole && filter === 'trash' && <p className="s-viewer-note" style={{ padding: '0 12px', whiteSpace: 'normal' }} data-testid="team-trash-note">Team trash is kept until a team lead deletes a note forever.</p>}
          {!spaceRole && filter === 'trash' && trashInfo?.retentionDays && <p className="np-trash-note" data-testid="trash-retention">Notes in the Trash are deleted for good after {trashInfo.retentionDays} days.</p>}
          {shownList.length === 0 && filter === 'trash' && (
            <div className="np-empty"><span className="np-empty-ic"><Trash2 size={22} strokeWidth={1.8} /></span><b>The Trash is empty</b><small>Deleted notes wait here until you remove them for good.</small></div>
          )}
          {shownList.length === 0 && filter !== 'trash' && <p className="s-empty" style={{ padding: '8px 12px' }}>{filter === 'trash' ? 'The Trash is empty.' : filter === 'archive' ? 'Nothing archived.' : dq ? (typing || searching ? 'Searching…' : `Nothing matches “${dq}”.`) : selDef ? (selDef.smart ? 'No notes match this smart folder yet.' : 'This folder is empty.') : 'No notes here yet.'}</p>}
          {shownList.length > 0 && (typing || searching) && <p className="s-empty small" style={{ padding: '4px 12px' }} data-testid="searching" role="status">Searching…</p>}
          {shownList.length === 0 && !dq && filter !== 'trash' && filter !== 'archive' && selDef && !selDef.smart && <div style={{ padding: '4px 12px' }}><button type="button" className="s-accent-btn" data-testid="empty-new-note" onClick={startDraft}><Plus size={14} strokeWidth={2.4} /> New note in {selDef.name}</button></div>}
          {shownGroups.map((g) => (<div key={g.key} className="s-grp" data-gk={g.key}>{g.label && !fSel && !gSel && <button type="button" className="s-grp-h s-grp-toggle" aria-expanded={!collapsed[`${group}:${g.key}`]} onClick={() => toggleGroup(`${group}:${g.key}`)}><ChevronDown size={14} className={`chev${collapsed[`${group}:${g.key}`] ? ' shut' : ''}`} aria-hidden="true" /><span className="nm">{g.label}</span><span className="cnt">{g.notes.length}</span></button>}{!collapsed[`${group}:${g.key}`] && g.notes.map((n) => (
            <NoteRow key={n.id} n={n} on={doc?.id === n.id} selectMode={selectMode} sel={selectMode && picked.includes(n.id)} preview={view.preview} labels={view.labels} dq={dq} fdef={n.meta?.folder ? normalDefs.find((d) => d.name === n.meta.folder) : null} sortBy={sort} hint={group === 'tag' && g.tag ? ((a) => (a.length ? `also in ${a.map((t) => `#${t}`).join(', ')}` : ''))(alsoIn(n, g.tag)) : ''} onPick={pickNote} onLeave={leaveNote} onCtx={openRowMenu} onDrag={setDragId} />
          ))}</div>))}
        </div>}
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
            <button type="button" className={filter === 'archive' ? 'on' : ''} onClick={() => { setFSel(null); setFilter(filter === 'archive' ? 'all' : 'archive'); }}><Archive size={18} strokeWidth={1.8} />Archive</button>
            <button type="button" className={filter === 'trash' ? 'on' : ''} onClick={() => { setFSel(null); setFilter(filter === 'trash' ? 'all' : 'trash'); }}><Trash2 size={18} strokeWidth={1.8} />Trash</button>
            <button type="button" onClick={() => setTagsOpen(true)}><TagIcon size={18} strokeWidth={1.8} />Tags</button>
            <button type="button" onClick={() => setGalleryOpen(true)}><PicIcon size={18} strokeWidth={1.8} />Pictures</button>
            {filter === 'trash' && shownList.length > 0 && spaceRole !== 'viewer' && <button type="button" data-testid="trash-restore-all" onClick={guarded(restoreAllTrash, 'Could not restore the Trash')}><RotateCcw size={18} strokeWidth={1.8} />Restore all</button>}
            {filter === 'trash' && canPurge && shownList.length > 0 && <button type="button" className="danger" onClick={emptyTrash}><Trash2 size={18} strokeWidth={1.8} />Empty</button>}
          </div>
        )}
        {viewOpen && <><div className="np-dim" style={{ background: 'var(--s-backdrop)' }} aria-hidden="true" /><ViewPopover view={view} setView={setView} onClose={() => setViewOpen(false)} /></>}
        {sheet === 'move' && <MoveSheet folders={normalDefs} current={selectMode ? '' : doc?.meta?.folder || ''} count={selectMode ? picked.length : 1} bare={selectMode} onMove={moveTo} onNew={() => openNew(true)} onClose={() => { leaveInbox.current = false; setSheet(null); }} />}
        {sheet === 'tag' && <TagSheet tags={tagCounts} count={picked.length} bare onApply={tagPicked} onClose={() => setSheet(null)} />}
        {sheet === 'folder' && folderEdit && <NewFolderSheet defs={allDefs} notes={allNotes} initial={folderEdit} onSave={saveFolder} onSmart={(nm) => { setSheet(null); setFolderEdit(null); setSmartPage({ startName: nm }); }} onDelete={() => deleteFolder(folderEdit)} onClose={() => { setSheet(null); setFolderEdit(null); setMoveAfter(false); }} />}
        {smartPage && <SmartFolderPage defs={allDefs} notes={allNotes} tags={tagCounts} folderNames={folders} initial={smartPage.initial} startName={smartPage.startName} onSave={saveFolder} onKind={(nm) => { setSmartPage(null); setFolderEdit({ name: nm || '' }); setSheet('folder'); }} onDelete={() => deleteFolder(smartPage.initial)} onClose={() => setSmartPage(null)} />}
        {galleryOpen && <Gallery notes={galleryNotes} onClose={() => setGalleryOpen(false)} onOpen={(id) => { setGalleryOpen(false); navigate(`/notes/${id}`); }} />}
        {tagsOpen && <TagManager onClose={() => setTagsOpen(false)} onChanged={() => refreshLists()} />}
      </aside>

      {/* ---------- editor ---------- */}
      <main className="s-note-main" aria-label="Note">
        <NoteTabs doc={doc} notes={allNotes} notesReady={sidebarOk && sidebarSpace.current === (curSpace || null)} navigate={navigate} onNew={startDraft} onDuplicate={duplicateTab} onEmpty={closeDoc} dirty={saveStatus === 'saving' || saveStatus === 'unsaved'} />
        {denied ? (
          <NoAccess owner={denied.owner} />
        ) : !doc && routeId ? (
          <EditorSkeleton />
        ) : !doc ? (
          <div className="s-note-empty">
            <h2 className="s-h2">Write something</h2>
            <p className="s-empty">Pick a note on the left, or start a new one.</p>
            <button type="button" className="s-accent-btn" onClick={startDraft}>New note</button>
          </div>
        ) : (
          <>
            <div className="ph-back"><button type="button" className="np-ib" aria-label="Back to notes" onClick={() => { forceSaveRef.current(); navigate('/notes'); }}><ChevronLeft size={18} strokeWidth={1.9} /></button><b>Notes</b></div>
            {doc?.meta?.teamShare && !doc.isDraft && <TeamNoteStrip doc={doc} />}
      {doc && !doc.isDraft && <NoteTasks doc={doc} />}
            <div className="s-note-bar s-note-head">
              <label htmlFor="s-note-title" className="s-sr">Title</label>
              <textarea
                id="s-note-title"
                className="s-note-title"
                rows={1}
                value={doc.title}
                placeholder={firstLine(doc.content) || 'Untitled note'}
                ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
                onChange={(e) => patch({ title: e.target.value.replace(/\n/g, ' ') })}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); bodyRef.current?.querySelector('[contenteditable="true"]')?.focus(); } }}
                disabled={doc.isDeleted || viewer || locked}
              />
              {!focus && renderTags()}
              <span className={`s-saved${saved.bad ? ' bad' : ''}${saveStatus === 'saving' || saved.bad || justSaved ? ' say' : ''}`} title={saved.text} data-testid="save-state">{saved.icon}<span className={saveStatus === 'saving' || saved.bad || justSaved ? '' : 's-sr'}>{saved.text}</span>{saved.bad && <button type="button" className="s-retry" data-testid="save-retry" onClick={(e) => { e.stopPropagation(); forceSave(); }}>Retry</button>}</span>
              {!doc.isDraft && <span className="s-note-stats" title={`${words} words · ${chars} characters · ${Math.max(1, Math.round(words / 200))} min read`} aria-label="Length of this note">{words} word{words === 1 ? '' : 's'}<span className="s-sr"> · {chars} characters · {Math.max(1, Math.round(words / 200))} min read</span></span>}
              {crumb && <span className="s-crumb" title="Where this note lives">{crumb}</span>}
              {!doc.isDraft && !focus && <ShareChips noteId={doc.id} />}
              {!doc.isDraft && !focus && doc.access && !doc.team && <AccessChip note={doc} />}
              {!doc.isDraft && !focus && doc.team && <TeamNoteByline doc={doc} me={wsData?.me?.id} />}
              <span className="grow" />
              {!doc.isDeleted && !doc.isDraft && !viewer && <button type="button" className={`s-outline round s-ico s-fav${doc.meta?.favourite ? ' on' : ''}`} data-testid="fav-btn" aria-pressed={!!doc.meta?.favourite} aria-label={doc.meta?.favourite ? 'Remove from favourites' : 'Add to favourites'} title={doc.meta?.favourite ? 'Remove from favourites' : 'Add to favourites'} onClick={guarded(toggleFav, 'Could not change the favourite')}><Star size={15} /></button>}
              {doc.isDeleted ? (
                <button type="button" className="s-outline" onClick={guarded(restore, 'Could not restore the note')}>Restore</button>
              ) : (
                <button type="button" className="s-outline round s-ico" data-testid="read-mode" onClick={() => setPreview((v) => !v)} aria-pressed={preview} aria-label={preview ? 'Edit' : 'Read mode'} title={preview ? 'Back to editing' : 'Read mode: hide the editing tools'}>{preview ? <Pencil size={15} /> : <Eye size={15} />}</button>
              )}
              <button type="button" className="s-outline round s-ico" onClick={() => setFocus((v) => !v)} aria-pressed={focus} aria-label={focus ? 'Exit full screen' : 'Full screen'} title={focus ? 'Exit full screen (Esc)' : 'Full screen (Ctrl+Shift+F)'}>
                {focus ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
              <div className="s-menu-wrap" ref={outsideMenu}>
                <button type="button" className="s-outline round" aria-label="More" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}><MoreHorizontal size={18} /></button>
                {menuOpen && doc.isDraft && (
                  <div className="s-menu" role="menu">
                    <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setSelectMode(false); setSheet('move'); }}><FolderInput size={15} />{doc.meta?.folder ? `Folder: ${doc.meta.folder}…` : 'Move to folder…'}</button>
                    <SegRow label="Text size" icon={<Type size={15} />} testid="seg-size" value={noteFont} options={[['s', 'S', 'Small text'], ['m', 'M', 'Medium text'], ['l', 'L', 'Large text']]} onPick={pickFont} />
                    <SegRow label="Page width" icon={<MoveHorizontal size={15} />} testid="seg-width" value={wide === 'narrow' ? 'narrow' : 'wide'} options={[['narrow', 'Narrow'], ['wide', 'Wide']]} onPick={(n) => { setWide(n); keep('peblo-focus-width', n); }} />
                    <button type="button" role="menuitem" onClick={() => { const n = typewriter === 'on' ? 'off' : 'on'; setTypewriter(n); keep('peblo-typewriter', n); }}><Keyboard size={15} />Typewriter focus: {typewriter === 'on' ? 'On' : 'Off'}</button>
                  </div>
                )}
                {menuOpen && !doc.isDraft && (
                  <div className="s-menu" role="menu">
                    {renderMenuItems()}
                  </div>
                )}
              </div>
            </div>

            <FocusChrome active={focus} prefs={fsp} set={setFsp} title={doc.title} saveStatus={saveStatus} words={words} docKey={doc.id} getScroller={getFsScroller}
              outline={outline.map((h) => ({ ...h, pips: (sec[h.text] || []).map((p) => ({ id: p.id, name: p.name, color: peerColor(p.id) })) }))} onJump={jump}
              onExit={() => { setFocus(false); }}
              barItems={[
                { id: 'tag', label: 'Tag', node: renderTags() },
                ...(fsParts ? [{ id: 'shared', label: 'Shared link and access', node: fsParts.shared }, { id: 'copy', label: 'Copy link', node: fsParts.copy }] : []),
                { id: 'cursors', label: 'Live cursors', node: <button type="button" className={`fsx-ic${cursorsOn ? ' on acc' : ''}`} data-testid="focus-cursors" aria-pressed={cursorsOn} aria-label="Live cursors" title="Show other people's cursors and selections" onClick={() => setCursors(!cursorsOn)}><MousePointer2 size={16} /></button> },
                ...(fsParts ? [{ id: 'live', label: 'Who is here', node: fsParts.live }] : []),
              ]}
              noteNode={renderMenuItems()}
              shareNode={<>{fsParts ? fsParts.full : <p className="fsx-muted">This note is not shared yet.</p>}{shareOk.allowed ? <button type="button" className="fsx-wide" data-testid="fs-share-open" onClick={() => setShareOpen(true)}><Share2 size={15} />Share link</button> : <ShareBlocked reason={shareOk.reason} className="fsx-muted" />}</>}
              onQuickTask={quickTask} />
            <div className="ph-chips" role="group" aria-label="About this note">
              <button type="button" onClick={() => setPhRail('ask')}><Sparkles size={14} strokeWidth={2} />Ask</button>
              <button type="button" onClick={() => setPhRail('tasks')}>Tasks {linked.length}</button>
              <button type="button" onClick={() => setPhRail('ment')}>Mentioned {mentions.length}</button>
              {noteId && <button type="button" onClick={() => { setPhRail('ver'); setHistoryOpen(true); }}><History size={14} strokeWidth={2} />Versions</button>}
            </div>
            <div className="s-note-body" ref={bodyRef} data-font={noteFont}>
              <BlockEditor
          mentions={false}
                noteId={doc.id}
                key={editorKey}
                initialContent={doc.content}
                onChange={(md) => patch({ content: md })}
                editable={!preview && !doc.isDeleted && !viewer && !locked}
                focusMode={typewriter === 'on' || (focus && fsp.para)}
                typewriter={typewriter === 'on' || (focus && fsp.type)}
                formattingToolbar
              />
            </div>
          </>
        )}
        {toast && <Toast><div className="s-toast" role="status">{toast}{toastAct && <button type="button" className="s-toast-act" data-testid="toast-undo" onClick={() => { const a = toastAct; setToast(''); setToastAct(null); Promise.resolve().then(a.run).catch(() => flash('Could not undo')); }}>{toastAct.label}</button>}</div></Toast>}
      </main>

      {/* ---------- helpers ---------- */}
      <aside className={`s-note-side${phRail ? ' open' : ''}`} data-rail={phRail || ''} aria-label="About this note">
        <button type="button" className="ph-close" aria-label="Close" onClick={() => setPhRail(null)}><X size={16} strokeWidth={2.2} /></button>
        <NoteAskPanel noteId={noteId} noteTitle={doc?.title} beforeAsk={() => forceSaveRef.current()} onOpenFull={ask} />

        <section className={`s-side-card rl-tasks${!phone && !linked.length && !railOpen.tasks ? ' min' : ''}`} style={{ background: 'var(--s-peach)' }} aria-labelledby="s-linked" onClick={(e) => { if (e.currentTarget.classList.contains('min')) setRailOpen((o) => ({ ...o, tasks: true })); }}>
          <h3 id="s-linked" className="s-h3">Linked tasks <span className="s-cnt">{linked.length}</span></h3>
          {linked.length === 0 && <p className="s-empty small">Add a task below, link one you already have, or select text and press Make a task.</p>}
          {(allLinked ? linked : linked.slice(0, 8)).map((t) => (
            <div key={t.id} className="s-linked-row">
              <label className={`s-side-task${t.completed ? ' done' : ''}`}>
                <input type="checkbox" className="s-check small" checked={!!t.completed} onChange={() => toggleTask(t)} />
                <button type="button" className="t s-linked-open" onClick={(e) => { e.preventDefault(); setSheetTask({ ...t, note: { id: doc.id, title: doc.title } }); }}>{t.text}</button>
                {timeOf(t) && <span className={`time${t.priority === 'high' ? ' hot' : ''}`}>{timeOf(t)}</span>}
              </label>
              <button type="button" className="s-unlink" aria-label={`Unlink ${t.text}`} title="Unlink" onClick={guarded(() => unlinkTask(t), 'Could not unlink the task')}><X size={12} /></button>
            </div>
          ))}
          {linked.length > 8 && <button type="button" className="s-more" data-testid="linked-more" onClick={() => setAllLinked((v) => !v)}>{allLinked ? 'Show fewer' : `Show all ${linked.length}`}</button>}
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
                  onLink={(id) => { guarded(linkTask, 'Could not link the task')(id); setLinkOpen(false); }}
                  onCreate={async (text) => { try { await todosAPI.create({ text, priority: 'medium', noteId }); queryClient.invalidateQueries({ queryKey: ['todos'] }); setLinkOpen(false); } catch { flash('Could not add the task'); } }}
                  onClose={() => setLinkOpen(false)}
                />
              )}
            </div>
          )}
          {sheetTask && <TaskSheet task={sheetTask} onClose={() => setSheetTask(null)} />}
        </section>

        <section className={`s-side-card rl-ment${!phone && !mentions.length && !railOpen.ment ? ' min' : ''}`} style={{ background: 'var(--s-mint)' }} aria-labelledby="s-mentions" onClick={(e) => { if (e.currentTarget.classList.contains('min')) setRailOpen((o) => ({ ...o, ment: true })); }}>
          <h3 id="s-mentions" className="s-h3">Mentioned in</h3>
          {mentions.length === 0 && <p className="s-empty small">{(doc?.title || '').trim().length < 4 ? 'Give the note a title to see where it is mentioned.' : 'No other note mentions this one yet.'}</p>}
          {mentions.map((n) => <Link key={n.id} to={`/notes/${n.id}`} className="s-side-link">{n.title || 'Untitled'}</Link>)}
        </section>

        {noteId && (
          <div className="s-menu-wrap rl-ver" ref={outsideHist}>
            <button type="button" className="s-versions" onClick={() => setHistoryOpen((v) => !v)} aria-expanded={historyOpen}>
              <History size={15} strokeWidth={2.2} /> {vErrText || (versions.length ? `${versions.length} version${versions.length === 1 ? '' : 's'} kept` : 'No earlier versions')}
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
