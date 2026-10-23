import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { ArrowUp, Check, ChevronRight, Clipboard, Download, Eye, Link2, LoaderCircle, Moon, MoreHorizontal, Pencil, Printer, Sun, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { notesAPI, publicShareAPI, todosAPI } from '../api';
import { authHeaders } from '../api/token';
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
  const [activeHeading, setActiveHeading] = useState('');
  const [darkMode, setDarkMode] = useState(() => document.documentElement.classList.contains('theme-dark'));
  const [previewMode, setPreviewMode] = useState(false);
  const [viewers, setViewers] = useState([]);
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
  const taskSavedText = useRef(null);
  const timer = useRef(null);
  const toastTimer = useRef(null);
  const menuRef = useRef(null);
  const articleRef = useRef(null);
  const kindPath = kind === 'task' || kind === 'todo' ? 'todo' : 'note';
  const url = `/api/public/${kindPath}/${encodeURIComponent(token)}`;

  useEffect(() => {
    document.documentElement.classList.add('pb-public-share');
    const root = document.getElementById('root');
    const html = document.documentElement;
    let baselineDpr = window.devicePixelRatio || 1;
    try {
      const saved = Number(localStorage.getItem('peblo-share-base-dpr'));
      if (saved > 0) baselineDpr = saved;
      else localStorage.setItem('peblo-share-base-dpr', String(baselineDpr));
    } catch { /* Keep the current zoom as the baseline when storage is unavailable. */ }
    const syncCanvasScale = () => {
      const currentDpr = window.devicePixelRatio || baselineDpr;
      const viewportRatio = currentDpr / baselineDpr;
      html.style.setProperty('--pb-canvas-w', `clamp(1440px, calc(100vw * ${viewportRatio}), 2160px)`);
      html.style.setProperty('--pb-canvas-h', `max(900px, calc(100dvh * ${viewportRatio}))`);
      if (root) root.style.zoom = String(1 / viewportRatio);
    };
    syncCanvasScale();
    window.addEventListener('resize', syncCanvasScale);
    return () => {
      window.removeEventListener('resize', syncCanvasScale);
      root?.style.removeProperty('zoom');
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
        draft.current = { title: json.title || '', content: json.content || '', base: json.updatedAt };
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
        const latest = await response.json();
        if (!live || latest.updatedAt === data.updatedAt || status !== 'saved') return;
        draft.current = { title: latest.title || '', content: latest.content || '', base: latest.updatedAt };
        setData(latest);
        setRev((n) => n + 1);
      } catch { /* Keep the current page visible during a brief connection loss. */ }
    };
    const interval = window.setInterval(() => { void refresh(); }, 5000);
    return () => { live = false; window.clearInterval(interval); };
  }, [data, shareOff, status, url]);

  const put = useCallback(async (payload) => {
    const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }, [url]);

  const saveNote = useCallback(async (force = false) => {
    setStatus('saving');
    try {
      const response = await put({ title: draft.current.title, content: draft.current.content, baseUpdatedAt: draft.current.base, force });
      if (response.status === 409) { setConflict(response.body.latest); setStatus('conflict'); return; }
      if (response.status !== 200) throw new Error(response.body.error || 'Could not save.');
      draft.current.base = response.body.updatedAt; setConflict(null); setStatus('saved');
    } catch { setStatus('error'); }
  }, [put]);
  const queueSave = () => { setStatus('saving'); clearTimeout(timer.current); timer.current = setTimeout(() => saveNote(false), 1200); };
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

  const body = useMemo(() => (data?.kind === 'note' ? toHtml(data.content) : data?.note ? toHtml(data.note.content) : ''), [data]);
  const headings = useMemo(() => {
    if (!body) return [];
    const parsed = new DOMParser().parseFromString(body, 'text/html');
    return [...parsed.body.querySelectorAll('h2, h3')].map((heading) => ({ id: heading.id, title: heading.textContent.trim(), level: Number(heading.tagName.slice(1)) }));
  }, [body]);
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
    const presenceUrl = `/api/public/${kindPath}/${encodeURIComponent(token)}/presence`;
    let live = true;
    const beat = (active = true, keepalive = false) => fetch(presenceUrl, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ sessionId, active }),
      keepalive,
    }).then((response) => {
      if (response.status === 404 && live) {
        setData(null);
        setViewers([]);
        setShareOff(true);
        setError('This share link expired or was turned off. Ask the owner for a new link.');
        return null;
      }
      return response.ok ? response.json() : null;
    })
      .then((json) => { if (live && json?.viewers) setViewers(json.viewers); })
      .catch(() => {});
    void beat();
    const interval = window.setInterval(() => { void beat(); }, 12_000);
    const leave = () => { void beat(false, true); };
    window.addEventListener('pagehide', leave);
    return () => {
      live = false;
      window.clearInterval(interval);
      window.removeEventListener('pagehide', leave);
      void beat(false, true);
    };
  }, [data?.kind, kindPath, token, user?.id, shareOff]);

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
  const downloadMarkdown = () => {
    const text = data?.kind === 'todo'
      ? `# ${data.text}\n\n- [${data.completed ? 'x' : ' '}] ${data.text}\n\n${data.note?.content || ''}`
      : `# ${data?.title || 'Untitled'}\n\n${data?.content || ''}`;
    const blobUrl = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `${(pageTitle || 'peblo-note').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'peblo-note'}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    showToast('Markdown downloaded');
    setMenuOpen(false);
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
    const updateProgress = () => {
      const scroller = articleRef.current;
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
    }, { root: articleRef.current, rootMargin: '-30px 0px -72% 0px' });
    headings.forEach(({ id }) => { const element = document.getElementById(id); if (element) observer.observe(element); });
    return () => observer.disconnect();
  }, [headings, data]);

  return (
    <div className="pb-shared" data-theme={darkMode ? 'dark' : 'light'}>
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
          {data && viewers.length > 0 && <div className="avatars" aria-label={`${viewers.length} people viewing this page`} title={`${viewers.length} viewing now`}>
            {viewers.slice(0, 3).map((viewer, index) => <span key={viewer.id} className={`av viewer-avatar avatar-${index}`} title={`${viewer.name}${viewer.self ? ' (you)' : ''}`} aria-label={`${viewer.name}${viewer.self ? ' (you)' : ''}`}>{initials(viewer.name)}</span>)}
            {viewers.length > 3 && <span className="av avatar-extra">+{viewers.length - 3}</span>}
          </div>}
          {data && <button className={`btn primary save-btn${savedCopy ? ' is-saved' : ''}`} type="button" aria-label={savedCopy ? 'Open saved copy in Peblo' : 'Save to my Peblo'} disabled={saveBusy} onClick={() => savedCopy ? navigate(savedCopy.kind === 'note' ? `/notes/${savedCopy.id}` : '/tasks') : saveSharedCopy()}>
            {saveBusy ? <LoaderCircle className="spin" size={16} /> : savedCopy ? <Check size={16} /> : <Clipboard size={16} />}
            <span>{saveBusy ? 'Saving…' : savedCopy ? 'Open in Peblo' : 'Save to my Peblo'}</span>
          </button>}
          {data && <button className="btn copy-btn" type="button" onClick={() => copy(window.location.href, 'Share link copied')}><Link2 size={17} /><span>Copy link</span></button>}
          {data && <div className="menu-wrap" ref={menuRef}>
            <button className="btn icon" type="button" aria-label="More options" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={19} /></button>
            {menuOpen && <div className="menu" role="menu">
              <h4>Share</h4>
              <div className="linkbox"><input readOnly value={window.location.href} aria-label="Share link" /><button className="btn dark" type="button" onClick={() => copy(window.location.href)}>Copy</button></div>
              <hr />
              <button type="button" role="menuitem" onClick={downloadMarkdown}><Download size={17} /><span>Download as Markdown<small>Keep your note formatting</small></span></button>
              <button type="button" role="menuitem" onClick={() => { window.print(); setMenuOpen(false); }}><Printer size={17} /><span>Print or save as PDF</span></button>
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
        <main className={`stage${data.kind === 'todo' ? ' task-stage' : ''}`}>
          {data.kind === 'note' && headings.length > 0 && <aside className="toc" aria-label="On this page">
            <h2>On this page</h2>
            {headings.map(({ id, title, level }) => <a key={id} href={`#${id}`} className={`${activeHeading === id ? 'on' : ''}${level === 3 ? ' sub' : ''}`}>{title}</a>)}
            <div className="meta"><b>{Math.max(1, Math.ceil(wordCount / 200))} min read</b><br />Updated {when(data.updatedAt)}<br /><span>{data.canEdit ? 'Anyone with the link can edit' : 'Read only · no sign-in needed'}</span></div>
          </aside>}

          <article ref={articleRef}>
            {data.kind === 'note' && <>
              {data.canEdit && !previewMode
                ? <input className="title-in" aria-label="Title" key={`t${rev}`} value={data.title || ''} onChange={(event) => { draft.current.title = event.target.value; setData((current) => ({ ...current, title: event.target.value })); queueSave(); }} />
                : <h1 className="title">{data.title || 'Untitled'}</h1>}
              <div className="by">
                <span className="av" aria-hidden="true">{initials(data.author)}</span>
                <span>{data.author ? <>Shared by <b>{data.author}</b></> : 'Shared note'}</span><span className="dotsep">·</span>
                <span>Updated {when(data.updatedAt)}</span>
                {data.canEdit && <><span className="dotsep">·</span><span className={`status ${status}`} role="status">{status === 'saved' ? <Check size={15} /> : null}{statusText}</span></>}
              </div>
              {conflict && <div className="conflict" role="alert">Someone else changed this note while you were editing.<div className="conflict-actions"><button className="btn" type="button" onClick={() => setRev((n) => n + 1)}>Load their version</button><button className="btn dark" type="button" onClick={() => saveNote(true)}>Keep mine</button></div></div>}
              {data.canEdit && !previewMode
                ? <Suspense fallback={<p className="loading">Loading editor…</p>}><BlockEditor key={`e${rev}`} guest fullPage themeOverride={darkMode ? 'dark' : 'light'} initialContent={data.content} onChange={(markdown) => { draft.current.content = markdown; setData((current) => ({ ...current, content: markdown })); queueSave(); }} /></Suspense>
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
        </main>
      )}
      {scrollProgress > 5 && <button className="totop" type="button" aria-label="Back to top" onClick={() => articleRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}><ArrowUp size={19} /></button>}
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
