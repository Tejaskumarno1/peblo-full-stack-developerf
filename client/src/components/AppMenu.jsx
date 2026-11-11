import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, AppWindow, EyeOff, Link2, Download, Code2, FileText, FilePlus2, ListChecks, Pin, PinOff, Copy, Trash2, Share2, ChevronRight, X, SquareArrowOutUpRight, FolderInput, Tag as TagIcon, Columns2, BookOpen, Globe, Image as PicIcon, Check } from 'lucide-react';
import { notesAPI, tagsAPI } from '../api';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { exportMarkdown, exportWord, exportPdf } from '../utils/exportNote';
import './appMenu.css';
import Toast from './Toast';

// Peblo's own right-click menu (mockup "Peblo right-click menu"): different contents for a note in a list, a link, and empty space.
// Shift plus right-click still gives the normal browser menu. Menus that already exist (tabs, tables, the editor) are left alone.
const abs = (href) => { try { return new URL(href, window.location.origin).href; } catch { return href; } };
const words = (md) => String(md || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
const pictures = (md) => [...new Set([...String(md || '').matchAll(/\/api\/media\/([\w-]{8,64})/g)].map((m) => abs(`/api/media/${m[1]}`)))];

export default function AppMenu() {
  const navigate = useNavigate();
  const { settings } = useAuth();
  const [tags, setTags] = useState([]);
  const folders = (settings?.noteFolders || []).filter((d) => !d.smart);
  const [menu, setMenu] = useState(null); // { x, y, kind: 'note' | 'link' | 'space', id?, href? }
  const [note, setNote] = useState(null);
  const [sub, setSub] = useState(null);
  const [subAt, setSubAt] = useState(null); // where the open submenu hangs: { x, y, left }
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const timer = useRef(0);
  const [details, setDetails] = useState(null);
  const [toast, setToast] = useState('');
  const box = useRef(null);
  const say = useCallback((t) => { setToast(t); setTimeout(() => setToast(''), 2200); }, []);
  const close = useCallback(() => { clearTimeout(timer.current); setMenu(null); setSub(null); setSubAt(null); }, []);

  useEffect(() => {
    const onCtx = (e) => {
      if (e.shiftKey || e.defaultPrevented) return;
      const t = e.target instanceof Element ? e.target : null; if (!t) return;
      if (t.closest('input, textarea, select, [contenteditable="true"], .bn-editor, [role="dialog"], [role="menu"], button, [data-no-appmenu]')) return;
      const a = t.closest('a[href]');
      let next = null;
      if (a) {
        const href = a.getAttribute('href') || '';
        const m = /^\/notes\/([\w-]+)\/?$/.exec(href.split(/[?#]/)[0]);
        if (m) next = { kind: 'note', id: m[1], href: abs(href) };
        else if (/^https?:/i.test(href)) next = { kind: 'link', href };
        else return;
      } else if (t.closest('main, [data-app-main], .s-main, #root')) next = { kind: 'space' };
      if (!next) return;
      e.preventDefault();
      setSub(null); setNote(null);
      setMenu({ ...next, x: e.clientX, y: e.clientY });
    };
    document.addEventListener('contextmenu', onCtx);
    return () => document.removeEventListener('contextmenu', onCtx);
  }, []);

  // the note behind the row is read once the menu opens, so Pin, Save as and Inspect know the real note
  useEffect(() => {
    if (!menu || menu.kind !== 'note') return undefined;
    let live = true;
    notesAPI.get(menu.id).then(({ data }) => { if (live) setNote(data.note); }).catch(() => {});
    tagsAPI.list().then((r) => { if (live) setTags((r.data.tags || []).filter((t) => t.name !== 'inbox' && t.name !== 'private').slice(0, 10)); }).catch(() => {});
    return () => { live = false; };
  }, [menu]);

  useEffect(() => {
    if (!menu) return undefined;
    const away = (e) => { if (e.target instanceof Element && e.target.closest('.am-menu')) return; close(); };
    const esc = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', away, true); document.addEventListener('keydown', esc, true); window.addEventListener('blur', close); window.addEventListener('resize', close);
    const onScroll = (e) => { if (e.target instanceof Element && e.target.closest('.am-menu')) return; close(); };
    document.addEventListener('scroll', onScroll, true);
    return () => { document.removeEventListener('mousedown', away, true); document.removeEventListener('keydown', esc, true); window.removeEventListener('blur', close); window.removeEventListener('resize', close); document.removeEventListener('scroll', onScroll, true); };
  }, [menu, close]);

  const copy = async (text, done) => { try { await navigator.clipboard.writeText(text); say(done); } catch { say('Could not copy'); } };
  const go = (fn) => () => { const m = menu; close(); fn(m); };
  const newNote = async () => { try { const { data } = await notesAPI.create({ title: 'Untitled', content: '', tags: [] }); navigate(`/notes/${data.note.id}`); } catch { say('Could not create the note'); } };
  const pin = async (m) => { try { const next = !note?.meta?.pinned; await notesAPI.update(m.id, { meta: { ...(note?.meta || {}), pinned: next } }); say(next ? 'Pinned' : 'Unpinned'); window.dispatchEvent(new CustomEvent('pb-notes-changed')); } catch { say('Could not change the pin'); } };
  const dup = async () => { if (!note) return; try { const { data } = await notesAPI.create({ title: `Copy of ${note.title || 'Untitled'}`, content: note.content || '', tags: note.tags || [] }); navigate(`/notes/${data.note.id}`); } catch { say('Could not duplicate the note'); } };
  const trash = async (m) => { try { await notesAPI.delete(m.id); say('Moved to the trash'); window.dispatchEvent(new CustomEvent('pb-notes-changed')); } catch { say('Could not move it to the trash'); } };
  const moveTo = (name) => async (m) => { try { await notesAPI.update(m.id, { meta: { ...(note?.meta || {}), folder: name } }); say(name ? `Moved to ${name}` : 'Taken out of its folder'); window.dispatchEvent(new CustomEvent('pb-notes-changed')); } catch { say('Could not move it'); } };
  const toggleTag = (name) => async (m) => { try { const has = (note?.tags || []).includes(name); const next = has ? note.tags.filter((t) => t !== name) : [...(note?.tags || []), name]; await notesAPI.update(m.id, { tags: next }); say(has ? `Removed #${name}` : `Tagged #${name}`); window.dispatchEvent(new CustomEvent('pb-notes-changed')); } catch { say('Could not change the tag'); } };
  // A link that already exists is reused as it is; a new one is made only when there is none (and then it ends on its own).
  const linkFor = async (m, days) => { const cur = await api.get(`/share/note/${m.id}`); if (cur.data?.token) return cur.data.token; const made = await api.post(`/share/note/${m.id}`, { expiresInDays: days, edit: false }); return made.data.token; };
  const openPublic = async (m) => { try { const t = await linkFor(m, 7); window.open(abs(`/s/note/${t}`), '_blank', 'noopener'); } catch { say('Could not make the public page'); } };
  const picturesLink = async (m) => { try { const t = await linkFor(m, 1); await copy(abs(`/s/note/${t}.md`), 'Pictures link copied. It works for AI tools and ends in 1 day'); } catch { say('Could not make the pictures link'); } };
  const side = (href) => { const w = Math.floor(window.screen.availWidth / 2); window.open(href, '_blank', `popup,width=${w},height=${window.screen.availHeight - 60},left=${window.screen.availWidth - w},top=0,noopener`); };
  const openNew = (href) => window.open(href, '_blank', 'noopener');
  const openWin = (href) => window.open(href, '_blank', 'popup,width=1100,height=800,noopener');
  const privateHint = (href) => copy(href, 'Link copied. Paste it into a private window');

  const I = useMemo(() => function Item({ icon: Icon, label, onClick, hint, arrow, danger, disabled, id, keep }) { return (
    <button type="button" role="menuitem" className={`am-i${danger ? ' danger' : ''}`} disabled={disabled} data-testid={`am-${id}`} onClick={onClick} onMouseEnter={(e) => { clearTimeout(timer.current); if (keep) return; if (arrow) { const r = e.currentTarget.getBoundingClientRect(); setSubAt({ top: r.top, right: r.right, left: r.left }); setSub(arrow); } else timer.current = setTimeout(() => { setSub(null); setSubAt(null); }, 220); }} onFocus={(e) => { if (keep || !arrow) return; const r = e.currentTarget.getBoundingClientRect(); setSubAt({ top: r.top, right: r.right, left: r.left }); setSub(arrow); }}>
      <Icon size={15} /><span>{label}</span>{hint && <em>{hint}</em>}{arrow && <ChevronRight size={14} className="am-ar" />}
    </button>
  ); }, []);
  useLayoutEffect(() => {
    if (!menu || !box.current) return;
    const h = box.current.offsetHeight; const w = box.current.offsetWidth;
    setPos({ left: Math.max(8, Math.min(menu.x, window.innerWidth - w - 8)), top: Math.max(8, Math.min(menu.y, window.innerHeight - h - 8)) });
  }, [menu, note]);
  if (!menu && !details && !toast) return null;

  const subPanel = (name, items, count = 3) => {
    if (sub !== name || !subAt) return null;
    const W = 252; const gap = -3; // overlaps the parent a little, so the pointer never crosses a dead strip
    const left = subAt.right + gap + W > window.innerWidth - 8 ? Math.max(8, subAt.left - W - gap) : subAt.right + gap;
    const rows = Math.min(count, 10); const top = Math.max(8, Math.min(subAt.top - 6, window.innerHeight - (rows * 32 + 16) - 8));
    return <div className="am-menu am-sub" role="menu" data-testid={`am-sub-${name}`} style={{ left, top }} onMouseEnter={() => clearTimeout(timer.current)}>{items}</div>;
  };

  const inspect = (m) => {
    if (m.kind === 'note' && note) setDetails({ title: note.title || 'Untitled', rows: [['Link', m.href], ['Id', note.id], ['Words', String(words(note.content))], ['Updated', note.updatedAt ? new Date(note.updatedAt).toLocaleString() : ''], ['Created', note.createdAt ? new Date(note.createdAt).toLocaleString() : ''], ['Pinned', note.meta?.pinned ? 'yes' : 'no'], ['Tags', (note.tags || []).join(', ') || 'none']], pics: pictures(note.content) });
    else if (m.kind === 'link') { let u = null; try { u = new URL(m.href); } catch { /* not a URL */ } setDetails({ title: 'Link', rows: [['Address', m.href], ['Site', u ? u.host : ''], ['Path', u ? u.pathname : '']], pics: [] }); }
  };

  return (
    <>
      {menu && (
        <div className="am-menu" ref={box} role="menu" data-testid="app-menu" data-kind={menu.kind} style={{ left: pos.left, top: pos.top }} onMouseEnter={() => clearTimeout(timer.current)}>
          {menu.kind === 'note' && (
            <>
              <I id="open" icon={ExternalLink} label="Open" hint="Enter" onClick={go((m) => navigate(`/notes/${m.id}`))} />
              <I id="open-tab" icon={SquareArrowOutUpRight} label="Open in new tab" onClick={go((m) => openNew(m.href))} />
              <I id="open-win" icon={AppWindow} label="Open in new window" onClick={go((m) => openWin(m.href))} />
              <I id="open-side" icon={Columns2} label="Open to the side" onClick={go((m) => side(m.href))} />
              <I id="open-as" icon={EyeOff} label="Open as" arrow="open-as" onClick={() => setSub('open-as')} />
              {subPanel('open-as', <>
                <I keep id="as-peblo" icon={AppWindow} label="Peblo window (default)" onClick={go((m) => navigate(`/notes/${m.id}`))} />
                <I keep id="as-reader" icon={BookOpen} label="Reader view" onClick={go((m) => navigate(`/notes/${m.id}?view=reader`))} />
                <I keep id="as-public" icon={Globe} label="Public share page" onClick={go(openPublic)} />
                <I keep id="as-private" icon={EyeOff} label="Private window (copies the link)" onClick={go((m) => privateHint(m.href))} />
              </>)}
              <div className="am-sep" /><div className="am-lab">Create</div>
              <I id="new-note" icon={FilePlus2} label="New note here" onClick={go(newNote)} />
              <div className="am-sep" /><div className="am-lab">Organise</div>
              <I id="pin" icon={note?.meta?.pinned ? PinOff : Pin} label={note?.meta?.pinned ? 'Unpin' : 'Pin'} disabled={!note} onClick={go(pin)} />
              <I id="dup" icon={Copy} label="Duplicate" disabled={!note} onClick={go(dup)} />
              <I id="move" icon={FolderInput} label="Move to folder" arrow="move" disabled={!note} onClick={() => setSub('move')} />
              {subPanel('move', <>
                {folders.map((d) => <I keep key={d.id} id={`mv-${d.id}`} icon={note?.meta?.folder === d.name ? Check : FolderInput} label={d.name} onClick={go(moveTo(d.name))} />)}
                {folders.length === 0 && <I keep id="mv-none-yet" icon={FolderInput} label="No folders yet" disabled onClick={() => {}} />}
                {note?.meta?.folder && <I keep id="mv-out" icon={X} label="Take out of its folder" onClick={go(moveTo(''))} />}
              </>, Math.max(1, folders.length + (note?.meta?.folder ? 1 : 0)))}
              <I id="tag" icon={TagIcon} label="Tag" arrow="tag" disabled={!note} onClick={() => setSub('tag')} />
              {subPanel('tag', <>
                {tags.map((t) => <I keep key={t.name} id={`tg-${t.name}`} icon={(note?.tags || []).includes(t.name) ? Check : TagIcon} label={`#${t.name}`} onClick={go(toggleTag(t.name))} />)}
                {tags.length === 0 && <I keep id="tg-none-yet" icon={TagIcon} label="No tags yet" disabled onClick={() => {}} />}
              </>, Math.max(1, tags.length))}
              <div className="am-sep" /><div className="am-lab">Share</div>
              <I id="copy-link" icon={Link2} label="Copy link" onClick={go((m) => copy(m.href, 'Link copied'))} />
              <I id="pics-link" icon={PicIcon} label="Temporary pictures link" hint="1 day" onClick={go(picturesLink)} />
              <I id="save-as" icon={Download} label="Save as" arrow="save-as" disabled={!note} onClick={() => setSub('save-as')} />
              {subPanel('save-as', <>
                <I keep id="save-md" icon={FileText} label="Markdown (.md)" onClick={go(() => exportMarkdown(note))} />
                <I keep id="save-doc" icon={FileText} label="Word (.doc)" onClick={go(() => exportWord(note))} />
                <I keep id="save-pdf" icon={FileText} label="PDF" onClick={go(() => exportPdf(note))} />
              </>)}
              <div className="am-sep" />
              <I id="inspect" icon={Code2} label="Inspect (details)" disabled={!note} onClick={go(inspect)} />
              <I id="trash" icon={Trash2} danger label="Move to Trash" onClick={go(trash)} />
            </>
          )}
          {menu.kind === 'link' && (
            <>
              <I id="l-open" icon={SquareArrowOutUpRight} label="Open link in new tab" onClick={go((m) => openNew(m.href))} />
              <I id="l-private" icon={EyeOff} label="Open link in private window (copies it)" onClick={go((m) => privateHint(m.href))} />
              <I id="l-win" icon={AppWindow} label="Open link in new window" onClick={go((m) => openWin(m.href))} />
              <I id="l-save" icon={Download} label="Save link as" onClick={go((m) => { const a = document.createElement('a'); a.href = m.href; a.download = ''; a.rel = 'noopener'; a.target = '_blank'; document.body.appendChild(a); a.click(); a.remove(); })} />
              <I id="l-copy" icon={Link2} label="Copy link address" onClick={go((m) => copy(m.href, 'Link copied'))} />
              <div className="am-sep" />
              <I id="l-inspect" icon={Code2} label="Inspect" onClick={go(inspect)} />
            </>
          )}
          {menu.kind === 'space' && (
            <>
              <div className="am-lab">Create</div>
              <I id="s-note" icon={FilePlus2} label="New note here" onClick={go(newNote)} />
              <I id="s-todo" icon={ListChecks} label="New to-do" onClick={go(() => navigate('/tasks'))} />
              <I id="s-share" icon={Share2} label="Copy address of this page" onClick={go(() => copy(window.location.href, 'Link copied'))} />
            </>
          )}
        </div>
      )}
      {details && (
        <div className="am-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setDetails(null); }}>
          <section className="am-dlg" role="dialog" aria-modal="true" aria-label="Details" data-testid="am-details">
            <header><b>{details.title}</b><button type="button" aria-label="Close" onClick={() => setDetails(null)}><X size={16} /></button></header>
            <dl>{details.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
            {details.pics.length > 0 && (
              <div className="am-pics"><div className="am-lab">Pictures ({details.pics.length})</div>
                {details.pics.map((p, i) => <div className="am-pic" key={p}><span>Image {i + 1}</span><a href={p} target="_blank" rel="noopener noreferrer">{p}</a><button type="button" onClick={() => copy(p, 'Picture link copied')}>Copy</button></div>)}
              </div>
            )}
          </section>
        </div>
      )}
      {toast && <Toast><div className="am-toast" role="status" data-testid="am-toast">{toast}</div></Toast>}
    </>
  );
}
