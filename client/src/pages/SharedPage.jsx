import PagePolls from '../components/PagePolls';
import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Sparkles, ArrowUp, Check, ChevronRight, Clipboard, Clock, List, Users, Download, Eye, FileText, Link2, LoaderCircle, Moon, MoreHorizontal, PanelLeftClose, PanelLeftOpen, PanelRight, Bookmark, History, Maximize2, Minimize2, Keyboard, Wrench, Pencil, Printer, Sun, Type, X, Pin, Lock, MessageSquare, File as FileIcon, Search as SearchIcon, Volume2, Ban, User, RotateCcw, LogOut, Share2, ArrowDown, Languages, AlertTriangle } from 'lucide-react';
import GuestTour from '../components/GuestTour';
import SharePalette from './SharePalette';
import SharePanel from './SharePanel';
import { ShareTrack, FollowBanner } from './ShareTrack';
import { ListenBar, TranslateMenu, LANGUAGES } from './ListenTranslate';
import ShareVersions from './ShareVersions';
import ShareCards, { EndOfPage, TodoAbout, TodoCards } from './ShareCards';
import FindBar from '../components/FindBar';
import { useAuth } from '../context/AuthContext';
import { notesAPI, publicShareAPI, todosAPI } from '../api';
import { authHeaders } from '../api/token';
import { exportDocs } from '../utils/exporters';
import { caretSelection, headingIndexes, peerColor, scrollToPeerBlock, showPeers } from '../utils/peerCursors';
import { presenceOn } from '../utils/presencePref';
import { CollabBar, CollabPanel, useCollabEvents } from '../components/CollabPanel';
import useShareReader from './useShareReader';
import useFileFrames from '../components/useFileFrames';
import { splitMarkers, applyMarksToHtml } from '../utils/tableMeta';
import '../components/tableMeta.css';
import './shared-page.css';

const BlockEditor = lazy(() => import('../components/BlockEditor'));
const PictureView = lazy(() => import('../components/PictureView'));

// The note's HTML is written once per change (a fresh object each render would write it again and undo the file frames drawn into it).
const DocHtml = memo(function DocHtml({ innerRef, html }) { return <div className="doc" ref={innerRef} dangerouslySetInnerHTML={{ __html: html }} />; });

// Content blocks as drawn on S37: code with a Copy button, callouts (a quote that starts with a symbol, as the editor writes them)
// and a link on its own line shown as a card. Plain markup only, the Copy button is wired by the document's click listener.
const CALLOUT_MARKS = [['\u{1F4A1}', 'tip'], ['⚠️', 'warn'], ['⚠', 'warn'], ['✅', 'ok'], ['ℹ️', 'info'], ['ℹ', 'info']];
const svgIcon = (d, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const CALLOUT_ICON_SVG = {
  info: svgIcon('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  tip: svgIcon('<path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z"/>'),
  warn: svgIcon('<path d="M12 3l10 18H2zM12 10v5M12 18h.01"/>'),
  ok: svgIcon('<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>'),
};
const LINK_ICON_SVG = svgIcon('<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3A4 4 0 0011 18.7l1-1"/>', 17);
const ARROW_SVG = svgIcon('<path d="M5 12h14M13 6l6 6-6 6"/>', 16);
function decorateBlocks(parsed) {
  const doc = parsed;
  doc.body.querySelectorAll('pre').forEach((pre) => {
    if (pre.querySelector('.code-copy')) return;
    const b = doc.createElement('button'); b.type = 'button'; b.className = 'code-copy'; b.setAttribute('data-code-copy', '1'); b.setAttribute('aria-label', 'Copy code'); b.setAttribute('data-testid', 'code-copy'); b.textContent = 'Copy';
    pre.appendChild(b);
  });
  doc.body.querySelectorAll('blockquote').forEach((q) => {
    const first = q.querySelector('p') || q;
    const text = (first.textContent || '').trimStart();
    const hit = CALLOUT_MARKS.find(([mark]) => text.startsWith(mark));
    if (!hit) return;
    const first1 = first.firstChild;
    if (first1 && first1.nodeType === 3) first1.textContent = first1.textContent.replace(/^\s*(\u{1F4A1}|⚠️?|✅|ℹ️?)\s*/u, '');
    const box = doc.createElement('aside'); box.className = 'callout'; box.setAttribute('data-callout', hit[1]); box.setAttribute('role', 'note'); box.setAttribute('data-testid', 'callout');
    box.innerHTML = `<span class="callout-ic">${CALLOUT_ICON_SVG[hit[1]]}</span><div class="callout-tx">${q.innerHTML}</div>`;
    q.replaceWith(box);
  });
  doc.body.querySelectorAll('p').forEach((p) => {
    const kids = [...p.childNodes].filter((n) => !(n.nodeType === 3 && !n.textContent.trim()));
    if (kids.length !== 1 || kids[0].nodeName !== 'A') return;
    const a = kids[0]; const href = a.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href) || p.closest('li, blockquote, aside, table')) return;
    let host = href; try { const u = new URL(href); host = u.host + (u.pathname === '/' ? '' : u.pathname); } catch { /* keep the raw address */ }
    const bare = a.textContent.trim() === href;
    const card = doc.createElement('a'); card.className = 'link-card'; card.href = href; card.target = '_blank'; card.rel = 'noopener noreferrer'; card.setAttribute('data-testid', 'link-card');
    const title = bare ? host.replace(/^www\./, '') : a.textContent.trim();
    card.innerHTML = `<span class="lc-ic">${LINK_ICON_SVG}</span><span class="lc-tx"><b></b><small></small></span>${ARROW_SVG}`;
    card.querySelector('b').textContent = title; card.querySelector('small').textContent = host;
    p.replaceWith(card);
  });
}

const toHtml = (md0) => {
  const { text: md, marks } = splitMarkers(md0); // the table settings Markdown cannot hold (widths, colours, merged cells) ride in hidden comment lines
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
  groupPictures(parsed);
  addPicturePills(parsed);
  decorateBlocks(parsed);
  applyMarksToHtml(parsed.body, marks);
  return parsed.body.innerHTML;
};

// Under every picture a small pill carries the picture's full address as real text and a real link, so a person, a script or any AI
// that reads this page as text can find and open each picture. The pill is plain markup (no script), the Copy button is wired by one listener.
const PILL_LINK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10 14a4 4 0 005.6 0l3-3a4 4 0 00-5.6-5.6l-1 1M14 10a4 4 0 00-5.6 0l-3 3a4 4 0 005.6 5.6l1-1"/></svg>';
const absPicture = (src) => { try { const u = new URL(src, window.location.origin); u.hash = ''; return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; } };
function addPicturePills(parsed) {
  const doc = parsed;
  const seen = [];
  [...doc.body.querySelectorAll('img')].forEach((img) => {
    if (img.closest('a, button')) return;
    const href = absPicture(img.getAttribute('src') || ''); if (!href) return;
    seen.push(href);
    const n = seen.length;
    const pill = doc.createElement('span'); pill.className = 'pic-pill'; pill.setAttribute('data-testid', 'pic-pill');
    pill.innerHTML = `${PILL_LINK}<span class="pic-n">Image ${n}</span>`;
    const a = doc.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = href; a.setAttribute('data-testid', 'pic-pill-link');
    const b = doc.createElement('button'); b.type = 'button'; b.setAttribute('data-pill-copy', href); b.textContent = 'Copy';
    pill.append(a, b);
    const parent = img.parentElement;
    const group = parent && parent.querySelectorAll('img').length > 1;
    const after = group ? parent : img;
    // alt text rides along as data too: a text-only reader gets the name of the picture next to its address
    const alt = img.getAttribute('alt'); if (alt) pill.setAttribute('title', alt);
    after.insertAdjacentElement('afterend', pill);
  });
  if (seen.length) {
    const all = doc.createElement('div'); all.className = 'pic-all'; all.setAttribute('data-testid', 'pic-all');
    all.innerHTML = `${PILL_LINK}<span>${seen.length} picture${seen.length > 1 ? 's' : ''} on this page</span>`;
    const b = doc.createElement('button'); b.type = 'button'; b.setAttribute('data-pill-copy', seen.join('\n')); b.setAttribute('data-testid', 'pic-all-copy'); b.textContent = 'Copy all picture links';
    all.append(b);
    const first = doc.body.firstElementChild;
    if (first && /^H[1-3]$/.test(first.tagName)) first.insertAdjacentElement('afterend', all); else doc.body.insertAdjacentElement('afterbegin', all);
  }
}

// Pictures the owner laid out as a grid or a row are kept in the picture address ("#gl=grid&gc=3"); show them that way here too.
const layoutOf = (img) => {
  const hash = (img.getAttribute('src') || '').split('#')[1];
  if (!hash) return null;
  const p = new URLSearchParams(hash);
  const k = p.get('gl');
  return k === 'grid' || k === 'row' ? { k, c: Math.min(4, Math.max(2, Number(p.get('gc')) || 3)) } : null;
};
const onlyPictures = (el) => {
  if (!['P', 'FIGURE'].includes(el.tagName) || !el.querySelector('img')) return false;
  const copy = el.cloneNode(true);
  copy.querySelectorAll('img, figcaption, br').forEach((n) => n.remove());
  return !copy.textContent.trim();
};
function groupPictures(doc) {
  let run = null;
  const wrap = (k, c, nodes, before) => {
    const w = doc.createElement('div');
    w.className = 'pic-group'; w.setAttribute('data-gl', k); w.setAttribute('data-gc', String(k === 'grid' ? c : Math.min(nodes.length, 6)));
    before.before(w); nodes.forEach((n) => w.appendChild(n));
  };
  const flush = () => { if (run && run.items.length > 1) wrap(run.k, run.c, run.items, run.items[0]); run = null; };
  [...doc.body.children].forEach((el) => {
    const imgs = el.tagName === 'IMG' ? [el] : onlyPictures(el) ? [...el.querySelectorAll('img')] : [];
    const g = imgs.length ? layoutOf(imgs[0]) : null;
    if (!g) { flush(); return; }
    if (imgs.length > 1) { flush(); wrap(g.k, g.c, imgs, el); el.remove(); return; }
    if (run && run.k === g.k && (g.k === 'row' || run.c === g.c)) run.items.push(el);
    else { flush(); run = { ...g, items: [el] }; }
  });
  flush();
}

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

