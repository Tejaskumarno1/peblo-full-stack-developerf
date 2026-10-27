import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pin, Copy, X, Undo2, Plus } from 'lucide-react';

const KEY = 'peblo-note-tabs';
const load = () => { try { const s = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(s?.tabs) ? s.tabs : []; } catch { return []; } };

// Open notes as tabs above the page, with back / forward, pin, duplicate, close others and reopen closed.
export default function NoteTabs({ doc, notes, navigate, onNew, onDuplicate, dirty }) {
  const [tabs, setTabs] = useState(load);
  const [closed, setClosed] = useState([]);
  const [menu, setMenu] = useState(null); // { id, x, y }
  const hist = useRef({ list: [], i: -1, skip: false });
  const [, bump] = useState(0);
  const tabsRef = useRef(tabs); tabsRef.current = tabs;
  const closedRef = useRef(closed); closedRef.current = closed;
  const docId = doc && !doc.isDraft ? doc.id : null;

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ tabs })); } catch { /* ignore */ } }, [tabs]);

  const titleOf = useCallback((t) => {
    if (doc && t.id === doc.id) return doc.title || 'Untitled';
    const n = notes.find((x) => x.id === t.id);
    return (n && n.title) || t.title || 'Untitled';
  }, [doc, notes]);

  // opening a note adds its tab and a step in the back / forward trail
  useEffect(() => {
    if (!docId) return;
    setTabs((ts) => (ts.some((t) => t.id === docId) ? ts : [...ts, { id: docId, title: doc.title || 'Untitled', pinned: false }]));
    const h = hist.current;
    if (h.skip) { h.skip = false; bump((n) => n + 1); return; }
    if (h.list[h.i] === docId) return;
    h.list = [...h.list.slice(0, h.i + 1), docId];
    h.i = h.list.length - 1;
    bump((n) => n + 1);
  }, [docId]); // eslint-disable-line react-hooks/exhaustive-deps

  // remember the latest title for tabs that are not open right now
  useEffect(() => {
    if (!docId || !doc.title) return;
    setTabs((ts) => (ts.some((t) => t.id === docId && t.title !== doc.title) ? ts.map((t) => (t.id === docId ? { ...t, title: doc.title } : t)) : ts));
  }, [docId, doc?.title]);

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
      if (next) go(next.id); else navigate('/notes');
    }
  }, [docId, go, navigate]);

  const closeOthers = (id) => {
    const ts = tabsRef.current;
    const gone = ts.filter((t) => t.id !== id && !t.pinned);
    if (!gone.length) return;
    setTabs(ts.filter((t) => t.id === id || t.pinned));
    setClosed((c) => [...c, ...gone]);
    if (docId !== id && !ts.find((t) => t.id === docId && t.pinned)) go(id);
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
      else if (e.altKey && !e.ctrlKey && !e.shiftKey && (k === 'ArrowLeft' || k === 'ArrowRight')) { e.preventDefault(); step(k === 'ArrowLeft' ? -1 : 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reopen, cycle, step]);

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
              onClick={() => !on && go(t.id)} onKeyDown={(e) => { if (e.key === 'Enter') go(t.id); }}
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
      <button type="button" className="s-tab-nav" data-testid="tab-new" aria-label="New note" title="New note" onClick={onNew}><Plus size={16} strokeWidth={2.2} /></button>
      {menu && mt && (
        <div className="s-tab-menu" role="menu" data-testid="tab-menu" style={{ left: Math.min(menu.x, window.innerWidth - 260), top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" role="menuitem" data-testid="tm-pin" onClick={() => { togglePin(menu.id); setMenu(null); }}><Pin size={15} />{mt.pinned ? 'Unpin tab' : 'Pin tab'}</button>
          <button type="button" role="menuitem" data-testid="tm-dup" onClick={() => { const id = menu.id; setMenu(null); onDuplicate(id); }}><Copy size={15} />Duplicate</button>
          <button type="button" role="menuitem" data-testid="tm-others" onClick={() => { closeOthers(menu.id); setMenu(null); }}><X size={15} />Close others</button>
          <button type="button" role="menuitem" data-testid="tm-reopen" disabled={!closed.length} onClick={() => { reopen(); setMenu(null); }}><Undo2 size={15} />Reopen closed<kbd>Ctrl+Shift+T</kbd></button>
        </div>
      )}
    </div>
  );
}
