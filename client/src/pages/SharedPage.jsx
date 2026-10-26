import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { ArrowUp, Check, ChevronRight, Clipboard, Clock, List, Users, Download, Eye, FileText, Link2, LoaderCircle, Moon, MoreHorizontal, PanelLeftClose, PanelLeftOpen, PanelRight, Bookmark, History, Maximize2, Minimize2, Keyboard, Wrench, Pencil, Printer, Sun, Type, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { notesAPI, publicShareAPI, todosAPI } from '../api';
import { authHeaders } from '../api/token';
import { exportDocs } from '../utils/exporters';
import { caretSelection, headingIndexes, peerColor, scrollToPeerBlock, showPeers } from '../utils/peerCursors';
import { CollabBar, CollabPanel, useCollabEvents } from '../components/CollabPanel';
import useShareReader from './useShareReader';
import './shared-page.css';

const BlockEditor = lazy(() => import('../components/BlockEditor'));

const toHtml = (md) => {
  let html = marked.parse(md || '');
  html = html.replace(/<figure>\s*<img src="(data:(video|audio)\/[^\"]+)">\s*(?:<figcaption>([\s\S]*?)<\/figcaption>)?\s*<\/figure>/g, (_m, src, kind, cap) => `<figure><${kind} controls src="${src}"></${kind}>${cap ? `<figcaption>${cap}</figcaption>` : ''}</figure>`);
  html = html.replace(/<figure>\s*<img src="(data:(?!image\/)[^\"]+)">\s*(?:<figcaption>([\s\S]*?)<\/figcaption>)?\s*<\/figure>/g, (_m, src, cap) => `<p><a href="${src}" download="${(cap || 'file').replace(/"/g, '')}">${cap || 'Download file'}</a></p>`);
  const safe = DOMPurify.sanitize(html, { ADD_TAGS: ['video', 'audio'], ADD_ATTR: ['controls', 'download'] });
  const parsed = new DOMParser().parseFromString(safe, 'text/html');
  const ids = new Map();
  parsed.body.querySelectorAll('h1, h2, h3').forEach((heading) => {
    const base = heading.textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
    const count = ids.get(base) || 0;
    ids.set(base, count + 1);
    heading.id = count ? `${base}-${count + 1}` : base;
  });
  return parsed.body.innerHTML;
};

const when = (value) => (value ? new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const initials = (name = '') => name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || 'P';

// a note often starts with a heading that repeats its title; the page already shows the title large
function withoutTitleHeading(html, title) {
  if (!html || !title) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const first = doc.body.firstElementChild;
  if (first && /^H[12]$/.test(first.tagName) && first.textContent.trim().toLowerCase() === title.trim().toLowerCase()) { first.remove(); return doc.body.innerHTML; }
  return html;
}
// a title that wraps instead of being cut off at the edge of the card
function fitTitle(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export default function SharedPage() {
  const { kind, token } = useParams();
  const navigate = useNavigate();
  const { user, signIn } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('saved');
  const [conflict, setConflict] = useState(null);
  const [rev, setRev] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [scrollProgress, setScrollProgress] = useState(0);
  const [exporting, setExporting] = useState('');
  const [activeHeading, setActiveHeading] = useState('');
  const [darkMode, setDarkMode] = useState(() => document.documentElement.classList.contains('theme-dark'));
  const [previewMode, setPreviewMode] = useState(false);
  const [viewers, setViewers] = useState([]);
  const [panelOpen, setPanelOpen] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 1200px)').matches);
  const [sectionPeers, setSectionPeers] = useState({});
  const [offline, setOffline] = useState(false);
  const [synced, setSynced] = useState(false);
  const [now, setNow] = useState(Date.now());
  const sessionIdRef = useRef(null);
  const missed = useRef(0);
  const [isOwner, setIsOwner] = useState(false);
  const [shareOff, setShareOff] = useState(false);
  const [revokeConfirm, setRevokeConfirm] = useState(false);
  const [savedCopy, setSavedCopy] = useState(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const draft = useRef({ title: '', content: '', base: null });
  const typedAt = useRef(0);
  const cursorRef = useRef(null);
  const selRef = useRef(null);
  const [guestName, setGuestName] = useState(() => { try { return localStorage.getItem('peblo-guest-name') || ''; } catch { return ''; } });
  const nameRef = useRef(guestName);
  nameRef.current = guestName;
  const saveGuestName = (value) => {
    const clean = value.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
    setGuestName(clean);
    try { if (clean) localStorage.setItem('peblo-guest-name', clean); else localStorage.removeItem('peblo-guest-name'); } catch { /* the name just is not remembered */ }
    if (clean) { markJoined(); window.dispatchEvent(new CustomEvent('pb-identity', { detail: { name: clean } })); }
  };
  // how I show up for the others: a colour next to the name (kept in this browser, applied live)
  const GUEST_COLORS = ['#e11d48', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#db2777'];
  const [guestColor, setGuestColor] = useState(() => { try { return localStorage.getItem('peblo-guest-color') || ''; } catch { return ''; } });
  const colorRef = useRef(guestColor);
  colorRef.current = guestColor;
  const [joined, setJoined] = useState(() => { try { return localStorage.getItem('peblo-guest-joined') === '1' || !!localStorage.getItem('peblo-guest-name'); } catch { return false; } });
  const markJoined = () => { setJoined(true); try { localStorage.setItem('peblo-guest-joined', '1'); } catch { /* not remembered */ } };
  const pickColor = (color) => {
    setGuestColor(color); markJoined();
    try { localStorage.setItem('peblo-guest-color', color); } catch { /* not remembered */ }
    window.dispatchEvent(new CustomEvent('pb-identity', { detail: { color } }));
  };
  const [tocSheet, setTocSheet] = useState(false);
  const taskSavedText = useRef(null);
  const timer = useRef(null);
  const toastTimer = useRef(null);
  const menuRef = useRef(null);
  // how this person likes to read the page (kept in this browser only)
  const [tocOpen, setTocOpen] = useState(() => { try { return localStorage.getItem('peblo-share-toc') !== 'closed'; } catch { return true; } });
  const [look, setLook] = useState(() => { try { return { size: 'm', width: 'normal', font: 'sans', pointers: true, quiet: false, pin: false, ...(JSON.parse(localStorage.getItem('peblo-share-look') || '{}')) }; } catch { return { size: 'm', width: 'normal', font: 'sans', pointers: true, quiet: false, pin: false }; } });
  const [lookOpen, setLookOpen] = useState(false);
  const lookRef = useRef(null);
  const toggleToc = () => setTocOpen((open) => { const next = !open; try { localStorage.setItem('peblo-share-toc', next ? 'open' : 'closed'); } catch { /* not remembered */ } return next; });
  const setLookPref = (patch) => setLook((cur) => {
    const next = { ...cur, ...patch };
    try { localStorage.setItem('peblo-share-look', JSON.stringify(next)); if ('pointers' in patch) { localStorage.setItem('peblo-pointers', next.pointers ? 'on' : 'off'); window.dispatchEvent(new Event('pb-pointers-pref')); } } catch { /* not remembered */ }
    return next;
  });
  useEffect(() => {
    if (!lookOpen) return undefined;
    const out = (event) => { if (!lookRef.current?.contains(event.target)) setLookOpen(false); };
    const esc = (event) => { if (event.key === 'Escape') setLookOpen(false); };
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc); };
  }, [lookOpen]);
  const articleRef = useRef(null);
  // full screen, hidden tool bar, tucked-away top bar, shortcuts
  const [fullscreen, setFullscreen] = useState(false);
  const [barShown, setBarShown] = useState(false);
  const [topHidden, setTopHidden] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const rootRef = useRef(null);
  const barTimer = useRef(null);
  const toggleFullscreen = useCallback(() => {
    setFullscreen((on) => {
      const next = !on;
      try {
        if (next && rootRef.current?.requestFullscreen && !document.fullscreenElement) rootRef.current.requestFullscreen().catch(() => {});
        if (!next && document.fullscreenElement) document.exitFullscreen().catch(() => {});
      } catch { /* the page still goes full screen without the browser API */ }
      return next;
    });
  }, []);
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) setFullscreen(false); };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const showBar = () => { clearTimeout(barTimer.current); setBarShown(true); };
  const hideBarSoon = () => { clearTimeout(barTimer.current); barTimer.current = setTimeout(() => setBarShown(false), 1400); };
  useEffect(() => () => clearTimeout(barTimer.current), []);
  useEffect(() => {
    const onKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'Escape') { setKeysOpen(false); setBarShown(false); if (fullscreen) toggleFullscreen(); return; }
      const t = event.target;
      if (t?.closest?.('input, textarea, select, [contenteditable="true"], .bn-editor')) return;
      if (event.key === '[') { event.preventDefault(); toggleToc(); }
      else if (event.key === ']') { event.preventDefault(); setPanelOpen((o) => !o); }
      else if (event.key === '/') { event.preventDefault(); setBarShown((o) => !o); }
      else if (event.key === '?') { event.preventDefault(); setKeysOpen((o) => !o); }
      else if (event.key === 'f' || event.key === 'F') { event.preventDefault(); toggleFullscreen(); }
      else if (event.key === '\\') { event.preventDefault(); toggleToc(); setPanelOpen((o) => !o); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fullscreen, toggleFullscreen]);
  const shareStateRef = useRef({ data, status });
  shareStateRef.current = { data, status };
  const kindPath = kind === 'task' || kind === 'todo' ? 'todo' : 'note';
  const url = `/api/public/${kindPath}/${encodeURIComponent(token)}`;

  useLayoutEffect(() => {
    document.documentElement.classList.add('pb-public-share');
    const root = document.getElementById('root');
    const sharedPage = root?.querySelector('.pb-shared');
    const html = document.documentElement;
    const previousRootZoom = root?.style.zoom || '';
    const previousRootWidth = root?.style.width || '';
    const previousRootHeight = root?.style.height || '';
    let baselineDpr = window.devicePixelRatio || 1;
    try {
      const saved = Number(localStorage.getItem('peblo-share-base-dpr'));
      if (saved > 0) baselineDpr = saved;
      else localStorage.setItem('peblo-share-base-dpr', String(baselineDpr));
    } catch { /* Keep the current zoom as the baseline when storage is unavailable. */ }
    const syncCanvasScale = () => {
      const currentDpr = window.devicePixelRatio || baselineDpr;
      const viewportRatio = currentDpr / baselineDpr;
      html.style.setProperty('--pb-canvas-w', `min(2160px, calc(100vw * ${viewportRatio}))`);
      html.style.setProperty('--pb-canvas-h', `calc(100dvh * ${viewportRatio})`);
      if (root) {
        root.style.removeProperty('zoom');
        root.style.width = '100vw';
        root.style.height = '100dvh';
      }
      if (sharedPage) sharedPage.style.zoom = String(1 / viewportRatio);
    };
    syncCanvasScale();
    window.addEventListener('resize', syncCanvasScale);
    return () => {
      window.removeEventListener('resize', syncCanvasScale);
      if (root) {
        root.style.zoom = previousRootZoom;
        root.style.width = previousRootWidth;
        root.style.height = previousRootHeight;
      }
      sharedPage?.style.removeProperty('zoom');
      html.style.removeProperty('--pb-canvas-w');
      html.style.removeProperty('--pb-canvas-h');
      html.classList.remove('pb-public-share');
    };
  }, []);

  useEffect(() => {
    let live = true;
    fetch(url)
      .then(async (response) => { const json = await response.json().catch(() => ({})); if (!response.ok) throw new Error(json.error || 'This link is not shared any more.'); return json; })
      .then((json) => {
        if (!live) return;
        draft.current = { title: json.title || '', content: json.content || '', base: json.updatedAt, baseContent: json.content || '' };
        if (json.kind === 'todo') taskSavedText.current = json.text;
        setConflict(null); setStatus('saved'); setData(json);
      })
      .catch((cause) => { if (live) setError(cause.message); });
    return () => { live = false; };
  }, [url, rev]);

  useEffect(() => {
    if (!data || shareOff) return undefined;
    let live = true;
    const refresh = async () => {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!live) return;
        if (response.status === 404) {
          setData(null);
          setShareOff(true);
          setError('This share link expired or was turned off. Ask the owner for a new link.');
          return;
        }
        if (!response.ok) return;
        if (collabState.current !== 'off') return; // the live room keeps this editor current
        const latest = await response.json();
        const current = shareStateRef.current;
        if (!live || latest.updatedAt === current.data?.updatedAt || current.status !== 'saved') return;
        // someone else saved and this editor has nothing unsaved: show their version (a pending local edit is merged by the server on save)
        if (timer.current) return;
        draft.current = { title: latest.title || '', content: latest.content || '', base: latest.updatedAt, baseContent: latest.content || '' };
        setData(latest);
        setRev((n) => n + 1);
      } catch { /* Keep the current page visible during a brief connection loss. */ }
    };
    const interval = window.setInterval(() => { void refresh(); }, 5000);
    return () => { live = false; window.clearInterval(interval); };
  }, [data?.kind, shareOff, url]);

  const put = useCallback(async (payload) => {
    const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }, [url]);

  // Live co-editing: while the editor is in a live room, the room (not this page) merges what other people typed.
  const collabState = useRef('off'); // 'off' | 'wait' | 'live'
  const [collabOff, setCollabOff] = useState(false);
  useEffect(() => {
    const on = (e) => { if (e.detail?.share === token && e.detail.code === 4002) setRev((n) => n + 1); }; // the owner changed the note some other way: reload it
    window.addEventListener('pb-collab-closed', on);
    return () => window.removeEventListener('pb-collab-closed', on);
  }, [token]);

  const saving = useRef(false);
  const again = useRef(false);
  const saveNote = useCallback(async (force = false, keepBoth = false) => {
    timer.current = null;
    // one save at a time: edits made while a save is in flight go out right after it
    if (saving.current) { again.current = true; return; }
    // the live room is opening or reopening: wait for it, so this save is in step with it
    for (let i = 0; i < 130 && collabState.current === 'wait'; i++) await new Promise((r) => setTimeout(r, 150));
    saving.current = true;
    setStatus('saving');
    const sent = { title: draft.current.title, content: draft.current.content };
    try {
      const response = await put({ ...sent, sessionId: sessionIdRef.current || undefined, name: nameRef.current || undefined, baseUpdatedAt: draft.current.base, baseContent: draft.current.baseContent, force, keepBoth, ...(collabState.current === 'live' ? { collab: true } : {}) });
      if (response.status === 409) { setConflict(response.body.latest); setStatus('conflict'); return; }
      if (response.status === 404 || response.status === 403) { setError(response.body.error || 'This link is not available.'); return; }
      if (response.status !== 200) throw new Error(response.body.error || 'Could not save.');
      const typedMore = draft.current.content !== sent.content;
      if (response.body.status && response.body.status !== 'saved' && typeof response.body.content === 'string') {
        // the other person's edits were merged with ours: show the combined text
        if (!typedMore) {
          draft.current = { ...draft.current, content: response.body.content, base: response.body.updatedAt, baseContent: response.body.content };
          setData((current) => current ? { ...current, title: draft.current.title, content: response.body.content, updatedAt: response.body.updatedAt } : current);
          setRev((n) => n + 1);
          showToast(response.body.status === 'clash' ? 'Both versions were kept. Tidy up the part you do not need.' : 'Merged with changes made by someone else');
        } // else: keep the old base so the next save merges again; the poll shows the merged text afterwards
      } else {
        draft.current.base = response.body.updatedAt;
        draft.current.baseContent = sent.content;
        setData((current) => current ? { ...current, title: sent.title, content: sent.content, updatedAt: response.body.updatedAt } : current);
      }
      setConflict(null); setStatus(typedMore ? 'saving' : 'saved');
    } catch { setStatus('error'); }
    finally {
      saving.current = false;
      if (again.current) { again.current = false; clearTimeout(timer.current); timer.current = setTimeout(() => saveNote(false), 300); }
    }
  }, [put]);
  const queueSave = () => { setStatus((current) => current === 'saving' ? current : 'saving'); clearTimeout(timer.current); timer.current = setTimeout(() => saveNote(false), 1200); };
  useEffect(() => () => clearTimeout(timer.current), []);

  const patchTask = async (patch) => {
    setStatus('saving');
    try {
      const response = await put(patch);
      if (response.status === 200) { if (patch.text !== undefined) taskSavedText.current = patch.text; setData((current) => ({ ...current, ...patch, updatedAt: response.body.updatedAt })); setStatus('saved'); }
      else if (response.status === 404) { setData(null); setShareOff(true); setError(response.body.error || 'This share link is no longer available.'); }
      else { setStatus(response.status === 409 ? 'conflict' : 'error'); }
    } catch { setStatus('error'); }
  };

  const body = useMemo(() => {
    const html = data?.kind === 'note' ? toHtml(data.content) : data?.note ? toHtml(data.note.content) : '';
    return data?.kind === 'note' ? withoutTitleHeading(html, data.title) : html;
  }, [data]);
  // the title is shown big at the top, so a first heading that says the same thing is hidden (still there for the editor)
  useEffect(() => {
    if (data?.kind !== 'note') return undefined;
    const mark = () => {
      const first = document.querySelector('.pb-shared .bn-editor .bn-block-outer');
      if (!first) return;
      const h = first.querySelector('.bn-block-content[data-content-type="heading"]');
      const same = !!h && !!data.title && h.textContent.trim().toLowerCase() === data.title.trim().toLowerCase();
      const box = first.closest('.block-editor-container');
      if (box) { if (same) box.setAttribute('data-dup-title', '1'); else box.removeAttribute('data-dup-title'); }
    };
    mark();
    const timer = window.setInterval(mark, 700);
    return () => window.clearInterval(timer);
  }, [data?.kind, data?.title, rev]);
  const headings = useMemo(() => {
    if (!body) return [];
    const parsed = new DOMParser().parseFromString(body, 'text/html');
    return [...parsed.body.querySelectorAll('h2, h3')].map((heading) => ({ id: heading.id, title: heading.textContent.trim(), level: Number(heading.tagName.slice(1)) }));
  }, [body]);
  const scrollToHeading = useCallback((id, behavior = 'smooth') => {
    const article = articleRef.current;
    if (!article) return;
    let target = document.getElementById(id);
    if (!target || !article.contains(target)) {
      const ids = new Map();
      for (const heading of article.querySelectorAll('h1, h2, h3')) {
        const base = heading.textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
        const count = ids.get(base) || 0;
        ids.set(base, count + 1);
        const headingId = count ? `${base}-${count + 1}` : base;
        if (headingId === id) {
          heading.id = id;
          target = heading;
          break;
        }
      }
    }
    if (!target || !article.contains(target)) return;
    // Keep section navigation inside the shared-page article scroller. Calling
    // scrollIntoView can also move the document/root, hiding the fixed toolbar.
    const articleRect = article.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const topInset = 16;
    article.scrollTo({
      top: article.scrollTop + targetRect.top - articleRect.top - topInset,
      behavior,
    });
    setActiveHeading(id);
  }, []);
  const wordCount = useMemo(() => {
    if (!body) return 0;
    const parsed = new DOMParser().parseFromString(body, 'text/html');
    return parsed.body.textContent.trim().split(/\s+/).filter(Boolean).length;
  }, [body]);
  const pageTitle = data?.kind === 'todo' ? data.text : data?.title || 'Untitled';
  const statusText = status === 'saving' ? 'Saving…' : status === 'conflict' ? 'Not saved: someone else changed it' : status === 'error' ? 'Could not save' : 'Saved';

  useEffect(() => {
    let live = true;
    setIsOwner(false);
    if (!user || !data) return () => { live = false; };
    publicShareAPI.owner(kindPath, token)
      .then((response) => { if (live) setIsOwner(!!response.data?.isOwner); })
      .catch(() => { if (live) setIsOwner(false); });
    return () => { live = false; };
  }, [user?.id, data?.kind, kindPath, token]);

  useEffect(() => {
    setSavedCopy(null);
    if (!user?.id || !data) return;
    try {
      const stored = JSON.parse(localStorage.getItem(`peblo-share-copy:${user.id}:${kindPath}:${token}`) || 'null');
      if (stored?.kind === data.kind && typeof stored.id === 'string') setSavedCopy(stored);
    } catch { /* Storage may be unavailable in private browsing. */ }
  }, [user?.id, data?.kind, kindPath, token]);

  useEffect(() => {
    if (!data || shareOff) { setViewers([]); return undefined; }
    const sessionKey = `peblo-share-viewer:${kindPath}:${token}`;
    let sessionId;
    try {
      sessionId = sessionStorage.getItem(sessionKey);
      if (!sessionId) {
        sessionId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        sessionStorage.setItem(sessionKey, sessionId);
      }
    } catch { sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
    sessionIdRef.current = sessionId;
    const presenceUrl = `/api/public/${kindPath}/${encodeURIComponent(token)}/presence`;
    let live = true;
    const beat = (active = true, keepalive = false) => fetch(presenceUrl, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ sessionId, active, typing: active && Date.now() - typedAt.current < 3000, name: nameRef.current || undefined, cursor: cursorRef.current ?? undefined, selStart: selRef.current?.start, selEnd: selRef.current?.end }),
      keepalive,
    }).then((response) => {
      if (response.status === 404 && live) {
        setData(null);
        setViewers([]);
        setShareOff(true);
        setError('This share link expired or was turned off. Ask the owner for a new link.');
        return null;
      }
      if (response.status === 403 && live) {
        // the owner took this person off the link
        setData(null);
        setViewers([]);
        setError('The owner removed you from this page.');
        return null;
      }
      if (!response.ok) throw new Error('presence');
      return response.json();
    })
      .then((json) => {
        if (!live || !json?.viewers) return;
        if (missed.current >= 2) { setSynced(true); window.setTimeout(() => setSynced(false), 4000); }
        missed.current = 0;
        setOffline(false);
        setViewers(json.viewers);
      })
      .catch(() => { missed.current += 1; if (live && missed.current >= 2) setOffline(true); });
    void beat();
    // an editable link checks every 3 s so "someone is typing" feels live; a read-only link only needs to be counted
    const interval = window.setInterval(() => { void beat(); }, data?.canEdit ? 3000 : 12_000);
    const leave = () => { void beat(false, true); };
    window.addEventListener('pagehide', leave);
    return () => {
      live = false;
      window.clearInterval(interval);
      window.removeEventListener('pagehide', leave);
      void beat(false, true);
    };
  }, [data?.kind, data?.canEdit, kindPath, token, user?.id, shareOff]);

  // where my cursor is (reported to others) and where theirs are (marked in the text)
  useEffect(() => {
    const onSel = () => { const s = caretSelection(); if (s) { cursorRef.current = s.block; selRef.current = s; } };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);
  useEffect(() => {
    const peers = viewers.filter((v) => !v.self);
    const draw = () => {
      showPeers(previewMode ? [] : peers);
      // which section of the outline each person is in
      const hi = headingIndexes();
      const next = {};
      if (hi.length && headings.length) {
        for (const peer of peers) {
          if (peer.cursor == null) continue;
          // the last outline heading at or above the person's block
          let hit = null;
          for (const h of hi) { if (h.index <= peer.cursor && headings.some((x) => x.title === h.text)) hit = h; }
          const target = hit && headings.find((x) => x.title === hit.text);
          if (target) (next[target.id] ||= []).push({ id: peer.id, name: peer.name });
        }
      }
      setSectionPeers((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    draw();
    const t = window.setInterval(draw, 1000); // the editor may redraw its blocks; mark them again
    return () => { window.clearInterval(t); showPeers([]); };
  }, [viewers, previewMode, rev, headings]);


  // Follow: keep the view on another person until you scroll, press Escape, or they leave
  const [followId, setFollowId] = useState(null);
  const followBlock = useRef(null);
  useEffect(() => {
    if (!followId) { followBlock.current = null; return undefined; }
    const who = viewers.find((v) => v.id === followId && !v.self);
    if (!who) { setFollowId(null); return undefined; }
    if (who.cursor != null && who.cursor !== followBlock.current) { followBlock.current = who.cursor; scrollToPeerBlock(who.cursor); }
    return undefined;
  }, [followId, viewers]);
  useEffect(() => {
    if (!followId) return undefined;
    const stop = () => setFollowId(null);
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); stop(); } }; // stop following without also closing the panel
    const scroller = document;
    scroller.addEventListener('wheel', stop, { passive: true });
    scroller.addEventListener('touchmove', stop, { passive: true });
    document.addEventListener('keydown', onKey, true);
    return () => { scroller.removeEventListener('wheel', stop); scroller.removeEventListener('touchmove', stop); document.removeEventListener('keydown', onKey, true); };
  }, [followId]);
  const collab = useCollabEvents(viewers, !!data && !shareOff);
  const recentEvents = collab.muted ? [] : collab.events.filter((e) => (e.kind === 'joined' || e.kind === 'left') && now - e.at < 5000).slice(0, 2);
  useEffect(() => {
    if (!recentEvents.length) return undefined;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [recentEvents.length]);
  const others = viewers.filter((viewer) => !viewer.self);
  const typers = others.filter((viewer) => viewer.typing);
  const typingText = typers.length === 1 ? `${typers[0].name}${typers[0].owner ? ' (owner)' : ''} is typing`
    : typers.length === 2 ? `${typers[0].name} and ${typers[1].name} are typing`
      : typers.length > 2 ? `${typers.length} people are typing` : '';

  const showToast = (message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  };
  const copy = async (text, message = 'Copied to clipboard') => {
    try { await navigator.clipboard.writeText(text); showToast(message); }
    catch { showToast('Clipboard access is unavailable in this browser'); }
    setMenuOpen(false);
  };
  const exportShared = async (format) => {
    if (!data || exporting) return;
    const note = data.kind === 'todo'
      ? { title: data.text, content: `## Task\n\n- [${data.completed ? 'x' : ' '}] ${data.text}\n\n${data.note?.content || ''}`, tags: data.tags }
      : { title: data.title || 'Untitled', content: data.content || '', tags: data.tags };
    const labels = { md: 'Markdown', pdf: 'PDF', doc: 'Word document', html: 'HTML', txt: 'plain text' };
    setMenuOpen(false);
    setExporting(format);
    showToast(format === 'pdf' ? 'Preparing PDF…' : `Preparing ${labels[format]}…`);
    try {
      await exportDocs([note], format, pageTitle);
      showToast(`${labels[format]} downloaded`);
    } catch (cause) {
      showToast(cause.message || `Could not download ${labels[format]}`);
    } finally {
      setExporting('');
    }
  };

  const rememberSavedCopy = (account, copy) => {
    setSavedCopy(copy);
    try { localStorage.setItem(`peblo-share-copy:${account.id}:${kindPath}:${token}`, JSON.stringify(copy)); } catch { /* Keep the current-session action available. */ }
  };

  const saveSharedCopy = async (account = user) => {
    if (!account) { setAuthError(''); setAuthOpen(true); return; }
    if (!data || saveBusy || savedCopy) return;
    setSaveBusy(true);
    let copiedNoteId = null;
    let copiedTaskId = null;
    try {
      if (data.kind === 'note') {
        const response = await notesAPI.create({
          title: draft.current.title || data.title || 'Untitled',
          content: draft.current.content ?? data.content ?? '',
        });
        const id = response.data.note.id;
        rememberSavedCopy(account, { kind: 'note', id });
      } else {
        let noteId = null;
        if (data.note) {
          const noteResponse = await notesAPI.create({ title: data.note.title || 'Untitled', content: data.note.content || '' });
          copiedNoteId = noteResponse.data.note.id;
          noteId = copiedNoteId;
        }
        const response = await todosAPI.create({
          text: data.text,
          priority: data.priority,
          deadline: data.deadline || undefined,
          tags: data.tags || [],
          noteId,
        });
        copiedTaskId = response.data.todo.id;
        if (data.completed) await todosAPI.update(copiedTaskId, { completed: true });
        rememberSavedCopy(account, { kind: 'todo', id: copiedTaskId });
      }
      setAuthOpen(false);
      setMenuOpen(false);
      showToast('Saved a copy to your Peblo');
    } catch (cause) {
      if (copiedTaskId) await todosAPI.delete(copiedTaskId).catch(() => {});
      if (copiedNoteId) await notesAPI.delete(copiedNoteId).catch(() => {});
      setAuthError(cause.response?.data?.error || 'Could not save this copy. Please try again.');
      showToast('Could not save this copy');
    } finally {
      setSaveBusy(false);
    }
  };

  const submitAuthAndSave = async (event) => {
    event.preventDefault();
    setAuthError('');
    setAuthBusy(true);
    try {
      const details = authMode === 'signup'
        ? { name: authName.trim(), email: authEmail.trim(), password: authPassword }
        : { email: authEmail.trim(), password: authPassword };
      const account = await signIn(authMode, details);
      await saveSharedCopy(account);
    } catch (cause) {
      setAuthError(cause.response?.data?.error || (cause.response ? 'Could not sign in. Please try again.' : 'Could not reach the Peblo server.'));
    } finally {
      setAuthBusy(false);
    }
  };

  const turnSharingOff = async () => {
    try {
      await publicShareAPI.turnOff(kindPath, token);
      setShareOff(true);
      setIsOwner(false);
      setRevokeConfirm(false);
      setMenuOpen(false);
      showToast('Sharing is off. This link no longer works for other people.');
    } catch (cause) {
      showToast(cause.response?.data?.error || 'Could not turn sharing off');
    }
  };

  useEffect(() => {
    let lastTop = 0;
    const updateProgress = () => {
      const scroller = articleRef.current;
      if (scroller) { const y = scroller.scrollTop; if (y > lastTop + 6 && y > 120) setTopHidden(true); else if (y < lastTop - 6 || y < 60) setTopHidden(false); lastTop = y; }
      const range = scroller ? scroller.scrollHeight - scroller.clientHeight : 0;
      setScrollProgress(range > 0 ? Math.min(100, (scroller.scrollTop / range) * 100) : 0);
    };
    window.addEventListener('resize', updateProgress);
    const scroller = articleRef.current;
    scroller?.addEventListener('scroll', updateProgress, { passive: true });
    updateProgress();
    return () => { scroller?.removeEventListener('scroll', updateProgress); window.removeEventListener('resize', updateProgress); };
  }, [data]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeOnOutside = (event) => { if (!menuRef.current?.contains(event.target)) setMenuOpen(false); };
    const closeOnEscape = (event) => { if (event.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', closeOnOutside); document.removeEventListener('keydown', closeOnEscape); };
  }, [menuOpen]);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  useEffect(() => {
    if (!headings.length || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActiveHeading(visible[0].target.id);
    }, { root: articleRef.current, rootMargin: '-24px 0px -72% 0px' });
    headings.forEach(({ id }) => { const element = document.getElementById(id); if (element) observer.observe(element); });
    return () => observer.disconnect();
  }, [headings, data]);

  useEffect(() => {
    const scrollFromHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id) requestAnimationFrame(() => scrollToHeading(id, 'auto'));
    };
    window.addEventListener('hashchange', scrollFromHash);
    window.addEventListener('popstate', scrollFromHash);
    scrollFromHash();
    return () => {
      window.removeEventListener('hashchange', scrollFromHash);
      window.removeEventListener('popstate', scrollFromHash);
    };
  }, [scrollToHeading, headings, data]);

  const reader = useShareReader({ enabled: data?.kind === 'note' && !shareOff, scope: `${kindPath}:${token}`, articleRef, deps: rev });
  const [bmOpen, setBmOpen] = useState(false);
  const handleHeadingClick = (event, id) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (window.location.hash !== `#${id}`) window.history.pushState(null, '', `#${id}`);
    scrollToHeading(id);
  };

  return (
    <div ref={rootRef} className={`pb-shared${fullscreen ? ' is-fs' : ''}${topHidden ? ' top-tucked' : ''}${look.quiet ? ' is-quiet' : ''}${reader.showChanges ? '' : ' no-chg'}`} data-theme={darkMode ? 'dark' : 'light'} data-size={look.size} data-width={look.width} data-font={look.font}>
      <div className="blobs" aria-hidden="true"><i /><i /><i /></div>
      <header className="top">
        <div className="top-in">
          <a className="brand" href="/" aria-label="Peblo home"><i />Peblo</a>
          {data && <div className="crumb"><ChevronRight className="sep" size={14} /><span>Shared page</span><ChevronRight className="sep" size={14} /><b title={pageTitle}>{pageTitle}</b></div>}
          <span className="spacer" />
          {data && <span className={`pill ${data.canEdit ? 'edit' : 'view'}`}>{data.canEdit ? <Pencil size={15} /> : <Eye size={15} />}{data.canEdit ? 'Can edit' : 'Can view'}</span>}
          {data?.canEdit && <button className={`btn preview-btn${previewMode ? ' active' : ''}`} type="button" aria-pressed={previewMode} onClick={() => { setPreviewMode((value) => !value); setMenuOpen(false); }} title={previewMode ? 'Return to editing' : 'Preview the page as viewers see it'}>
            {previewMode ? <Pencil size={16} /> : <Eye size={16} />}<span>{previewMode ? 'Edit page' : 'Preview'}</span>
          </button>}
          {data && viewers.length > 0 && <button type="button" className="avatars" aria-label={`${viewers.length} people viewing this page. Open live collaboration`} aria-expanded={panelOpen} title={`${viewers.length} viewing now`} onClick={() => setPanelOpen((open) => !open)}>
            {viewers.slice(0, 3).map((viewer, index) => <span key={viewer.id} className={`av viewer-avatar avatar-${index}${viewer.typing && !viewer.self ? ' typing' : ''}`} title={`${viewer.name}${viewer.self ? ' (you)' : ''}${viewer.typing && !viewer.self ? ' · typing' : ''}`} aria-label={`${viewer.name}${viewer.self ? ' (you)' : ''}`}>{initials(viewer.name)}</span>)}
            {viewers.length > 3 && <span className="av avatar-extra">+{viewers.length - 3}</span>}
          </button>}
          {data && <button className={`btn primary save-btn${savedCopy ? ' is-saved' : ''}`} type="button" aria-label={savedCopy ? 'Open saved copy in Peblo' : 'Save to my Peblo'} disabled={saveBusy} onClick={() => savedCopy ? navigate(savedCopy.kind === 'note' ? `/notes/${savedCopy.id}` : '/tasks') : saveSharedCopy()}>
            {saveBusy ? <LoaderCircle className="spin" size={16} /> : savedCopy ? <Check size={16} /> : <Clipboard size={16} />}
            <span>{saveBusy ? 'Saving…' : savedCopy ? 'Open in Peblo' : 'Save to my Peblo'}</span>
          </button>}
          {data && <button className="btn copy-btn" type="button" onClick={() => copy(window.location.href, 'Share link copied')}><Link2 size={17} /><span>Copy link</span></button>}
          {data && <button className="btn icon" type="button" data-testid="fs-btn" aria-label="Full screen" title="Full screen (F)" onClick={toggleFullscreen}><Maximize2 size={18} /></button>}
          {data && <div className="menu-wrap" ref={lookRef}>
            <button className="btn icon" type="button" data-testid="look-btn" aria-label="Appearance" aria-haspopup="dialog" aria-expanded={lookOpen} title="Appearance" onClick={() => { setLookOpen((o) => !o); setMenuOpen(false); }}><Type size={18} /></button>
            {lookOpen && <div className="menu look-menu" role="dialog" aria-label="Appearance" data-testid="look-menu">
              <h4>Appearance</h4>
              <div className="look-row"><span>Text size</span><div className="seg" role="group" aria-label="Text size">{[['s', 'A−'], ['m', 'A'], ['l', 'A+'], ['xl', 'A++']].map(([v, l]) => <button key={v} type="button" className={look.size === v ? 'on' : ''} aria-pressed={look.size === v} data-testid={`look-size-${v}`} onClick={() => setLookPref({ size: v })}>{l}</button>)}</div></div>
              <div className="look-row"><span>Page width</span><div className="seg" role="group" aria-label="Page width">{[['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']].map(([v, l]) => <button key={v} type="button" className={look.width === v ? 'on' : ''} aria-pressed={look.width === v} data-testid={`look-width-${v}`} onClick={() => setLookPref({ width: v })}>{l}</button>)}</div></div>
              <div className="look-row"><span>Font</span><div className="seg" role="group" aria-label="Font">{[['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono']].map(([v, l]) => <button key={v} type="button" className={look.font === v ? 'on' : ''} aria-pressed={look.font === v} data-testid={`look-font-${v}`} onClick={() => setLookPref({ font: v })}>{l}</button>)}</div></div>
              <div className="look-row"><span>Theme</span><div className="seg" role="group" aria-label="Theme">{[[false, 'Light'], [true, 'Dark']].map(([v, l]) => <button key={l} type="button" className={darkMode === v ? 'on' : ''} aria-pressed={darkMode === v} onClick={() => setDarkMode(v)}>{l}</button>)}</div></div>
              <label className="look-check"><input type="checkbox" data-testid="look-pointers" checked={look.pointers} onChange={(event) => setLookPref({ pointers: event.target.checked })} /><span>Show other people's mouse pointers</span></label>
              <label className="look-check"><input type="checkbox" data-testid="look-quiet" checked={look.quiet} onChange={(event) => setLookPref({ quiet: event.target.checked })} /><span>Quiet mode (no join or typing notices)</span></label>
              <label className="look-check"><input type="checkbox" data-testid="look-pin" checked={look.pin} onChange={(event) => setLookPref({ pin: event.target.checked })} /><span>Keep the tool bar showing</span></label>
              <button type="button" className="look-reset" onClick={() => setLookPref({ size: 'm', width: 'normal', font: 'sans' })}>Reset reading style</button>
            </div>}
          </div>}
          {data && <div className="menu-wrap" ref={menuRef}>
            <button className="btn icon" type="button" aria-label="More options" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={19} /></button>
            {menuOpen && <div className="menu" role="menu">
              <h4>Share</h4>
              <div className="linkbox"><input readOnly value={window.location.href} aria-label="Share link" /><button className="btn dark" type="button" onClick={() => copy(window.location.href)}>Copy</button></div>
              <hr />
              <button type="button" role="menuitem" onClick={() => exportShared('md')}><Download size={17} /><span>Download as Markdown<small>Keep your note formatting</small></span></button>
              <button type="button" role="menuitem" onClick={() => exportShared('pdf')}><FileText size={17} /><span>Download as PDF<small>Ready to share or print</small></span></button>
              <button type="button" role="menuitem" onClick={() => exportShared('doc')}><FileText size={17} /><span>Download as Word<small>Editable .doc document</small></span></button>
              <button type="button" role="menuitem" onClick={() => exportShared('html')}><FileText size={17} /><span>Download as HTML</span></button>
              <button type="button" role="menuitem" onClick={() => exportShared('txt')}><FileText size={17} /><span>Download as plain text</span></button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); exportDocs([{ title: data?.title || data?.text || 'Untitled', content: data?.content || data?.note?.content || '' }], 'print', pageTitle).catch((cause) => showToast(cause.message || 'Could not open print dialog')); }}><Printer size={17} /><span>Print</span></button>
              <button type="button" role="menuitem" onClick={() => copy(data?.kind === 'todo' ? `${data.text}\n\n${data.note?.content || ''}` : `# ${data?.title || 'Untitled'}\n\n${data?.content || ''}`, 'Note text copied')}><Clipboard size={17} /><span>Copy note text</span></button>
              <button type="button" role="menuitem" onClick={() => { setDarkMode((dark) => !dark); setMenuOpen(false); }}>{darkMode ? <Sun size={17} /> : <Moon size={17} />}<span>{darkMode ? 'Light mode' : 'Dark mode'}</span></button>
              {isOwner && !shareOff && <><hr /><button className="danger" type="button" role="menuitem" onClick={() => { setRevokeConfirm(true); setMenuOpen(false); }}><X size={17} /><span>Turn sharing off<small>Disable this link for everyone</small></span></button></>}
              <hr />
              <div className="menu-note">Anyone with this link can {data?.canEdit ? 'edit' : 'read'} this {data?.kind === 'todo' ? 'task' : 'note'}.</div>
            </div>}
          </div>}
        </div>
        <div className="progress" aria-hidden="true"><i style={{ width: `${scrollProgress}%` }} /></div>
      </header>

      {shareOff && <div className="share-off-banner" role="status"><Check size={17} /><span><b>Sharing is off.</b> This link no longer works for other people.</span></div>}

      {error ? (
        <main className="stage"><section className="gone" role="alert"><div className="orb" aria-hidden="true"><span><X size={30} /></span></div><h1>This link isn’t available</h1><p>{error}</p><a className="btn primary" href="/">Go to Peblo</a></section></main>
      ) : !data ? (
        <main className="stage"><p className="loading">Loading your shared page…</p></main>
      ) : (
        <main className={`stage${data.kind === 'todo' || headings.length === 0 ? ' task-stage' : ''}${panelOpen ? ' has-panel' : ''}${tocOpen ? '' : ' toc-collapsed'}`}>
          {data.kind === 'note' && headings.length > 0 && <aside className={`toc${tocOpen ? '' : ' collapsed'}`} aria-label="On this page">
            <div className="toc-head">{tocOpen && <h2>On this page</h2>}<button type="button" className="toc-toggle" data-testid="toc-toggle" aria-expanded={tocOpen} aria-label={tocOpen ? 'Hide outline' : 'Show outline'} title={tocOpen ? 'Hide outline' : 'Show outline'} onClick={toggleToc}>{tocOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}</button></div>
            {tocOpen && <>
            {headings.map(({ id, title, level }) => <a key={id} href={`#${id}`} onClick={(event) => handleHeadingClick(event, id)} className={`${activeHeading === id ? 'on' : ''}${level === 3 ? ' sub' : ''}`}><span className="toc-t">{title}</span>{(sectionPeers[id] || []).length > 0 && <span className="toc-pips" data-testid="toc-pips">{sectionPeers[id].map((p) => <i key={p.id} title={`${p.name} is here`} style={{ background: peerColor(p.id) }} />)}</span>}</a>)}
            <div className="meta"><b>{Math.max(1, Math.ceil(wordCount / 200))} min read</b><br />Updated {when(data.updatedAt)}<br /><span>{data.canEdit ? 'Anyone with the link can edit' : 'Read only · no sign-in needed'}</span></div>
            </>}
          </aside>}

          <article ref={articleRef}>
            {data.kind === 'note' && <>
              {data.canEdit && !previewMode
                ? <textarea className="title-in" rows={1} aria-label="Title" key={`t${rev}`} defaultValue={data.title || ''} ref={fitTitle} onInput={(event) => fitTitle(event.currentTarget)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} onChange={(event) => { draft.current.title = event.target.value.replace(/\n/g, ' '); typedAt.current = Date.now(); queueSave(); }} />
                : <h1 className="title">{data.title || 'Untitled'}</h1>}
              <div className="cover" data-testid="cover"><i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" />
                <ul className="cover-chips" aria-label="About this page">
                  <li><Clock size={14} />{Math.max(1, Math.ceil(wordCount / 200))} min read</li>
                  <li><FileText size={14} />{wordCount} words</li>
                  <li><Users size={14} />{others.length + 1} here now</li>
                  <li>{data.canEdit ? <Pencil size={14} /> : <Eye size={14} />}{data.canEdit ? 'Can edit' : 'View only'}</li>
                </ul>
              </div>
              <div className="by">
                <span className="av" aria-hidden="true">{initials(data.author)}</span>
                <span>{data.author ? <>Shared by <b>{data.author}</b></> : 'Shared note'}</span><span className="dotsep">·</span>
                <span>Updated {when(data.updatedAt)}</span>
                {data.canEdit && <><span className="dotsep">·</span><span className={`status ${status}`} role="status">{status === 'saved' ? <Check size={15} /> : null}{statusText}</span></>}
                {data.expiresAt && <><span className="dotsep">·</span><span className={`expiry${new Date(data.expiresAt).getTime() - Date.now() < 86400000 ? ' soon' : ''}`} data-testid="link-expiry">Link ends {when(data.expiresAt)}</span></>}
              </div>
              {data.canEdit && !user && !previewMode && <div className="welcome" data-testid="welcome">
                {!joined && <p className="welcome-note" data-testid="welcome-note"><Users size={16} /><span>Welcome. Pick a name and a colour so the others here can tell who you are.{others.length > 0 ? ` ${others.length === 1 ? '1 person is' : `${others.length} people are`} here now.` : ''}</span></p>}
                <label className="guest-name"><span>You are editing as</span>
                  <input aria-label="Your name" placeholder="Guest" maxLength={40} defaultValue={guestName} onBlur={(event) => saveGuestName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
                  <small>{guestName ? 'Others see this name' : 'Add a name so others know it is you'}</small></label>
                <span className="swatches" role="radiogroup" aria-label="Your colour">{GUEST_COLORS.map((c) => <button key={c} type="button" role="radio" aria-checked={guestColor === c} aria-label={`Colour ${c}`} data-testid="guest-color" className={guestColor === c ? 'on' : ''} style={{ background: c }} onClick={() => pickColor(c)}>{guestColor === c && <Check size={12} />}</button>)}</span>
              </div>}
              {conflict && <div className="conflict" role="alert">Someone else changed the same words while you were editing.<div className="conflict-actions"><button className="btn" type="button" onClick={() => { draft.current = { ...draft.current, title: conflict.title, content: conflict.content, base: conflict.updatedAt, baseContent: conflict.content }; setData((c) => ({ ...c, ...conflict })); setConflict(null); setStatus('saved'); setRev((n) => n + 1); }}>Load their version</button><button className="btn" type="button" onClick={() => saveNote(false, true)}>Keep both</button><button className="btn dark" type="button" onClick={() => saveNote(true)}>Keep mine</button></div></div>}
              {data.canEdit && !previewMode
                ? <Suspense fallback={<p className="loading">Loading editor…</p>}><BlockEditor key={`e${rev}${collabOff ? 'x' : ''}`} guest fullPage themeOverride={darkMode ? 'dark' : 'light'} initialContent={data.content}
                    collab={collabOff || localStorage.getItem('peblo-collab') === 'off' ? undefined : { share: token, sid: sessionIdRef.current || undefined, name: nameRef.current || user?.name || 'Guest', color: colorRef.current || undefined }}
                    onCollabState={(state) => { collabState.current = state; }} onCollabFail={() => setCollabOff(true)} onChange={(markdown) => { draft.current.content = markdown; if (document.activeElement?.closest?.('.bn-editor')) typedAt.current = Date.now(); queueSave(); }} /></Suspense>
                : <div className="doc" dangerouslySetInnerHTML={{ __html: body }} />}
            </>}

            {data.kind === 'todo' && <>
              <section className="taskcard">
                <div className="chips">
                  <span className={`chip${data.priority === 'high' ? ' p' : ''}`}>{data.priority} priority</span>
                  {data.tags.map((tag) => <span key={tag} className="chip l">#{tag}</span>)}
                </div>
                {data.canEdit && !previewMode ? <input className="task-title-in" aria-label="Task" value={data.text} onChange={(event) => { setData((current) => ({ ...current, text: event.target.value })); setStatus('saving'); }} onBlur={(event) => { const value = event.target.value.trim(); if (value && value !== taskSavedText.current) patchTask({ text: value }); else if (!value) setData((current) => ({ ...current, text: taskSavedText.current || current.text })); else setStatus('saved'); }} /> : <h1>{data.text}</h1>}
                <div className="by task-by"><span className="av" aria-hidden="true">{initials(data.author)}</span><span>{data.author ? <>Shared task from <b>{data.author}</b></> : 'Shared task'}</span>{data.canEdit && <span className={`status ${status}`} role="status">{status === 'saved' ? <Check size={15} /> : null}{statusText}</span>}</div>
                <button type="button" className={`check${data.completed ? ' done' : ''}`} aria-pressed={data.completed} disabled={!data.canEdit || previewMode} onClick={() => patchTask({ completed: !data.completed })}><span className="box">{data.completed && <Check size={17} />}</span><span className="t">{data.completed ? (data.canEdit && !previewMode ? 'Done (tap to undo)' : 'Done') : data.canEdit && !previewMode ? 'Mark as done' : 'To do'}</span></button>
                <div className="tmeta"><div><small>Due</small><b>{data.deadline ? when(data.deadline) : 'No due date'}</b></div><div><small>Priority</small><b>{data.priority}</b></div><div><small>Status</small><b>{data.completed ? 'Done' : 'To do'}</b></div></div>
              </section>
              {data.note && <><h2 className="linked">Linked note · {data.note.title || 'Untitled'}</h2><div className="doc" dangerouslySetInnerHTML={{ __html: body }} /></>}
            </>}

            <section className="cta"><div><h2>{data.kind === 'todo' ? 'Keep every task in one place.' : 'Notes, tasks and an AI that reads them.'}</h2><p>Peblo keeps your notes, to-dos and calendar in one calm place.</p></div><a className="btn" href="/">Explore Peblo</a></section>
            <footer className="foot"><span>{data.canEdit ? 'Anyone with this link can edit' : 'Read only'} · Made with Peblo</span><span>Shared page</span></footer>
          </article>
          {panelOpen && <div className="cp-drawer docked">
            <CollabPanel
              mode="guest" viewers={viewers} canEdit={!!data.canEdit} events={collab.events} offline={offline} synced={synced}
              muted={collab.muted} onMute={collab.setMuted} onClearEvents={collab.clear} onClose={() => setPanelOpen(false)}
              followId={followId} onFollow={setFollowId}
            />
          </div>}
        </main>
      )}
      {scrollProgress > 5 && <button className="totop" type="button" aria-label="Back to top" onClick={() => articleRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}><ArrowUp size={19} /></button>}
      {data && !look.quiet && typingText && <div className="typing-pill" role="status" aria-live="polite" data-testid="typing-pill">
        <span className="typing-av" aria-hidden="true">{initials(typers[0].name)}</span>
        <span className="typing-text">{typingText}</span>
        <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>
      </div>}
      {data && !previewMode && !look.quiet && !typingText && (others.length > 0 || panelOpen || offline) && <CollabBar
        viewers={viewers} open={panelOpen} offline={offline} toasts={recentEvents} onDismissToast={collab.dismiss} onToggle={() => setPanelOpen((open) => !open)}
      />}
      {data && !error && <>
        <div className="dk-edge" aria-hidden="true" onMouseEnter={showBar} />
        {!(look.pin || barShown) && <button type="button" className="dh" data-testid="dock-handle" onClick={showBar} aria-label="Show tool bar"><Wrench size={14} /><span>Tools</span><kbd>/</kbd></button>}
        {(look.pin || barShown) && <div className="dk" role="toolbar" aria-label="Page tools" data-testid="dock" onMouseEnter={showBar} onMouseLeave={() => { if (!look.pin) hideBarSoon(); }}>
          {data.kind === 'note' && headings.length > 0 && <button type="button" className="d" aria-pressed={tocOpen} onClick={toggleToc} title="Outline ["><PanelLeftOpen size={17} /><span>Outline</span><kbd>[</kbd></button>}
          <button type="button" className="d" aria-pressed={panelOpen} onClick={() => setPanelOpen((o) => !o)} title="People and comments ]"><PanelRight size={17} /><span>People</span><kbd>]</kbd></button>
          <button type="button" className="d" onClick={() => { setLookOpen(true); window.scrollTo?.({ top: 0 }); }} title="Look"><Type size={17} /><span>Look</span></button>
          <button type="button" className="d" aria-pressed={fullscreen} onClick={toggleFullscreen} title="Full screen F">{fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}<span>Full screen</span><kbd>F</kbd></button>
          {data.kind === 'note' && <button type="button" className="d" data-testid="dock-bookmarks" aria-pressed={bmOpen} onClick={() => setBmOpen((o) => !o)} title="Bookmarks (B bookmarks the line under the pointer)"><Bookmark size={17} /><span>Bookmarks</span>{reader.bookmarks.length > 0 && <kbd>{reader.bookmarks.length}</kbd>}</button>}
          <button type="button" className="d" onClick={() => setKeysOpen(true)} title="Shortcuts ?"><Keyboard size={17} /><span>Keys</span><kbd>?</kbd></button>
          <button type="button" className="d main" disabled={saveBusy} onClick={() => savedCopy ? navigate(savedCopy.kind === 'note' ? `/notes/${savedCopy.id}` : '/tasks') : saveSharedCopy()}><Clipboard size={17} /><span>{savedCopy ? 'Open' : 'Save'}</span></button>
        </div>}
        {fullscreen && <button type="button" className="fs-exit" data-testid="fs-exit" onClick={toggleFullscreen}><Minimize2 size={15} />Exit full screen<kbd>Esc</kbd></button>}
      </>}
      {data?.kind === 'note' && bmOpen && <aside className="bm-pop" data-testid="bookmarks" aria-label="My bookmarks">
        <h3><Bookmark size={16} />My bookmarks<span className="n">{reader.bookmarks.length}</span><button type="button" aria-label="Close" onClick={() => setBmOpen(false)}><X size={15} /></button></h3>
        {reader.bookmarks.length === 0 && <p className="bm-empty">Nothing yet. Point at a line and press B.</p>}
        {reader.bookmarks.map((b) => <div className="bm-row" key={b.sig}><button type="button" className="bm-go" data-testid="bookmark-item" onClick={() => { reader.goBookmark(b.sig); setBmOpen(false); }}><Bookmark size={14} /><span>{b.title}</span></button><button type="button" aria-label="Remove bookmark" onClick={() => reader.removeBookmark(b.sig)}><X size={13} /></button></div>)}
        <button type="button" className="bm-add" data-testid="bookmark-add" onClick={() => { if (!reader.toggleBookmark()) showToast('Scroll to a line first'); }}>Bookmark the line at the top</button>
      </aside>}
      {data?.kind === 'note' && !fullscreen && (reader.changes || reader.place) && <div className="reader-pills">
        {reader.changes && <div className="rp" data-testid="changes-pill"><History size={16} /><div><b>{reader.changes.count} change{reader.changes.count > 1 ? 's' : ''} since your last visit</b><small>{new Date(reader.changes.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></div><button type="button" data-testid="changes-toggle" onClick={() => reader.setShowChanges((v) => !v)}>{reader.showChanges ? 'Hide marks' : 'Show marks'}</button><button type="button" aria-label="Dismiss" onClick={reader.dismissChanges}><X size={14} /></button></div>}
        {reader.place && !reader.changes && <div className="rp" data-testid="place-pill"><History size={16} /><div><b>You stopped at {reader.place.title}</b></div><button type="button" data-testid="place-jump" onClick={reader.jumpPlace}>Jump back</button><button type="button" aria-label="Dismiss" onClick={reader.dismissPlace}><X size={14} /></button></div>}
      </div>}
      {keysOpen && <div className="sheet-back keys-back" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setKeysOpen(false); }}>
        <section className="keys-sheet" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" data-testid="keys-sheet">
          <header><h2>Keyboard shortcuts</h2><button type="button" aria-label="Close" onClick={() => setKeysOpen(false)}><X size={18} /></button></header>
          <ul>{[['[', 'Show or hide the outline'], [']', 'Show or hide people and comments'], ['\\', 'Hide both side panels'], ['/', 'Show or hide the tool bar'], ['B', 'Bookmark the line under the pointer'], ['F', 'Full screen'], ['Esc', 'Leave full screen or close'], ['?', 'This list']].map(([k, l]) => <li key={k}><kbd>{k}</kbd><span>{l}</span></li>)}</ul>
        </section>
      </div>}
      {data && !error && <nav className="mbar" aria-label="Page actions" data-testid="mbar">
        {data.kind === 'note' && headings.length > 0 && <button type="button" aria-label="Outline" onClick={() => setTocSheet(true)}><List size={20} /><span>Outline</span></button>}
        <button type="button" aria-label="People" aria-pressed={panelOpen} onClick={() => setPanelOpen((open) => !open)}><Users size={20} /><span>People{others.length ? ` ${others.length}` : ''}</span></button>
        <button type="button" aria-label="Appearance" onClick={() => { setLookOpen(true); window.scrollTo?.({ top: 0 }); }}><Type size={20} /><span>Look</span></button>
        <button type="button" aria-label="Copy link" onClick={() => copy(window.location.href, 'Share link copied')}><Link2 size={20} /><span>Link</span></button>
        <button type="button" className="main" aria-label={savedCopy ? 'Open saved copy in Peblo' : 'Save to my Peblo'} disabled={saveBusy} onClick={() => savedCopy ? navigate(savedCopy.kind === 'note' ? `/notes/${savedCopy.id}` : '/tasks') : saveSharedCopy()}><Clipboard size={20} /><span>Save</span></button>
      </nav>}
      {tocSheet && <div className="sheet-back" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTocSheet(false); }}>
        <section className="sheet" role="dialog" aria-modal="true" aria-label="On this page" data-testid="toc-sheet">
          <header><h2>On this page</h2><button type="button" aria-label="Close" onClick={() => setTocSheet(false)}><X size={18} /></button></header>
          {headings.map(({ id, title, level }) => <a key={id} href={`#${id}`} className={level === 3 ? 'sub' : ''} onClick={(event) => { handleHeadingClick(event, id); setTocSheet(false); }}>{title}</a>)}
        </section>
      </div>}
      {toast && <div className="toast" role="status" aria-live="polite"><Check size={16} />{toast}</div>}
      {authOpen && <div className="share-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !authBusy) setAuthOpen(false); }}>
        <section className="share-modal" role="dialog" aria-modal="true" aria-labelledby="share-auth-title">
          <button className="share-modal-close" type="button" aria-label="Close" disabled={authBusy} onClick={() => setAuthOpen(false)}><X size={18} /></button>
          <span className="modal-kicker">Keep this in your workspace</span>
          <h2 id="share-auth-title">{authMode === 'signup' ? 'Create your Peblo account' : 'Sign in to save this page'}</h2>
          <p>Save your own copy so you can find and edit it later.</p>
          <form onSubmit={submitAuthAndSave}>
            {authMode === 'signup' && <label>Your name<input value={authName} onChange={(event) => setAuthName(event.target.value)} autoComplete="name" maxLength={80} required /></label>}
            <label>Email<input type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} autoComplete="email" required /></label>
            <label>Password<input type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} minLength={authMode === 'signup' ? 8 : undefined} required /></label>
            {authError && <div className="auth-error" role="alert">{authError}</div>}
            <button className="btn primary modal-submit" type="submit" disabled={authBusy || !authEmail.trim() || !authPassword || (authMode === 'signup' && !authName.trim())}>{authBusy ? <><LoaderCircle className="spin" size={16} />Please wait…</> : authMode === 'signup' ? 'Create account and save' : 'Sign in and save'}</button>
          </form>
          <button className="auth-switch" type="button" disabled={authBusy} onClick={() => { setAuthMode((mode) => mode === 'login' ? 'signup' : 'login'); setAuthError(''); }}>{authMode === 'signup' ? 'Already have an account? Sign in' : 'New to Peblo? Create an account'}</button>
        </section>
      </div>}
      {revokeConfirm && <div className="share-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRevokeConfirm(false); }}>
        <section className="share-modal revoke-modal" role="dialog" aria-modal="true" aria-labelledby="revoke-title">
          <button className="share-modal-close" type="button" aria-label="Close" onClick={() => setRevokeConfirm(false)}><X size={18} /></button>
          <span className="modal-kicker">You own this link</span>
          <h2 id="revoke-title">Turn sharing off?</h2>
          <p>Anyone using this link will lose access. You can create a new link later from Peblo.</p>
          <div className="modal-actions"><button className="btn" type="button" onClick={() => setRevokeConfirm(false)}>Keep link on</button><button className="btn danger-btn" type="button" onClick={turnSharingOff}>Turn sharing off</button></div>
        </section>
      </div>}
    </div>
  );
}