const viewerSid = (kindPath, token) => {
  const key = `peblo-share-viewer:${kindPath}:${token}`;
  try {
    let id = sessionStorage.getItem(key);
    if (!id) { id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`; sessionStorage.setItem(key, id); }
    return id;
  } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
};

export default function SharedPage() {
  const { kind, token } = useParams();
  const navigate = useNavigate();
  const { user, signIn } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('saved');
  const [conflict, setConflict] = useState(null);
  const [rev, setRev] = useState(0);
  const [wait, setWait] = useState(null);
  const [waitName, setWaitName] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [scrollProgress, setScrollProgress] = useState(0);
  const progressRef = useRef(0);
  const [extAsked, setExtAsked] = useState(false);
  const [exporting, setExporting] = useState('');
  const [activeHeading, setActiveHeading] = useState('');
  const [darkMode, setDarkMode] = useState(() => document.documentElement.classList.contains('theme-dark'));
  const [previewMode, setPreviewMode] = useState(false);
  const [readerFind, setReaderFind] = useState(false);
  const docRef = useRef(null);
  const [viewers, setViewers] = useState([]);
  const [panelOpen, setPanelOpen] = useState(false); // opens by itself only when other people are on the page
  const [sectionPeers, setSectionPeers] = useState({});
  const [offline, setOffline] = useState(false);
  const [synced, setSynced] = useState(false);
  const [now, setNow] = useState(Date.now());
  const sessionIdRef = useRef(null);
  const canEditRef = useRef(false);
  canEditRef.current = !!data?.canEdit;
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
  // In a live room the editor's change event is handled by the room, so also count real key presses in the editor as typing.
  useEffect(() => {
    const onKey = (event) => { if (event.ctrlKey || event.metaKey || event.altKey || ['Shift', 'Control', 'Alt', 'Meta', 'Escape', 'Tab', 'CapsLock'].includes(event.key)) return; if (event.target?.closest?.('.bn-editor')) typedAt.current = Date.now(); };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
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
  // Colours are never chosen: every person gets their own from the viewer id (same one on cursor, outline dot and comments).
  const colorRef = useRef('');
  const [joined, setJoined] = useState(() => { try { return localStorage.getItem('peblo-guest-joined') === '1' || !!localStorage.getItem('peblo-guest-name'); } catch { return false; } });
  const markJoined = () => { setJoined(true); try { localStorage.setItem('peblo-guest-joined', '1'); } catch { /* not remembered */ } };
  const [tocSheet, setTocSheet] = useState(false);
  const [cardsSheet, setCardsSheet] = useState(false);
  const taskSavedText = useRef(null);
  const timer = useRef(null);
  const toastTimer = useRef(null);
  const menuRef = useRef(null);
  // how this person likes to read the page (kept in this browser only)
  const [tocOpen, setTocOpen] = useState(() => { try { return localStorage.getItem('peblo-share-toc') !== 'closed'; } catch { return true; } });
  const [look, setLook] = useState(() => { try { return { size: 'm', width: 'normal', font: 'sans', pointers: false, quiet: false, pin: false, style: 'follow', ...(JSON.parse(localStorage.getItem('peblo-share-look') || '{}')), pointers: presenceOn() }; } catch { return { size: 'm', width: 'normal', font: 'sans', pointers: false, quiet: false, pin: false, style: 'follow' }; } });
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
  const effStyle = !look.style || look.style === 'follow' ? (data?.ownerStyle || 'soft') : look.style;
  useEffect(() => {
    document.documentElement.dataset.shareStyle = effStyle;
    return () => { delete document.documentElement.dataset.shareStyle; };
  }, [effStyle]);
  useEffect(() => {
    const toggle = () => setPanelOpen((open) => !open);
    window.addEventListener('pb-open-collab', toggle);
    return () => window.removeEventListener('pb-open-collab', toggle);
  }, []);
  const articleRef = useRef(null);
  // full screen, hidden tool bar, tucked-away top bar, shortcuts
  const [fullscreen, setFullscreen] = useState(false);
  const [barShown, setBarShown] = useState(false);
  const [topHidden, setTopHidden] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const on = (event) => { if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') { event.preventDefault(); setPaletteOpen((open) => !open); } };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
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
  // Ctrl F on a page that is only read: the same find card the editor has (Find only, no Replace)
  useEffect(() => {
    const onFind = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'f') return;
      if (!docRef.current) return; // an editable page has the editor's own find
      const t = event.target;
      if (t?.closest?.('input, textarea, select')) return;
      event.preventDefault(); setReaderFind(true);
    };
    document.addEventListener('keydown', onFind, true);
    return () => document.removeEventListener('keydown', onFind, true);
  }, []);
  const showBar = () => { clearTimeout(barTimer.current); setBarShown(true); };
  const hideBarSoon = () => { clearTimeout(barTimer.current); barTimer.current = setTimeout(() => setBarShown(false), 1400); };
  useEffect(() => () => clearTimeout(barTimer.current), []);
  const kbRef = useRef({});
  const gPending = useRef(0);
  useEffect(() => {
    const onCtrl = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      const k = event.key.toLowerCase();
      const kb = kbRef.current;
      if (k === 'b' && kb.jumpPlace) { event.preventDefault(); kb.jumpPlace(); }
      else if (k === 'j' && kb.toggleTheme) { event.preventDefault(); kb.toggleTheme(); }
      else if (k === 'l' && kb.copyLink) { event.preventDefault(); kb.copyLink(); }
    };
    document.addEventListener('keydown', onCtrl);
    return () => document.removeEventListener('keydown', onCtrl);
  }, []);
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
      else if (event.key === 'j' || event.key === 'J' || event.key === 'k' || event.key === 'K') { event.preventDefault(); kbRef.current.stepHeading?.(event.key.toLowerCase() === 'j' ? 1 : -1); }
      else if (event.key === 'l' || event.key === 'L') { event.preventDefault(); kbRef.current.toggleListen?.(); }
      else if (event.key === 't' || event.key === 'T') { event.preventDefault(); kbRef.current.toggleTranslate?.(); }
      else if (event.key === 'c' || event.key === 'C') { event.preventDefault(); kbRef.current.openComments?.(); }
      else if (event.key === 'g' || event.key === 'G') { event.preventDefault(); if (Date.now() - gPending.current < 800) { gPending.current = 0; kbRef.current.toTop?.(); } else gPending.current = Date.now(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fullscreen, toggleFullscreen]);
  const shareStateRef = useRef({ data, status });
  shareStateRef.current = { data, status };
  const kindPath = kind === 'task' || kind === 'todo' ? 'todo' : 'note';
  const url = `/api/public/${kindPath}/${encodeURIComponent(token)}`;
  const readUrl = `${url}?sid=${encodeURIComponent(viewerSid(kindPath, token))}`;
  // S27: a link with a password. The unlock value is kept for this tab only and goes with every request.
  const unlockKey = `peblo-unlock:${kindPath}:${token}`;
  const getUnlock = () => { try { return sessionStorage.getItem(unlockKey) || ''; } catch { return ''; } };
  const [locked, setLocked] = useState(null);
  const [lockPw, setLockPw] = useState('');
  const [lockErr, setLockErr] = useState('');
  const [lockBusy, setLockBusy] = useState(false);
  const submitLock = async (event) => {
    event.preventDefault();
    if (!lockPw || lockBusy) return;
    setLockBusy(true); setLockErr('');
    try {
      const r = await fetch(`${url}/unlock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: lockPw }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'That password is not right.');
      try { sessionStorage.setItem(unlockKey, j.unlock || ''); } catch { /* kept in memory only */ }
      setLockPw(''); setLocked(null); setRev((n) => n + 1);
    } catch (cause) { setLockErr(cause.message); } finally { setLockBusy(false); }
  };

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
    fetch(readUrl, { headers: { ...authHeaders(), ...(getUnlock() ? { 'X-Share-Unlock': getUnlock() } : {}) } })
      .then(async (response) => { const json = await response.json().catch(() => ({})); if (!response.ok) throw new Error(json.error || 'This link is not shared any more.'); return json; })
      .then((json) => {
        if (!live) return;
        if (json.locked) { setLocked(json); setWait(null); setData(null); return; }
        setLocked(null);
        if (json.unlock) { try { sessionStorage.setItem(unlockKey, json.unlock); } catch { /* none */ } }
        if (json.waiting) { setWait(json.waiting); setData(null); return; }
        setWait(null);
        draft.current = { title: json.title || '', content: json.content || '', base: json.updatedAt, baseContent: json.content || '' };
        if (json.kind === 'todo') taskSavedText.current = json.text;
        setConflict(null); setStatus('saved'); setData(json);
      })
      .catch((cause) => { if (live) setError(cause.message); });
    return () => { live = false; };
  }, [readUrl, rev]);

  // waiting at the door: knock every 3 seconds with my name; the page opens by itself once the owner lets me in
  useEffect(() => {
    if (wait !== 'waiting') return undefined;
    let live = true;
    const knock = () => fetch(`/api/public/${kindPath}/${encodeURIComponent(token)}/knock`, {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ sessionId: viewerSid(kindPath, token), name: nameRef.current || user?.name || undefined }),
    }).then(async (r) => {
      const b = await r.json().catch(() => ({}));
      if (!live) return;
      if (r.status === 403 || r.status === 404) { setWait(null); setError(b.error || 'This link is not shared any more.'); return; }
      if (b.status === 'admitted') { setWait(null); setRev((n) => n + 1); } else if (b.status === 'declined') setWait('declined');
    }).catch(() => { /* try again on the next beat */ });
    void knock();
    const t = window.setInterval(knock, 3000);
    return () => { live = false; window.clearInterval(t); };
  }, [wait, kindPath, token, user?.name]);

  useEffect(() => {
    if (!data || shareOff) return undefined;
    let live = true;
    const refresh = async () => {
      try {
        const response = await fetch(readUrl, { cache: 'no-store', headers: authHeaders() });
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
        if (latest.waiting) { setData(null); setWait(latest.waiting); return; }
        const current = shareStateRef.current;
        if (live && typeof latest.canEdit === 'boolean' && latest.canEdit !== current.data?.canEdit) setData((c) => (c ? { ...c, canEdit: latest.canEdit } : c)); // the owner changed my role
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
  }, [data?.kind, shareOff, readUrl]);

  const put = useCallback(async (payload) => {
    const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(getUnlock() ? { 'X-Share-Unlock': getUnlock() } : {}) }, body: JSON.stringify({ sessionId: viewerSid(kindPath, token), ...payload }) });
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

  // a save was refused with 403: the owner may have changed my role or taken the page back, which is not an error page
  const denied = (body) => {
    if (body?.waiting) { setData(null); setWait(body.waiting); return; }
    if (body?.removed) { setData(null); setError(body.error || 'The owner removed you from this page.'); return; }
    setData((c) => (c ? { ...c, canEdit: false } : c));
    setStatus('saved');
    showToast('The owner changed your access. You can view this page now.');
  };
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
      if (response.status === 403) { denied(response.body); return; }
      if (response.status === 404) { setError(response.body.error || 'This link is not available.'); return; }
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
      else if (response.status === 403) denied(response.body);
      else if (response.status === 404) { setData(null); setShareOff(true); setError(response.body.error || 'This share link is no longer available.'); }
      else { setStatus(response.status === 409 ? 'conflict' : 'error'); }
    } catch { setStatus('error'); }
  };

  const body = useMemo(() => {
    const html = data?.kind === 'note' ? toHtml(data.content) : data?.note ? toHtml(data.note.content) : '';
    return data?.kind === 'note' ? withoutTitleHeading(html, data.title) : html;
  }, [data]);
  useFileFrames(docRef, body);
  // a picture on a read-only page opens full size, with Copy and Save (the page is plain HTML, so one click listener covers every picture)
  const [viewPic, setViewPic] = useState(null);
  useEffect(() => {
    const root = docRef.current; if (!root) return undefined;
    const click = (e) => {
      const cc = e.target?.closest?.('[data-code-copy]');
      if (cc) { const code = cc.closest('pre'); const text = (code?.querySelector('code') || code)?.textContent || ''; const done = () => { cc.textContent = 'Copied'; setTimeout(() => { cc.textContent = 'Copy'; }, 1400); }; (navigator.clipboard?.writeText ? navigator.clipboard.writeText(text).then(done, () => {}) : Promise.resolve()); return; }
      const pb = e.target?.closest?.('[data-pill-copy]');
      if (pb) { const text = pb.getAttribute('data-pill-copy'); const done = () => { const old = pb.textContent; pb.textContent = 'Copied'; setTimeout(() => { pb.textContent = old; }, 1400); }; (navigator.clipboard?.writeText ? navigator.clipboard.writeText(text).then(done, () => {}) : Promise.resolve()); return; }
      const img = e.target?.closest?.('img'); if (!img || img.closest('a, button')) return; const all = [...root.querySelectorAll('img')].filter((n) => !n.closest('a, button')); setViewPic({ src: img.currentSrc || img.src, name: img.getAttribute('alt') || '', list: all.map((n) => ({ src: n.currentSrc || n.src, name: n.getAttribute('alt') || '' })), index: Math.max(0, all.indexOf(img)) }); };
    root.addEventListener('click', click);
    return () => root.removeEventListener('click', click);
  }, [body]);
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
      body: JSON.stringify({ sessionId, active, typing: active && Date.now() - typedAt.current < 3000, name: nameRef.current || undefined, cursor: cursorRef.current ?? undefined, selStart: selRef.current?.start, selEnd: selRef.current?.end, progress: Math.round(progressRef.current) }),
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
        return response.json().catch(() => ({})).then((b) => {
          setData(null);
          setViewers([]);
          if (b.waiting) setWait(b.waiting);
          else setError('The owner removed you from this page.'); // the owner took this person off the link
          return null;
        });
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
        if (typeof json.canEdit === 'boolean') setData((c) => (c && c.canEdit !== json.canEdit ? { ...c, canEdit: json.canEdit } : c));
      })
      .catch(() => { missed.current += 1; if (live && missed.current >= 2) setOffline(true); });
    void beat();
    // an editable link checks every 3 s so "someone is typing" feels live; a read-only link only needs to be counted
    // (the beat does not restart when my role changes: restarting sent a "left" that could land after the "here")
    let beatTimer;
    const loop = () => { beatTimer = window.setTimeout(() => { void beat(); loop(); }, canEditRef.current ? 3000 : 6000); };
    loop();
    const leave = () => { void beat(false, true); };
    window.addEventListener('pagehide', leave);
    return () => {
      live = false;
      window.clearTimeout(beatTimer);
      window.removeEventListener('pagehide', leave);
      void beat(false, true);
    };
  }, [data?.kind, kindPath, token, user?.id, shareOff]);

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
  const selfViewerId = viewers.find((viewer) => viewer.self)?.id || '';
  const myColor = peerColor(selfViewerId || sessionIdRef.current || guestName || 'guest');
  colorRef.current = myColor;
  useEffect(() => { if (selfViewerId) window.dispatchEvent(new CustomEvent('pb-identity', { detail: { color: myColor } })); }, [selfViewerId, myColor]);
  // The outline stands alone until someone else is here; then the live panel slides in (wide screens), and leaves with them.
  const wasOthers = useRef(0);
  useEffect(() => {
    const n = others.length;
    const wide = typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 1281px)').matches;
    if (wasOthers.current === 0 && n > 0 && wide) setPanelOpen(true);
    if (wasOthers.current > 0 && n === 0) setPanelOpen(false);
    wasOthers.current = n;
  }, [others.length]);
  const typers = others.filter((viewer) => viewer.typing);
  const typingText = typers.length === 1 ? `${typers[0].name}${typers[0].owner ? ' (owner)' : ''} is typing`
    : typers.length === 2 ? `${typers[0].name} and ${typers[1].name} are typing`
      : typers.length > 2 ? `${typers.length} people are typing` : '';

  const askExtend = async () => {
    try {
      const r = await fetch(`/api/public/${kindPath}/${encodeURIComponent(token)}/extend-request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: viewerSid(kindPath, token), name: nameRef.current || user?.name || undefined }) });
      if (r.ok) { setExtAsked(true); showToast('Asked the owner to keep this link going'); } else showToast('Could not ask the owner');
    } catch { showToast('Could not reach the owner'); }
  };
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
      progressRef.current = range > 0 ? Math.min(100, (scroller.scrollTop / range) * 100) : 100;
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
      let id = ''; try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { /* a malformed #fragment is ignored */ }
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
  const showJoin = !!(data?.canEdit && !user && !previewMode && !joined && !error);
  const [cardName, setCardName] = useState('');
  const joinNow = (anon) => { if (!anon) saveGuestName(cardName); markJoined(); };
  const [fly, setFly] = useState(null); // 'outline' | 'history' | 'file' (people uses panelOpen)
  const [wideScreen, setWideScreen] = useState(() => window.innerWidth > 1280);
  useEffect(() => { const on = () => setWideScreen(window.innerWidth > 1280); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
  const isNote = data?.kind === 'note';
  const hasToc = isNote && headings.length > 0;
  const pinnedToc = hasToc && tocOpen && wideScreen;
  const shownFly = panelOpen ? 'people' : fly === 'outline' && pinnedToc ? null : fly;
  const openFly = (name) => {
    if (name === 'outline' && pinnedToc) { toggleToc(); setFly(null); setPanelOpen(false); return; }
    setPanelOpen(name === 'people' ? !panelOpen : false);
    setFly(name === 'people' ? null : (fly === name ? null : name));
  };
  useEffect(() => {
    if (!shownFly) return undefined;
    const esc = (event) => { if (event.key === 'Escape') { setFly(null); setPanelOpen(false); } };
    const away = (event) => { if (!event.target.closest?.('.srail, .srail-fly, .cp-wrap, .cp-bar')) { setFly(null); if (window.innerWidth <= 1280) setPanelOpen(false); } };
    document.addEventListener('keydown', esc); document.addEventListener('click', away);
    return () => { document.removeEventListener('keydown', esc); document.removeEventListener('click', away); };
  }, [shownFly]);
  const secMins = (() => {
    const out = []; let cur = 0; let intro = 0; let started = false;
    String(data?.content || '').split('\n').forEach((line) => {
      if (/^#{1,3}\s+\S/.test(line)) { if (started) out.push(cur); started = true; cur = 0; } else if (started) cur += (line.match(/\S+/g) || []).length; else intro += (line.match(/\S+/g) || []).length;
    });
    if (started) out.push(cur);
    return { intro: Math.max(1, Math.ceil(intro / 200)), hasIntro: intro > 0, list: out.map((n) => Math.max(1, Math.ceil(n / 200))) };
  })();
  const activeIdx = headings.findIndex((h) => h.id === activeHeading);
  const tocLinks = <>
    {secMins.hasIntro && headings.length > 0 && <a key="__overview" href="#page-main" className={`toc-ov${activeIdx < 0 ? ' on' : ''}`} onClick={(event) => { event.preventDefault(); document.getElementById('page-main')?.scrollTo?.({ top: 0, behavior: 'smooth' }); if (!pinnedToc) setFly(null); }}><span className={`toc-dot ${activeIdx < 0 ? 'cur' : 'done'}`}>{activeIdx < 0 ? <i /> : <Check size={11} />}</span><span className="toc-t">Overview</span><span className="toc-min">{secMins.intro} min</span></a>}
    {headings.map(({ id, title, level }, index) => <a key={id} href={`#${id}`} onClick={(event) => { handleHeadingClick(event, id); if (!pinnedToc) setFly(null); }} className={`${activeHeading === id ? 'on' : ''}${level === 3 ? ' sub' : ''}`}><span className={`toc-dot ${index < activeIdx ? 'done' : index === activeIdx ? 'cur' : ''}`}>{index < activeIdx ? <Check size={11} /> : index === activeIdx ? <i /> : null}</span><span className="toc-t">{title}</span>{(sectionPeers[id] || []).length > 0 && <span className="toc-pips" data-testid="toc-pips">{sectionPeers[id].map((p) => <i key={p.id} title={`${p.name} is here`} style={{ background: peerColor(p.id) }} />)}</span>}<span className="toc-min">{secMins.list[index] || 1} min</span></a>)}
  </>;
  const commentsBtn = () => document.querySelector('.pb-shared .pb-cbtn');
  const handleHeadingClick = (event, id) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (window.location.hash !== `#${id}`) window.history.pushState(null, '', `#${id}`);
    scrollToHeading(id);
  };

  const shareRef = useRef(null);
  const [shareOpen, setShareOpen] = useState(false);
  useEffect(() => { if (!shareOpen) return undefined; const away = (e) => { if (!shareRef.current?.contains(e.target)) setShareOpen(false); }; document.addEventListener('mousedown', away); return () => document.removeEventListener('mousedown', away); }, [shareOpen]);
  const meRef = useRef(null);
  const [meOpen, setMeOpen] = useState(false);
  useEffect(() => { if (!meOpen) return undefined; const away = (e) => { if (!meRef.current?.contains(e.target)) setMeOpen(false); }; document.addEventListener('mousedown', away); return () => document.removeEventListener('mousedown', away); }, [meOpen]);
  const forgetMe = () => { try { localStorage.removeItem('peblo-guest-name'); localStorage.removeItem('peblo-guest-joined'); } catch { /* none */ } setGuestName(''); setMeOpen(false); showToast('Forgotten on this device'); };
  const [liveEmpty, setLiveEmpty] = useState(null);
  kbRef.current = {
    stepHeading: (dir) => { const hs = headings; if (!hs.length) return; const i = hs.findIndex((h) => h.id === activeHeading); const n = Math.min(hs.length - 1, Math.max(0, (i < 0 ? (dir > 0 ? 0 : 0) : i + dir))); scrollToHeading(hs[n].id); },
    toggleListen: () => toggleListen(),
    toggleTranslate: () => setTrOpen((o) => !o),
    openComments: () => { const b = document.querySelector('.pb-shared .pb-cbtn'); if (b) b.click(); else showToast('Comments are for people who can edit'); },
    toTop: () => articleRef.current?.scrollTo({ top: 0, behavior: 'smooth' }) || window.scrollTo({ top: 0, behavior: 'smooth' }),
    jumpPlace: () => { if (reader.place) reader.jumpPlace(); else showToast('No place saved yet'); },
    toggleTheme: () => setDarkMode((d) => !d),
    copyLink: () => copy(window.location.href, 'Share link copied'),
  };
  const [chgIdx, setChgIdx] = useState(-1);
  const chgEls = () => [...(articleRef.current?.querySelectorAll('[data-pb-chg="1"]') || [])];
  const goChange = (dir) => {
    const els = chgEls();
    if (!els.length) return;
    const next = chgIdx < 0 ? (dir > 0 ? 0 : els.length - 1) : (chgIdx + dir + els.length) % els.length;
    setChgIdx(next);
    els[next].scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  useEffect(() => { if (!reader.changes || !reader.showChanges) setChgIdx(-1); }, [reader.changes, reader.showChanges]);
  const [listening, setListening] = useState(false);
  const toggleListen = () => {
    if (!window.speechSynthesis) { showToast('Listening is not supported in this browser'); return; }
    setListening((on) => !on);
  };
  const listenParas = () => [...(articleRef.current?.querySelectorAll('.doc p, .doc h1, .doc h2, .doc h3, .doc li, .bn-block-content') || [])].map((el) => ({ el, text: (el.innerText || '').trim() })).filter((p) => p.text);
  const hilite = useCallback((el) => { document.querySelectorAll('[data-pb-say]').forEach((n) => n.removeAttribute('data-pb-say')); if (el) { el.setAttribute('data-pb-say', '1'); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }, []);
  const [trOpen, setTrOpen] = useState(false);
  const [trLang, setTrLang] = useState(null);
  const [trText, setTrText] = useState('');
  const [trBusy, setTrBusy] = useState(false);
  const trRef = useRef(null);
  useEffect(() => { if (!trOpen) return undefined; const away = (e) => { if (!trRef.current?.contains(e.target)) setTrOpen(false); }; document.addEventListener('mousedown', away); return () => document.removeEventListener('mousedown', away); }, [trOpen]);
  const pickLang = async (code) => {
    if (!code) { setTrLang(null); setTrText(''); setTrOpen(false); return; }
    setTrBusy(true);
    try {
      const r = await fetch(`/api/public/note/${encodeURIComponent(token)}/translate`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(getUnlock() ? { 'X-Share-Unlock': getUnlock() } : {}) }, body: JSON.stringify({ sessionId: viewerSid(kindPath, token), lang: code }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showToast(j.error || 'Translation is not available right now.'); } else { setTrLang(code); setTrText(j.text || ''); setTrOpen(false); }
    } catch { showToast('Translation is not available right now.'); } finally { setTrBusy(false); }
  };
  return (
    <div ref={rootRef} className={`pb-shared${fullscreen ? ' is-fs' : ''}${topHidden ? ' top-tucked' : ''}${look.quiet ? ' is-quiet' : ''}${reader.showChanges ? '' : ' no-chg'}`} data-theme={darkMode ? 'dark' : 'light'} data-size={look.size} data-width={look.width} data-font={look.font}>
      <div className="blobs" aria-hidden="true"><i /><i /><i /></div>
      <a className="skip-link" href="#page-main" onClick={(e) => { e.preventDefault(); document.getElementById('page-main')?.focus(); }}>Skip to content</a>
      <header className="top">
        <div className="top-in">
          <a className="brand" href="/" aria-label="Peblo home"><i />Peblo</a>
          {data && <div className="crumb"><ChevronRight className="sep" size={14} /><span>Shared page</span><ChevronRight className="sep" size={14} /><b title={pageTitle}>{pageTitle}</b></div>}
          {data && <button type="button" className="sp-bar" data-testid="palette-btn" aria-label="Search or jump to a heading" onClick={() => setPaletteOpen(true)}><SearchIcon size={15} /><span>Search or jump to a heading</span><kbd>Ctrl K</kbd></button>}
          <span className="spacer" />
          {data && viewers.length > 0 && <div className="hd-stack" data-testid="hd-stack" aria-label={`${viewers.length} on this page`}>{viewers.slice(0, 3).map((v) => <span key={v.id} className="hd-av" title={v.name} style={{ background: v.self ? myColor : peerColor(v.id) }}>{(v.name || 'G')[0].toUpperCase()}</span>)}{viewers.length > 3 && <span className="hd-av more">+{viewers.length - 3}</span>}</div>}
          {data && <span className={`pill ${data.canEdit ? 'edit' : 'view'}`}>{data.canEdit ? <Pencil size={15} /> : <Eye size={15} />}{data.canEdit ? 'Can edit' : 'Can view'}</span>}
          {data?.canEdit && <button className={`btn preview-btn${previewMode ? ' active' : ''}`} type="button" aria-pressed={previewMode} onClick={() => { setPreviewMode((value) => !value); setMenuOpen(false); }} title={previewMode ? 'Return to editing' : 'Preview the page as viewers see it'}>
            {previewMode ? <Pencil size={16} /> : <Eye size={16} />}<span>{previewMode ? 'Edit page' : 'Preview'}</span>
          </button>}
          {data?.canEdit && previewMode && <div className="seg preview-roles" role="group" aria-label="Preview as" data-testid="preview-roles"><button type="button" className="on" aria-pressed="true">View only</button><button type="button" data-testid="preview-as-edit" aria-pressed="false" onClick={() => setPreviewMode(false)}>Can edit</button></div>}
          {data && <button className={`btn primary save-btn${savedCopy ? ' is-saved' : ''}`} type="button" aria-label={savedCopy ? 'Open saved copy in Peblo' : 'Save to my Peblo'} disabled={saveBusy} onClick={() => savedCopy ? navigate(savedCopy.kind === 'note' ? `/notes/${savedCopy.id}` : '/tasks') : saveSharedCopy()}>
            {saveBusy ? <LoaderCircle className="spin" size={16} /> : savedCopy ? <Check size={16} /> : <Clipboard size={16} />}
            <span>{saveBusy ? 'Saving…' : savedCopy ? 'Open in Peblo' : 'Save to my Peblo'}</span>
          </button>}
          {data && <button className="btn copy-btn" type="button" onClick={() => copy(window.location.href, 'Share link copied')}><Link2 size={17} /><span>Copy link</span></button>}
          {data && <button className="btn icon" type="button" data-testid="fs-btn" aria-label="Full screen" title="Full screen (F)" onClick={toggleFullscreen}><Maximize2 size={18} /></button>}
          {data && <div className="menu-wrap mw-look" ref={lookRef}>
            <button className="btn icon" type="button" data-testid="look-btn" aria-label="Appearance" aria-haspopup="dialog" aria-expanded={lookOpen} title="Appearance" onClick={() => { setLookOpen((o) => !o); setMenuOpen(false); }}><Type size={18} /></button>
            {lookOpen && <div className="menu look-menu" role="dialog" aria-label="Appearance" data-testid="look-menu">
              <h4>Appearance</h4>
              <div className="look-row"><span>Text size</span><div className="seg" role="group" aria-label="Text size">{[['s', 'A−'], ['m', 'A'], ['l', 'A+'], ['xl', 'A++']].map(([v, l]) => <button key={v} type="button" className={look.size === v ? 'on' : ''} aria-pressed={look.size === v} data-testid={`look-size-${v}`} onClick={() => setLookPref({ size: v })}>{l}</button>)}</div></div>
              <div className="look-row"><span>Zoom</span><div className="seg" role="group" aria-label="Zoom">{[90, 100, 125, 150].map((v) => <button key={v} type="button" data-testid={`look-zoom-${v}`} className={(look.zoom || 100) === v ? 'on' : ''} aria-pressed={(look.zoom || 100) === v} onClick={() => setLookPref({ zoom: v })}>{v}%</button>)}</div></div>
              <div className="look-row"><span>Page width</span><div className="seg" role="group" aria-label="Page width">{[['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']].map(([v, l]) => <button key={v} type="button" className={look.width === v ? 'on' : ''} aria-pressed={look.width === v} data-testid={`look-width-${v}`} onClick={() => setLookPref({ width: v })}>{l}</button>)}</div></div>
              <div className="look-row"><span>Font</span><div className="seg" role="group" aria-label="Font">{[['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono']].map(([v, l]) => <button key={v} type="button" className={look.font === v ? 'on' : ''} aria-pressed={look.font === v} data-testid={`look-font-${v}`} onClick={() => setLookPref({ font: v })}>{l}</button>)}</div></div>
              <div className="look-row"><span>Style</span><div className="seg" role="group" aria-label="Style">{[['follow', 'Owner'], ['soft', 'Soft'], ['river', 'River'], ['orbit', 'Orbit']].map(([v, l]) => <button key={v} type="button" className={(look.style || 'follow') === v ? 'on' : ''} aria-pressed={(look.style || 'follow') === v} data-testid={`look-style-${v}`} onClick={() => setLookPref({ style: v })}>{l}</button>)}</div></div>
              <div className="look-row"><span>Theme</span><div className="seg" role="group" aria-label="Theme">{[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => <button key={v} type="button" className={(look.theme || 'system') === v ? 'on' : ''} aria-pressed={(look.theme || 'system') === v} onClick={() => { setLookPref({ theme: v }); setDarkMode(v === 'system' ? !!window.matchMedia?.('(prefers-color-scheme: dark)').matches : v === 'dark'); }}>{l}</button>)}</div></div>
              <label className="look-check"><input type="checkbox" data-testid="look-pointers" checked={look.pointers} onChange={(event) => setLookPref({ pointers: event.target.checked })} /><span>Show other people's pointers</span></label>
              <label className="look-check"><input type="checkbox" data-testid="look-quiet" checked={look.quiet} onChange={(event) => setLookPref({ quiet: event.target.checked })} /><span>Quiet mode (no pills, no join notices)</span></label>
              <label className="look-check"><input type="checkbox" data-testid="look-pin" checked={look.pin} onChange={(event) => setLookPref({ pin: event.target.checked })} /><span>Keep the tool bar showing</span></label>
              <button type="button" className="look-reset" onClick={() => setLookPref({ size: 'm', width: 'normal', font: 'sans', zoom: 100 })}><RotateCcw size={15} />Reset reading style</button>
            </div>}
          </div>}
          {data && <button className="btn icon" type="button" data-testid="moon-btn" aria-label={darkMode ? 'Switch to light' : 'Switch to dark'} title={darkMode ? 'Light' : 'Dark'} onClick={() => setDarkMode((d) => !d)}>{darkMode ? <Sun size={18} /> : <Moon size={18} />}</button>}
          {data && <div className="menu-wrap mw-me" ref={meRef}>
            <button type="button" className="hd-me" data-testid="hd-me" aria-haspopup="dialog" aria-expanded={meOpen} aria-label="Your identity" title={guestName || user?.name || 'Guest'} style={{ background: myColor }} onClick={() => setMeOpen((o) => !o)}>{((guestName || user?.name || 'G')[0] || 'G').toUpperCase()}</button>
            {meOpen && <div className="menu id-menu" role="dialog" aria-label="Your identity" data-testid="id-menu">
              <div className="id-head"><span className="hd-me" style={{ background: myColor }}>{((guestName || user?.name || 'G')[0] || 'G').toUpperCase()}</span><div><b>{guestName || user?.name || 'Guest'}</b><small>{user ? 'Signed in' : 'Guest on this page'}</small></div></div>
              {!user && <><h4>Your name</h4><input className="id-name" data-testid="id-name" aria-label="Your name" maxLength={40} placeholder="Guest" defaultValue={guestName} onBlur={(e) => saveGuestName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} /></>}
              <div className="id-colour"><i style={{ background: myColor }} /><span>Your colour is chosen for you and stays the same on this browser.</span></div>
              {!user && <button type="button" role="menuitem" data-testid="id-signin" onClick={() => { setMeOpen(false); setAuthMode('login'); setAuthOpen(true); }}><User size={17} /><span>Sign in<small>To keep your name everywhere</small></span></button>}
              {!user && <button type="button" role="menuitem" data-testid="id-forget" onClick={forgetMe}><RotateCcw size={17} /><span>Forget me on this device<small>Clears name and colour</small></span></button>}
              <button type="button" role="menuitem" data-testid="id-leave" onClick={() => { setMeOpen(false); navigate('/'); }}><LogOut size={17} /><span>Leave this page</span></button>
            </div>}
          </div>}
          {data && <div className="menu-wrap mw-share" ref={shareRef}>
            <button className="btn share-btn" type="button" data-testid="share-btn" aria-haspopup="dialog" aria-expanded={shareOpen} onClick={() => setShareOpen((o) => !o)}><Share2 size={16} /><span>Share</span></button>
            {shareOpen && <SharePanel kindPath={kindPath} token={token} hasPassword={!!data.hasPassword} summary={data.summary || ''} onSummary={(text) => setData((d) => ({ ...d, summary: text || null }))} link={window.location.href} canEdit={!!data.canEdit} expiresAt={data.expiresAt} title={data.title || data.text} isOwner={isOwner && !shareOff} onCopy={() => copy(window.location.href, 'Share link copied')} onTurnOff={() => { setShareOpen(false); setRevokeConfirm(true); }} />}
          </div>}
          {data && <div className="menu-wrap mw-more" ref={menuRef}>
            <button className="btn icon" type="button" aria-label="More options" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={19} /></button>
            {menuOpen && <div className="menu" role="menu">
              <h4>Share and export</h4>
              <div className="linkbox"><input readOnly value={window.location.href} aria-label="Share link" /><button className="btn dark" type="button" onClick={() => copy(window.location.href)}>Copy</button></div>
              <hr />
              <button type="button" role="menuitem" onClick={() => exportShared('md')}><Download size={17} /><span>Download as Markdown<small>Keep your note formatting</small></span></button>
              <button type="button" role="menuitem" onClick={() => exportShared('pdf')}><FileText size={17} /><span>Download as PDF<small>Ready to share or print</small></span></button>
              <button type="button" role="menuitem" onClick={() => exportShared('doc')}><FileText size={17} /><span>Download as Word<small>Editable .doc document</small></span></button>
              <button type="button" role="menuitem" onClick={() => exportShared('html')}><FileText size={17} /><span>Download as HTML</span></button>
              <button type="button" role="menuitem" onClick={() => exportShared('txt')}><FileText size={17} /><span>Download as plain text</span></button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); exportDocs([{ title: data?.title || data?.text || 'Untitled', content: data?.content || data?.note?.content || '' }], 'print', pageTitle).catch((cause) => showToast(cause.message || 'Could not open print dialog')); }}><Printer size={17} /><span>Print<small>Opens the print dialog</small></span></button>
              <button type="button" role="menuitem" onClick={() => copy(data?.kind === 'todo' ? `${data.text}\n\n${data.note?.content || ''}` : `# ${data?.title || 'Untitled'}\n\n${data?.content || ''}`, 'Note text copied')}><Clipboard size={17} /><span>Copy as Markdown</span></button>
              <button type="button" role="menuitem" onClick={() => { setDarkMode((dark) => !dark); setMenuOpen(false); }}>{darkMode ? <Sun size={17} /> : <Moon size={17} />}<span>{darkMode ? 'Light mode' : 'Dark mode'}</span></button>
              {isOwner && !shareOff && <><hr /><button className="danger" type="button" role="menuitem" onClick={() => { setRevokeConfirm(true); setMenuOpen(false); }}><X size={17} /><span>Turn sharing off<small>Only the owner sees this</small></span></button></>}
              <hr />
              <div className="menu-note">Anyone with this link can {data?.canEdit ? 'edit' : 'read'} this {data?.kind === 'todo' ? 'task' : 'note'}.</div>
            </div>}
          </div>}
        </div>
        <div className="progress" aria-hidden="true"><i style={{ width: `${scrollProgress}%` }} /></div>
      </header>
      {showJoin && <div className="join-back" data-testid="join-back"><div className="join-card" role="dialog" aria-modal="true" aria-label="Join this page" data-testid="join-card" onKeyDown={(event) => { if (event.key === 'Escape') joinNow(true); }}>
        <div className="join-prev"><span className="join-big" style={{ background: myColor, boxShadow: `0 0 0 5px ${myColor}33` }}>{(cardName.trim()[0] || 'G').toUpperCase()}</span><div><h3>Join {data.title || 'this page'}</h3><p>{data.author ? `${data.author} shared this page.` : 'This page was shared with you.'}{others.length > 0 ? ` ${others.length === 1 ? '1 person is' : `${others.length} people are`} here now.` : ''}</p></div></div>
        <label className="join-lbl">Your name<input aria-label="Your name" autoFocus maxLength={40} placeholder="Guest" value={cardName} onChange={(event) => setCardName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') joinNow(false); }} /></label>
        <div className="join-auto" data-testid="join-auto-colour"><i style={{ background: myColor }} /><span>Your colour is picked for you, so everyone can tell who is who.</span></div>
        <div className="join-mem"><Lock size={14} />Remembered in this browser only. Others see your name and colour on your cursor.</div>
        <div className="join-btns"><button type="button" className="btn primary" data-testid="join-submit" onClick={() => joinNow(false)}>{cardName.trim() ? `Join as ${cardName.trim()}` : 'Join'}</button><button type="button" className="btn" data-testid="join-anon" onClick={() => joinNow(true)}>Just read, stay anonymous</button></div>
      </div></div>}
      {data && !error && <nav className="srail" aria-label="Page panels" data-testid="srail">
        {hasToc && <button type="button" className={pinnedToc || shownFly === 'outline' ? 'on' : ''} data-testid="rail-outline" aria-label="Outline" aria-pressed={pinnedToc || shownFly === 'outline'} title="Outline [" onClick={() => openFly('outline')}><List size={19} /></button>}
        <button type="button" className={shownFly === 'people' ? 'on' : ''} data-testid="rail-people" aria-label="People" aria-pressed={shownFly === 'people'} title="People ]" onClick={() => openFly('people')}><Users size={19} />{others.length > 0 && <i className="srail-n">{others.length}</i>}</button>
        <button type="button" data-testid="rail-comments" aria-label="Comments" title={data.canEdit && isNote ? 'Comments' : 'Comments are for people who can edit'} disabled={!(data.canEdit && isNote)} onClick={() => { setFly(null); setPanelOpen(false); commentsBtn()?.click(); }}><MessageSquare size={19} /></button>
        <button type="button" className={shownFly === 'history' ? 'on' : ''} data-testid="rail-history" aria-label="History" aria-pressed={shownFly === 'history'} title="History" disabled={!isNote} onClick={() => openFly('history')}><History size={19} />{(reader.changes || reader.place) && <i className="srail-dot" />}</button>
        <button type="button" className={shownFly === 'file' ? 'on' : ''} data-testid="rail-file" aria-label="File" aria-pressed={shownFly === 'file'} title="File" onClick={() => openFly('file')}><FileIcon size={19} /></button>
      </nav>}
      {data && !error && shownFly === 'outline' && hasToc && <aside className="srail-fly" data-testid="fly-outline" aria-label="On this page">
        <div className="fly-head"><b>On this page</b><button type="button" className="toc-toggle" data-testid="toc-toggle" aria-label="Pin outline" title="Pin outline" onClick={() => { toggleToc(); setFly(null); }}><Pin size={16} /></button></div>
        <div className="toc-list">{tocLinks}</div>
        <div className="fly-prog"><span>Reading progress {Math.round(scrollProgress)} percent</span><i><b style={{ width: `${Math.min(100, Math.round(scrollProgress))}%` }} /></i></div>
      </aside>}
      {data && !error && shownFly === 'people' && <div className="srail-fly people cp-drawer docked" data-testid="fly-people">
            <CollabPanel
              mode="guest" viewers={viewers} canEdit={!!data.canEdit} events={collab.events} offline={offline} synced={synced} onRetry={() => { missed.current = 0; setRev((n) => n + 1); }}
              muted={collab.muted} onMute={collab.setMuted} onClearEvents={collab.clear} onClose={() => setPanelOpen(false)}
              followId={followId} onFollow={setFollowId}
            />
      </div>}
      {data && !error && shownFly === 'history' && isNote && <aside className="srail-fly" data-testid="fly-history" aria-label="History">
        <div className="fly-head"><b>History</b></div>
        {reader.changes && <div className="fly-row"><History size={16} /><div><b>{reader.changes.count} change{reader.changes.count > 1 ? 's' : ''} since your last visit</b><small>{new Date(reader.changes.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></div></div>}
        {reader.changes && reader.showChanges && <button type="button" className="fly-btn" data-testid="fly-next-change" onClick={() => goChange(1)}><ArrowDown size={15} />Next change</button>}
        {reader.changes && <button type="button" className="fly-btn" data-testid="fly-marks" onClick={() => reader.setShowChanges((v) => !v)}>{reader.showChanges ? 'Hide marks' : 'Show marks'}</button>}
        {reader.place && <div className="fly-row"><Clock size={16} /><div><b>You stopped at {reader.place.title}</b></div></div>}
        {reader.place && <button type="button" className="fly-btn" data-testid="fly-jump" onClick={() => { reader.jumpPlace(); setFly(null); }}>Jump back</button>}
        {!reader.changes && !reader.place && <p className="fly-empty">Nothing new since you were last here.</p>}
        <ShareVersions token={token} sid={sessionIdRef.current || viewerSid(kindPath, token)} unlock={getUnlock()} name={nameRef.current || user?.name || 'Guest'}
          onCompare={(text, at) => { const n = reader.compareWith(text, at); showToast(n ? `${n} line${n > 1 ? 's' : ''} differ from that version` : 'Same as that version'); setTimeout(() => goChange(1), 1300); setFly(null); }}
          onRestored={() => { showToast('Version restored. Today was kept as a version.'); setRev((n) => n + 1); setFly(null); }} onError={(m) => showToast(m)} />
        <button type="button" className="fly-btn" data-testid="fly-bookmarks" onClick={() => { setBmOpen(true); setFly(null); }}><Bookmark size={15} />My bookmarks{reader.bookmarks.length > 0 ? ` (${reader.bookmarks.length})` : ''}</button>
      </aside>}
      {data && !error && shownFly === 'file' && <aside className="srail-fly" data-testid="fly-file" aria-label="File">
        <div className="fly-head"><b>{data.title || data.text || 'Shared page'}</b></div>
        <button type="button" className="fly-item" disabled={saveBusy} onClick={() => { setFly(null); if (savedCopy) navigate(savedCopy.kind === 'note' ? `/notes/${savedCopy.id}` : '/tasks'); else saveSharedCopy(); }}><Clipboard size={16} />{savedCopy ? 'Open in Peblo' : 'Save to my Peblo'}</button>
        <button type="button" className="fly-item" onClick={() => { copy(window.location.href, 'Share link copied'); setFly(null); }}><Link2 size={16} />Copy link</button>
        <hr />
        <button type="button" className="fly-item" onClick={() => { exportShared('md'); setFly(null); }}><Download size={16} />Markdown</button>
        <button type="button" className="fly-item" onClick={() => { exportShared('pdf'); setFly(null); }}><FileText size={16} />PDF</button>
        <button type="button" className="fly-item" onClick={() => { exportShared('doc'); setFly(null); }}><FileText size={16} />Word</button>
        <button type="button" className="fly-item" onClick={() => { exportShared('html'); setFly(null); }}><FileText size={16} />HTML</button>
        <button type="button" className="fly-item" onClick={() => { exportShared('txt'); setFly(null); }}><FileText size={16} />Plain text</button>
      </aside>}

      {shareOff && <div className="share-off-banner" role="status"><Check size={17} /><span><b>Sharing is off.</b> This link no longer works for other people.</span></div>}

      {locked && !data && !error ? (
        <main className="stage"><section className="gone lock-room" role="dialog" aria-label="Password needed" data-testid="lock-room"><div className="orb" aria-hidden="true"><span><Lock size={26} /></span></div>
          <h1>This page has a password</h1>
          <p>{locked.author ? `${locked.author} protected this page.` : 'The owner protected this page.'} Type the password they gave you.</p>
          <form className="lock-form" onSubmit={submitLock}>
            <input type="password" autoFocus aria-label="Password" data-testid="lock-input" placeholder="Password" value={lockPw} maxLength={100} autoComplete="off" onChange={(e) => { setLockPw(e.target.value); setLockErr(''); }} />
            <button type="submit" className="btn dark" data-testid="lock-open" disabled={!lockPw || lockBusy}>{lockBusy ? 'Checking' : 'Open page'}</button>
          </form>
          {lockErr && <p className="lock-err" role="alert" data-testid="lock-error"><AlertTriangle size={14} />{lockErr}</p>}
        </section></main>
      ) : wait && !data && !error ? (
        <main className="stage"><section className={`gone wait-room${wait === 'declined' ? ' is-declined' : ''}`} role="status" data-testid="waiting-room"><div className="orb" aria-hidden="true"><span>{wait === 'declined' ? <Ban size={26} /> : <Clock size={26} />}</span></div>
          <h1>{wait === 'declined' ? 'The owner did not let you in' : 'Waiting to be let in'}</h1>
          <p>{wait === 'declined' ? 'You can ask them to send the link again, or sign in if you have an account.' : 'The owner will see your name and can let you in. This page opens by itself.'}</p>
          {wait !== 'declined' && <label className="wait-name">Your name<input aria-label="Your name" data-testid="wait-name" value={waitName} maxLength={40} placeholder="Guest" onChange={(e) => { setWaitName(e.target.value); setGuestName(e.target.value.trim().slice(0, 40)); }} onBlur={(e) => saveGuestName(e.target.value)} /></label>}
          {wait === 'declined' && <div className="gone-btns"><button type="button" className="btn dark" data-testid="ask-again" onClick={() => window.location.reload()}>Ask again</button><button type="button" className="btn" data-testid="gone-signin" onClick={() => { setAuthMode('login'); setAuthOpen(true); }}>Sign in</button></div>}
        </section></main>
      ) : error ? (
        <main className="stage"><section className="gone is-gone" role="alert" data-testid="link-gone"><div className="orb" aria-hidden="true"><span><Ban size={26} /></span></div><h1>This link isn’t available</h1><p>{error}</p><div className="gone-btns"><button type="button" className="btn dark" data-testid="ask-owner" onClick={() => copy(`Hi, the link you shared with me is not working any more. Could you send me a new one?`, 'Message copied. Send it to the owner.')}>Ask the owner</button><a className="btn" href="/">Go to Peblo</a></div></section></main>
      ) : !data ? (
        <main className="stage"><section className="skel" data-testid="page-loading" role="status" aria-live="polite"><i className="sk t" /><span className="sk-row"><i className="sk dot" /><i className="sk s" /></span><i className="sk big" /><i className="sk l" /><i className="sk l m" /><i className="sk l" /><i className="sk l s" /><i className="sk pill" /><i className="sk big" /><span className="skel-pill"><LoaderCircle className="spin" size={14} />Opening the page<span className="sr-only"> Loading your shared page…</span></span></section></main>
      ) : (
        <main className={`stage${data.kind === 'note' ? ' note-stage' : ''}${data.kind === 'todo' || headings.length === 0 ? ' task-stage' : ''}${pinnedToc ? '' : ' no-toc'}${panelOpen && wideScreen ? ' people-pinned' : ''}`}>
          {pinnedToc && <aside className="toc" aria-label="On this page">
            <div className="toc-head"><h2>On this page</h2><button type="button" className="toc-toggle" data-testid="toc-toggle" aria-pressed="true" aria-label="Unpin outline" title="Unpin outline" onClick={toggleToc}><Pin size={17} /></button></div>
            <div className="toc-card-top" data-testid="toc-time"><span className="toc-left"><Clock size={13} />{Math.max(1, Math.ceil(wordCount * (1 - scrollProgress / 100) / 200))} min left</span><div className="toc-bar" aria-hidden="true"><i style={{ width: `${scrollProgress}%` }} /></div></div>
            {tocLinks}
            {data.kind === 'note' && reader.bookmarks.length > 0 && <div className="toc-bm" data-testid="toc-bookmarks"><h3>Bookmarks</h3>{reader.bookmarks.slice(0, 4).map((b) => <button type="button" key={b.sig} onClick={() => reader.goBookmark(b.sig)}><Bookmark size={13} /><span>{b.title || b.text || 'Bookmark'}</span></button>)}</div>}
            <div className="toc-foot" data-testid="toc-foot">
              <button type="button" onClick={() => exportShared('pdf')}><Download size={17} />Export</button>
              <button type="button" onClick={() => setLookOpen(true)}><Type size={17} />Look</button>
              <button type="button" onClick={() => setKeysOpen(true)}><Keyboard size={17} />Keys</button>
              <button type="button" onClick={() => window.print()}><Printer size={17} />Print</button>
            </div>
            <div className="meta"><b>{Math.max(1, Math.ceil(wordCount / 200))} min read</b><br />Updated {when(data.updatedAt)}<br /><span>{data.canEdit ? 'Anyone with the link can edit' : 'Read only · no sign-in needed'}</span></div>
          </aside>}

          <article ref={articleRef} id="page-main" tabIndex={-1} style={look.zoom && look.zoom !== 100 ? { zoom: look.zoom / 100 } : undefined}>
            {followId && <FollowBanner who={viewers.find((v) => v.id === followId)} color={peerColor(followId)} onStop={() => setFollowId(null)} />}
            {data.kind === 'note' && reader.changes && reader.showChanges && chgIdx >= 0 && <div className="cmp-bar" data-testid="cmp-bar" role="status"><History size={15} /><span>Comparing now with {new Date(reader.changes.at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span><b>Change {chgIdx + 1} of {chgEls().length}</b><button type="button" aria-label="Previous change" onClick={() => goChange(-1)}><ArrowUp size={15} /></button><button type="button" aria-label="Next change" onClick={() => goChange(1)}><ArrowDown size={15} /></button><button type="button" aria-label="Close comparison" onClick={() => setChgIdx(-1)}><X size={14} /></button></div>}
            {data.kind === 'note' && <>
              {data.canEdit && !previewMode
                ? <textarea className="title-in" rows={1} aria-label="Title" key={`t${rev}`} defaultValue={data.title || ''} ref={fitTitle} onInput={(event) => fitTitle(event.currentTarget)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} onChange={(event) => { draft.current.title = event.target.value.replace(/\n/g, ' '); typedAt.current = Date.now(); queueSave(); }} />
                : <h1 className="title">{data.title || 'Untitled'}</h1>}
              <div className="title-tools" data-testid="title-tools">
                <button type="button" data-testid="tt-listen" className={listening ? 'on' : ''} aria-pressed={listening} aria-label={listening ? 'Stop listening' : 'Listen to this page'} title="Listen" onClick={toggleListen}><Volume2 size={17} /></button>
                <span className="menu-wrap" ref={trRef}><button type="button" data-testid="tt-translate" className={trLang ? 'on' : ''} aria-haspopup="menu" aria-expanded={trOpen} aria-label="Translate this page" title="Translate" onClick={() => setTrOpen((o) => !o)}><Languages size={17} /></button>{trOpen && <TranslateMenu current={trLang} busy={trBusy} onPick={pickLang} onClose={() => setTrOpen(false)} />}</span>
                {data.canEdit && isOwner && <button type="button" data-testid="tt-preview" aria-pressed={previewMode} aria-label="Preview" title="Preview" onClick={() => setPreviewMode((v) => !v)}><Eye size={17} /></button>}
                <button type="button" data-testid="tt-full" aria-label="Full screen" title="Full screen" onClick={toggleFullscreen}><Maximize2 size={17} /></button>
                <button type="button" data-testid="tt-text" aria-label="Text and reading style" title="Text" onClick={() => { setLookOpen(true); window.scrollTo?.({ top: 0 }); }}><Type size={17} /></button>
                <button type="button" data-testid="tt-more" aria-label="More options" title="More" onClick={() => setMenuOpen(true)}><MoreHorizontal size={17} /></button>
              </div>
              <div className="by">
                <span className="by-who"><span className="av" aria-hidden="true">{initials(data.author)}</span>
                <span>{data.author ? <><span className="by-pre">Shared by </span><b>{data.author}</b></> : 'Shared note'}</span></span><span className="dotsep">·</span>
                <span className="by-upd">Updated {when(data.updatedAt)}</span>
                <span className="dotsep">·</span><span data-testid="by-stats" className="by-stats" title={`Updated ${when(data.updatedAt)}`}><i className="by-dot" aria-hidden="true" /><span className="by-rt">{Math.max(1, Math.ceil(wordCount / 200))} min read · </span>{wordCount} words</span>
                <span className={`by-role ${data.canEdit ? 'edit' : 'view'}`}>{data.canEdit ? <Pencil size={13} /> : <Eye size={13} />}{data.canEdit ? 'Can edit' : 'Can view'}</span>
                {data.canEdit && <><span className="dotsep">·</span><span className={`status ${status}`} role="status">{status === 'saved' ? <Check size={15} /> : null}{statusText}</span></>}
                {data.expiresAt && <><span className="dotsep">·</span><span className={`expiry${new Date(data.expiresAt).getTime() - Date.now() < 86400000 ? ' soon' : ''}`} data-testid="link-expiry">Link ends {when(data.expiresAt)}</span>{!isOwner && new Date(data.expiresAt).getTime() > Date.now() && new Date(data.expiresAt).getTime() - Date.now() < 86400000 && (extAsked ? <span className="ext-asked" data-testid="extend-asked">Asked to keep it going</span> : <button type="button" className="ext-ask" data-testid="extend-ask" onClick={askExtend}>Ask to keep it going</button>)}</>}
              </div>
              {data.summary && <div className="sum-card" data-testid="page-summary"><span className="sum-ic" aria-hidden="true"><Sparkles size={16} /></span><div><div className="sum-cap">Summary by {data.author || 'the owner'}</div><p>{data.summary}</p></div></div>}
              {data.canEdit && !user && !previewMode && <div className={`welcome${guestName ? " named" : ""}`} data-testid="welcome">
                <label className="guest-name"><span>You are editing as</span>
                  <input aria-label="Your name" placeholder="Guest" maxLength={40} defaultValue={guestName} onBlur={(event) => saveGuestName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
                  <small>{guestName ? 'Others see this name' : 'Add a name so others know it is you'}</small></label>
              </div>}
              {conflict && <div className="conflict" role="alert">Someone else changed the same words while you were editing.<div className="conflict-actions"><button className="btn" type="button" onClick={() => { draft.current = { ...draft.current, title: conflict.title, content: conflict.content, base: conflict.updatedAt, baseContent: conflict.content }; setData((c) => ({ ...c, ...conflict })); setConflict(null); setStatus('saved'); setRev((n) => n + 1); }}>Load their version</button><button className="btn" type="button" onClick={() => saveNote(false, true)}>Keep both</button><button className="btn dark" type="button" onClick={() => saveNote(true)}>Keep mine</button></div></div>}
              {trLang && <div className="tr-bar" data-testid="tr-bar" role="status"><Languages size={15} /><span>Translated to {LANGUAGES.find(([c]) => c === trLang)?.[1]} by Peblo AI. The original is kept.</span><button type="button" onClick={() => pickLang(null)}>Show original</button></div>}
              {trLang ? <DocHtml innerRef={docRef} html={toHtml(trText)} /> : data.canEdit && !previewMode
                ? <Suspense fallback={<p className="loading">Loading editor…</p>}><BlockEditor key={`e${rev}${collabOff ? 'x' : ''}`} guest fullPage themeOverride={darkMode ? 'dark' : 'light'} initialContent={data.content}
                    collab={collabOff || localStorage.getItem('peblo-collab') === 'off' ? undefined : { share: token, unlock: getUnlock() || undefined, sid: sessionIdRef.current || undefined, name: nameRef.current || user?.name || 'Guest', color: colorRef.current || undefined }}
                    onCollabState={(state) => { collabState.current = state; }} onCollabFail={() => setCollabOff(true)} onChange={(markdown) => { draft.current.content = markdown; setLiveEmpty(!String(markdown).replace(/[#>*\-\s]/g, ''));  if (document.activeElement?.closest?.('.bn-editor')) typedAt.current = Date.now(); queueSave(); }} /></Suspense>
                : <DocHtml innerRef={docRef} html={body} />}
              {(liveEmpty === null ? !wordCount : liveEmpty) && !trLang && <div className="empty-page" data-testid="empty-page"><span className="ep-i"><Pencil size={18} /></span><b>This page is empty</b><p>{data.canEdit ? 'Start typing here. Everyone with the link sees it as you write.' : 'Nothing here yet. The owner has not written anything.'}</p></div>}
              {readerFind && <FindBar root={docRef} selector="" editable={false} onClose={() => setReaderFind(false)} />}
              {viewPic && <Suspense fallback={null}><PictureView src={viewPic.src} name={viewPic.name} list={viewPic.list} index={viewPic.index} onClose={() => setViewPic(null)} /></Suspense>}
              <PagePolls token={token} sid={viewerSid(kindPath, token)} getName={() => nameRef.current || user?.name} />
            </>}

            {data.kind === 'todo' && <>
              <section className="taskcard">
                <div className="chips">
                  <span className={`chip${data.priority === 'high' ? ' p' : ''}`}>{data.priority} priority</span>
                  {data.deadline && <span className="chip due" data-testid="todo-due"><Clock size={13} />Due {when(data.deadline)}</span>}
                  {data.completed && <span className="chip ok" data-testid="todo-done-chip"><Check size={13} />Done{data.completedAt ? ` ${when(data.completedAt)}` : ''}</span>}
                  {data.tags.map((tag) => <span key={tag} className="chip l">#{tag}</span>)}
                  {!data.canEdit && <span className="chip lock" data-testid="todo-lock"><Lock size={13} />Only editors can tick this</span>}
                </div>
                {data.canEdit && !previewMode ? <textarea className="task-title-in" rows={1} ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} aria-label="Task" value={data.text} onChange={(event) => { setData((current) => ({ ...current, text: event.target.value })); setStatus('saving'); }} onBlur={(event) => { const value = event.target.value.trim(); if (value && value !== taskSavedText.current) patchTask({ text: value }); else if (!value) setData((current) => ({ ...current, text: taskSavedText.current || current.text })); else setStatus('saved'); }} /> : <h1>{data.text}</h1>}
                <div className="by task-by"><span className="av" aria-hidden="true">{initials(data.author)}</span><span>{data.author ? <>Shared task from <b>{data.author}</b></> : 'Shared task'}</span>{data.canEdit && <span className={`status ${status}`} role="status">{status === 'saved' ? <Check size={15} /> : null}{statusText}</span>}</div>
                <button type="button" className={`check${data.completed ? ' done' : ''}`} aria-pressed={data.completed} disabled={!data.canEdit || previewMode} onClick={() => patchTask({ completed: !data.completed })}><span className="box">{data.completed && <Check size={17} />}</span><span className="t">{data.completed ? (data.canEdit && !previewMode ? 'Done (tap to undo)' : 'Done') : data.canEdit && !previewMode ? 'Mark as done' : 'To do'}</span></button>
                <div className="tmeta"><div><small>Due</small><b>{data.deadline ? when(data.deadline) : 'No due date'}</b></div><div><small>Priority</small><b>{data.priority}</b></div><div><small>Status</small><b>{data.completed ? 'Done' : 'To do'}</b></div></div>
              </section>
              {data.note && <><h2 className="linked">Linked note · {data.note.title || 'Untitled'}</h2><div className="doc" dangerouslySetInnerHTML={{ __html: body }} /></>}
            </>}

            {data.kind === 'note' && <EndOfPage token={token} sid={viewerSid(kindPath, token)} name={nameRef.current || user?.name || 'Guest'} canEdit={!!data.canEdit} owner={data.author} />}
            <section className="cta"><div><h2>{data.kind === 'todo' ? 'Keep every task in one place.' : 'Notes, tasks and an AI that reads them.'}</h2><p>Peblo keeps your notes, to-dos and calendar in one calm place.</p></div><a className="btn" href="/">Explore Peblo</a></section>
            <footer className="foot"><span>{data.canEdit ? 'Anyone with this link can edit' : 'Read only'} · Made with Peblo</span><span>Shared page</span></footer>
          </article>
          {data.kind === 'note' && !fullscreen && !look.quiet && <ShareTrack articleRef={articleRef} viewers={viewers} colorOf={peerColor} />}
          {data.kind === 'todo' && !fullscreen && <><TodoAbout data={data} /><TodoCards viewers={viewers} myColor={myColor} peerColor={peerColor} saved={!!savedCopy} busy={saveBusy} onSave={() => (savedCopy ? navigate(savedCopy.kind === 'note' ? `/notes/${savedCopy.id}` : '/tasks') : saveSharedCopy())} /></>}
          {data.kind === 'note' && !fullscreen && <ShareCards token={token} sid={sessionIdRef.current || viewerSid(kindPath, token)} name={nameRef.current || user?.name || 'Guest'} canEdit={!!data.canEdit} owner={data.author} canComment={!!data.canEdit && !previewMode} pageText={data.content || ''} headings={headings} changes={reader.changes} showChanges={reader.showChanges} onToggleChanges={() => reader.setShowChanges((v) => !v)} onHistory={() => openFly('history')} />}
        </main>
      )}
      {scrollProgress > 5 && <button className="totop" type="button" aria-label="Back to top" onClick={() => articleRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}><ArrowUp size={19} /></button>}
      {data && listening && <ListenBar getParagraphs={listenParas} onHighlight={hilite} onClose={() => setListening(false)} />}
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
        <p className="bm-sub">{reader.bookmarks.length} on this page</p>
        {reader.bookmarks.length === 0 && <div className="bm-empty-card" data-testid="bookmarks-empty"><span><Bookmark size={16} /></span><b>Empty state</b><p className="bm-empty">No bookmarks yet. Point at a line and press B, or use the flag at the line start.</p></div>}
        {reader.bookmarks.map((b) => <div className="bm-row" key={b.sig}><button type="button" className="bm-go" data-testid="bookmark-item" onClick={() => { reader.goBookmark(b.sig); setBmOpen(false); }}><Bookmark size={14} /><span>{b.title}<small>{when(b.at)}</small></span></button><button type="button" aria-label="Remove bookmark" onClick={() => { reader.removeBookmark(b.sig); showToast('Bookmark removed'); }}><X size={13} /></button></div>)}
        <button type="button" className="bm-add" data-testid="bookmark-add" onClick={() => { if (!reader.toggleBookmark()) showToast('Scroll to a line first'); }}>Bookmark the line at the top</button>
        <p className="bm-foot"><Lock size={13} />Kept in this browser only. The owner cannot see them.</p>
      </aside>}
      {data?.kind === 'note' && !fullscreen && (reader.changes || reader.place) && <div className="reader-pills">
        {reader.changes && <div className="rp" data-testid="changes-pill"><History size={16} /><div><b>{reader.changes.count} change{reader.changes.count > 1 ? 's' : ''} since your last visit</b><small>{new Date(reader.changes.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></div><button type="button" data-testid="changes-toggle" onClick={() => reader.setShowChanges((v) => !v)}>{reader.showChanges ? 'Hide marks' : 'Show marks'}</button><button type="button" aria-label="Dismiss" onClick={reader.dismissChanges}><X size={14} /></button></div>}
        {reader.place && !reader.changes && <div className="rp" data-testid="place-pill"><History size={16} /><div><b>You stopped at {reader.place.title}</b></div><button type="button" data-testid="place-jump" onClick={reader.jumpPlace}>Jump back</button><button type="button" aria-label="Dismiss" onClick={reader.dismissPlace}><X size={14} /></button></div>}
      </div>}
      {data?.kind === 'note' && !fullscreen && <GuestTour ready={!!data && !error && !showJoin} />}
      {paletteOpen && data && !error && <SharePalette
        headings={headings}
        onJump={(id) => { if (window.location.hash !== `#${id}`) window.history.pushState(null, '', `#${id}`); scrollToHeading(id); }}
        onClose={() => setPaletteOpen(false)}
        actions={[
          { id: 'link', title: 'Copy link to this page', icon: Link2, run: () => copy(window.location.href, 'Share link copied') },
          savedCopy ? { id: 'open', title: 'Open in Peblo', icon: Check, run: () => navigate(savedCopy.kind === 'note' ? `/notes/${savedCopy.id}` : '/tasks') } : { id: 'save', title: 'Save to my Peblo', icon: Clipboard, run: () => saveSharedCopy() },
          { id: 'fs', title: 'Focus mode', icon: Maximize2, hint: 'F', run: toggleFullscreen },
          isNote ? { id: 'find', title: 'Find in this page', icon: SearchIcon, hint: 'Ctrl F', run: () => setReaderFind(true) } : null,
          data.canEdit && isNote ? { id: 'comments', title: 'Open comments', icon: MessageSquare, run: () => commentsBtn()?.click() } : null,
          { id: 'pdf', title: 'Export as PDF', icon: Download, run: () => exportShared('pdf') },
          { id: 'md', title: 'Export as Markdown', icon: Download, run: () => exportShared('md') },
          { id: 'print', title: 'Print', icon: Printer, run: () => exportDocs([{ title: data?.title || data?.text || 'Untitled', content: data?.content || data?.note?.content || '' }], 'print', pageTitle).catch((cause) => showToast(cause.message || 'Could not open print dialog')) },
          { id: 'keys', title: 'Keyboard shortcuts', icon: Keyboard, hint: '?', run: () => setKeysOpen(true) },
          { id: 'theme', title: darkMode ? 'Switch to light theme' : 'Switch to dark theme', icon: darkMode ? Sun : Moon, run: () => setDarkMode((dark) => !dark) },
        ].filter(Boolean)}
      />}
      {keysOpen && <div className="sheet-back keys-back" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setKeysOpen(false); }}>
        <section className="keys-sheet" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" data-testid="keys-sheet">
          <header><h2>Keyboard shortcuts</h2><button type="button" aria-label="Close" onClick={() => setKeysOpen(false)}><X size={18} /></button></header>
          <div className="keys-cols">{[
            ['Move', [['Ctrl K', 'Command palette'], ['Ctrl F', 'Find in page'], ['J', 'Next heading'], ['K', 'Previous heading'], ['G G', 'Back to top'], ['Ctrl B', 'Jump to place you stopped']]],
            ['Read', [['F', 'Focus mode'], ['L', 'Listen'], ['T', 'Translate'], ['B', 'Bookmark this line'], ['Ctrl J', 'Switch theme'], ['Ctrl L', 'Copy link']]],
            ['Panels and help', [['[', 'Show or hide the outline'], [']', 'Show or hide people and comments'], ['\\', 'Hide both side panels'], ['/', 'Show or hide the tool bar'], ['C', 'Open comments'], ['?', 'This list']]],
          ].map(([h, rows]) => <div key={h} className="keys-col"><h3>{h}</h3><ul>{rows.map(([k, l]) => <li key={k}><span>{l}</span><kbd>{k}</kbd></li>)}</ul></div>)}</div>
        </section>
      </div>}
      {data && !error && <nav className="mbar" aria-label="Page actions" data-testid="mbar">
        {data.kind === 'note' && headings.length > 0 && <button type="button" aria-label="Outline" onClick={() => setTocSheet(true)}><List size={20} /><span>Outline</span></button>}
        <button type="button" aria-label="People" aria-pressed={panelOpen} onClick={() => setPanelOpen((open) => !open)}><Users size={20} /><span>People{others.length ? ` ${others.length}` : ''}</span></button>
        {data.kind === 'note' && <button type="button" aria-label="Comments" data-testid="mbar-comments" onClick={() => setCardsSheet(true)}><MessageSquare size={20} /><span>Comments</span></button>}
        {data.kind === 'note' && <button type="button" aria-label="History" data-testid="mbar-history" onClick={() => openFly('history')}><History size={20} /><span>History</span></button>}
        {data.kind !== 'note' && <button type="button" aria-label="Appearance" onClick={() => { setLookOpen(true); window.scrollTo?.({ top: 0 }); }}><Type size={20} /><span>Look</span></button>}
        {data.kind !== 'note' && <button type="button" aria-label="Copy link" onClick={() => copy(window.location.href, 'Share link copied')}><Link2 size={20} /><span>Link</span></button>}
        <button type="button" className="main" aria-label={savedCopy ? 'Open saved copy in Peblo' : 'Save to my Peblo'} disabled={saveBusy} onClick={() => savedCopy ? navigate(savedCopy.kind === 'note' ? `/notes/${savedCopy.id}` : '/tasks') : saveSharedCopy()}><Clipboard size={20} /><span>Save</span></button>
      </nav>}
      {cardsSheet && data.kind === 'note' && <div className="sheet-back" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCardsSheet(false); }}>
        <section className="sheet cards-sheet" role="dialog" aria-modal="true" aria-label="Comments and page cards" data-testid="cards-sheet">
          <header><h2>Comments</h2><button type="button" aria-label="Close" onClick={() => setCardsSheet(false)}><X size={18} /></button></header>
          <ShareCards sheet token={token} sid={sessionIdRef.current || viewerSid(kindPath, token)} name={nameRef.current || user?.name || 'Guest'} canEdit={!!data.canEdit} owner={data.author} canComment={!!data.canEdit && !previewMode} pageText={data.content || ''} headings={headings} changes={reader.changes} showChanges={reader.showChanges} onToggleChanges={() => reader.setShowChanges((v) => !v)} onHistory={() => { setCardsSheet(false); openFly('history'); }} />
        </section>
      </div>}
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
            {authMode === 'signup' && !authError && <small className="auth-hint">At least 8 characters.</small>}
            {authError && <div className="auth-error" role="alert"><AlertTriangle size={15} />{authError}</div>}
            <button className="btn primary modal-submit" type="submit" disabled={authBusy || !authEmail.trim() || !authPassword || (authMode === 'signup' && !authName.trim())}>{authBusy ? <><LoaderCircle className="spin" size={16} />Please wait…</> : authMode === 'signup' ? 'Create account and save' : 'Sign in and save'}</button>
          </form>
          <button className="auth-switch" type="button" disabled={authBusy} onClick={() => { setAuthMode((mode) => mode === 'login' ? 'signup' : 'login'); setAuthError(''); }}>{authMode === 'signup' ? 'Already have an account? Sign in' : 'New to Peblo? Create an account'}</button>
          {authMode === 'login' && authError && <a className="auth-switch" data-testid="auth-reset" href="/forgot-password">Forgot it? Reset password</a>}
        </section>
      </div>}
      {revokeConfirm && <div className="share-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRevokeConfirm(false); }}>
        <section className="share-modal revoke-modal" role="dialog" aria-modal="true" aria-labelledby="revoke-title">
          <button className="share-modal-close" type="button" aria-label="Close" onClick={() => setRevokeConfirm(false)}><X size={18} /></button>
          <span className="modal-kicker">You own this link</span>
          <h2 id="revoke-title">Turn sharing off?</h2>
          <p>Anyone using this link loses access straight away{others.length ? `, including the ${others.length} ${others.length === 1 ? 'person' : 'people'} here now` : ''}. You can create a new link later from Peblo.</p>
          <div className="modal-actions rv"><button className="btn danger-btn" type="button" data-testid="revoke-confirm" onClick={turnSharingOff}><Ban size={15} />Turn sharing off</button><button className="btn" type="button" onClick={() => setRevokeConfirm(false)}>Keep sharing</button></div>
        </section>
      </div>}
    </div>
  );
}
