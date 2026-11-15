import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pin, Copy, X, Undo2, Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

import { getSpace } from '../api/space';
import NavMenu from './NavMenu';
// Tabs belong to the signed-in person AND to the space they are in (Personal or a team), so another account on this
// computer starts with none and a team note never lingers as a tab in Personal.
// The back / forward trail and the "reopen closed" list last for this session, so a refresh keeps them.
const keyFor = (uid) => `peblo-note-tabs:${uid || 'anon'}${getSpace() ? ':' + getSpace() : ''}`;
export const MAX_TABS = 8;
const load = (key) => { try { const s = JSON.parse(localStorage.getItem(key)); return Array.isArray(s?.tabs) ? s.tabs : []; } catch { return []; } };
const loadSession = (key) => { try { return JSON.parse(sessionStorage.getItem(`${key}:trail`)) || {}; } catch { return {}; } };

// Open notes as tabs above the page, with back / forward, pin, duplicate, close others and reopen closed.
export default function NoteTabs({ doc, notes, navigate, onNew, onDuplicate, onEmpty, dirty }) {
  const { user } = useAuth();
  const KEY = keyFor(user?.id);
  const [tabs, setTabs] = useState(() => { try { localStorage.removeItem('peblo-note-tabs'); } catch { /* ignore */ } return load(KEY); }); // the old shared key is dropped
  const [closed, setClosed] = useState(() => (loadSession(KEY).closed || []));
  const [menu, setMenu] = useState(null); // { id, x, y }
  const hist = useRef((() => { const t = loadSession(KEY).hist; return t && Array.isArray(t.list) ? { list: t.list, i: Math.min(t.i, t.list.length - 1), skip: false } : { list: [], i: -1, skip: false }; })());
  const [, bump] = useState(0);
  const tabsRef = useRef(tabs); tabsRef.current = tabs;
  const closedRef = useRef(closed); closedRef.current = closed;
  const docId = doc && !doc.isDraft ? doc.id : null;

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ tabs })); } catch { /* ignore */ } }, [tabs, KEY]);
  const saveTrail = () => { try { sessionStorage.setItem(`${KEY}:trail`, JSON.stringify({ closed: closedRef.current.slice(-20), hist: { list: hist.current.list.slice(-50), i: hist.current.i } })); } catch { /* ignore */ } };
  useEffect(() => { saveTrail(); }, [closed]); // eslint-disable-line react-hooks/exhaustive-deps

  const titleOf = useCallback((t) => {
    if (doc && t.id === doc.id) return doc.title || 'Untitled';
    const n = notes.find((x) => x.id === t.id);
    return (n && n.title) || t.title || 'Untitled';
  }, [doc, notes]);

  // opening a note adds its tab and a step in the back / forward trail
  useEffect(() => {
    if (!docId) return;
    setTabs((ts) => {
      if (ts.some((t) => t.id === docId)) return ts;
      const next = [...ts, { id: docId, title: doc.title || 'Untitled', pinned: false }];
      while (next.length > MAX_TABS) { const i = next.findIndex((t) => !t.pinned && t.id !== docId); if (i < 0) break; next.splice(i, 1); } // the oldest unpinned tab makes room
      return next;
    });
    const h = hist.current;
    if (h.skip) { h.skip = false; bump((n) => n + 1); return; }
    if (h.list[h.i] === docId) return;
    h.list = [...h.list.slice(0, h.i + 1), docId];
    h.i = h.list.length - 1;
    saveTrail();
    bump((n) => n + 1);
  }, [docId]); // eslint-disable-line react-hooks/exhaustive-deps

  // remember the latest title for tabs that are not open right now
  useEffect(() => {
    if (!docId || !doc.title) return;
    setTabs((ts) => (ts.some((t) => t.id === docId && t.title !== doc.title) ? ts.map((t) => (t.id === docId ? { ...t, title: doc.title } : t)) : ts));
  }, [docId, doc?.title]);

  // a note that was deleted for good, or moved to the Trash or Archive, should not leave a dead tab behind
  useEffect(() => {
    if (!notes.length) return;
    const alive = new Set(notes.map((n) => n.id));
    setTabs((ts) => (ts.some((t) => !alive.has(t.id) && t.id !== docId) ? ts.filter((t) => alive.has(t.id) || t.id === docId) : ts));
  }, [notes, docId]);

  const go = useCallback((id) => navigate(`/notes/${id}`), [navigate]);
  const ordered = [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];

  const close = useCallback((id) => {
    const ts = tabsRef.current;
    const t = ts.find((x) => x.id === id);
    if (!t) return;
    const rest = ts.filter((x) => x.id !== id);
    setTabs(rest);
    setClosed((c) => [...c, t]);
    if (docId === id) {
      const idx = ts.findIndex((x) => x.id === id);
      const next = rest[Math.min(idx, rest.length - 1)];
      if (next) go(next.id); else if (onEmpty) onEmpty(); else navigate('/notes');
    }
  }, [docId, go, navigate, onEmpty]);

  const closeOthers = (id) => {
    const ts = tabsRef.current;
    const gone = ts.filter((t) => t.id !== id && !t.pinned);
    if (!gone.length) return;
    setTabs(ts.filter((t) => t.id === id || t.pinned));
    setClosed((c) => [...c, ...gone]);
    if (docId !== id && !ts.find((t) => t.id === docId && t.pinned)) go(id);
  };
  const closeRight = (id) => {
    const ts = tabsRef.current;
    const ord = [...ts.filter((t) => t.pinned), ...ts.filter((t) => !t.pinned)];
    const at = ord.findIndex((t) => t.id === id);
    const gone = ord.slice(at + 1).filter((t) => !t.pinned);
    if (!gone.length) return;
    const ids = new Set(gone.map((t) => t.id));
    setTabs(ts.filter((t) => !ids.has(t.id)));
    setClosed((c) => [...c, ...gone]);
    if (docId && ids.has(docId)) go(id);
  };
  const closeAll = () => {
    const ts = tabsRef.current;
    const gone = ts.filter((t) => !t.pinned);
    if (!gone.length) return;
    setTabs(ts.filter((t) => t.pinned));
    setClosed((c) => [...c, ...gone]);
    const keep = ts.find((t) => t.pinned);
    if (keep) { if (docId !== keep.id) go(keep.id); } else if (onEmpty) onEmpty(); else navigate('/notes');
  };
  const reopen = useCallback(() => {
    const c = closedRef.current;
    const t = c[c.length - 1];
    if (!t) return;
    setClosed(c.slice(0, -1));
    setTabs((ts) => (ts.some((x) => x.id === t.id) ? ts : [...ts, t]));
    go(t.id);
  }, [go]);
  const togglePin = (id) => setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t)));

  const step = useCallback((d) => {
    const h = hist.current;
    const j = h.i + d;
    if (j < 0 || j >= h.list.length) return;
    h.i = j; h.skip = true;
    saveTrail();
    go(h.list[j]);
  }, [go]);
  const cycle = useCallback((d) => {
    const o = [...tabsRef.current.filter((t) => t.pinned), ...tabsRef.current.filter((t) => !t.pinned)];
    if (o.length < 2) return;
    const i = o.findIndex((t) => t.id === docId);
    go(o[(i + d + o.length) % o.length].id);
  }, [docId, go]);

  useEffect(() => {
    const onKey = (e) => {
      const k = e.key;
      if (e.ctrlKey && e.shiftKey && (k === 't' || k === 'T')) { e.preventDefault(); reopen(); }
      else if (e.ctrlKey && k === 'Tab') { e.preventDefault(); cycle(e.shiftKey ? -1 : 1); }
      else if (e.ctrlKey && (k === 'PageDown' || k === 'PageUp')) { e.preventDefault(); cycle(k === 'PageDown' ? 1 : -1); }
      else if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (k === 'w' || k === 'W') && docId) { e.preventDefault(); close(docId); }
      else if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (k === 'n' || k === 'N')) { e.preventDefault(); onNew && onNew(); }
      else if (e.altKey && !e.ctrlKey && !e.shiftKey && (k === 'ArrowLeft' || k === 'ArrowRight')) { e.preventDefault(); step(k === 'ArrowLeft' ? -1 : 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reopen, cycle, step, close, docId, onNew]);

  useEffect(() => {
    if (!menu) return undefined;
    const off = () => setMenu(null);
    const esc = (e) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('pointerdown', off);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', off); window.removeEventListener('keydown', esc); };
  }, [menu]);

  const h = hist.current;
  const mt = menu && tabs.find((t) => t.id === menu.id);
  return (
    <div className="s-tabs" role="tablist" aria-label="Open notes" data-testid="note-tabs">
      <button type="button" className="s-tab-nav" data-testid="tab-back" aria-label="Back" title="Back (Alt Left)" disabled={h.i <= 0} onClick={() => step(-1)}><ChevronLeft size={16} strokeWidth={2} /></button>
      <button type="button" className="s-tab-nav" data-testid="tab-fwd" aria-label="Forward" title="Forward (Alt Right)" disabled={h.i >= h.list.length - 1} onClick={() => step(1)}><ChevronRight size={16} strokeWidth={2} /></button>
      <div className="s-tab-row">
        {ordered.map((t) => {
          const on = t.id === docId;
          return (
            <div key={t.id} role="tab" aria-selected={on} tabIndex={0} data-testid="note-tab" data-id={t.id} className={`s-tab${on ? ' on' : ''}${t.pinned ? ' pinned' : ''}`}
              onClick={() => !on && go(t.id)} onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return; // keys on the close button belong to the button
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(t.id); }
                else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  e.preventDefault();
                  const i = ordered.findIndex((x) => x.id === t.id);
                  const nx = ordered[(i + (e.key === 'ArrowRight' ? 1 : -1) + ordered.length) % ordered.length];
                  const el = e.currentTarget.parentElement?.querySelector(`[data-id="${nx.id}"]`);
                  el?.focus();
                } else if (e.key === 'Delete') { e.preventDefault(); close(t.id); }
              }}
              onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); close(t.id); } }}
              onContextMenu={(e) => { e.preventDefault(); setMenu({ id: t.id, x: e.clientX, y: e.clientY }); }}>
              {t.pinned && <Pin size={13} strokeWidth={2} />}
              {on && dirty && !t.pinned && <span className="s-tab-dot" title="Saving" />}
              <b>{titleOf(t)}</b>
              <button type="button" className="s-tab-x" data-testid="tab-close" aria-label={`Close ${titleOf(t)}`} onClick={(e) => { e.stopPropagation(); close(t.id); }}><X size={13} strokeWidth={2.2} /></button>
            </div>
          );
        })}
      </div>
      {doc?.isDraft && (
        <div className="s-tab-row" style={{ flex: 'none' }}>
          <div role="tab" aria-selected="true" tabIndex={0} data-testid="draft-tab" className="s-tab on"><b>{doc.title || 'New note'}</b><span className="s-tab-dot" title="Not saved yet" /></div>
        </div>
      )}
      <button type="button" className="s-tab-nav" data-testid="tab-new" aria-label="New note" title="New note" onClick={onNew}><Plus size={16} strokeWidth={2.2} /></button>
      {menu && mt && (
        <NavMenu onClose={() => setMenu(null)} className="s-tab-menu" data-testid="tab-menu" style={{ left: Math.min(menu.x, window.innerWidth - 260), top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" role="menuitem" data-testid="tm-pin" onClick={() => { togglePin(menu.id); setMenu(null); }}><Pin size={15} />{mt.pinned ? 'Unpin tab' : 'Pin tab'}</button>
          <button type="button" role="menuitem" data-testid="tm-dup" onClick={() => { const id = menu.id; setMenu(null); onDuplicate(id); }}><Copy size={15} />Duplicate</button>
          <button type="button" role="menuitem" data-testid="tm-right" onClick={() => { closeRight(menu.id); setMenu(null); }}><X size={15} />Close tabs to the right</button>
          <button type="button" role="menuitem" data-testid="tm-all" onClick={() => { closeAll(); setMenu(null); }}><X size={15} />Close all tabs</button>
          <button type="button" role="menuitem" data-testid="tm-others" onClick={() => { closeOthers(menu.id); setMenu(null); }}><X size={15} />Close others</button>
          <button type="button" role="menuitem" data-testid="tm-reopen" disabled={!closed.length} onClick={() => { reopen(); setMenu(null); }}><Undo2 size={15} />Reopen closed<kbd>Ctrl+Shift+T</kbd></button>
        </NavMenu>
      )}
    </div>
  );
}
