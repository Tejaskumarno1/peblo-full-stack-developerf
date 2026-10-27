import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

// Find (Ctrl F) and Replace (Ctrl H) in the open note. Matches are painted with the browser's highlight feature, so the note itself is only
// changed when someone presses Replace. Readers get Find only; people who can edit also get Replace.
export default function FindBar({ root, selector = '.bn-editor', editor, editable, withReplace, onClose }) {
  const [q, setQ] = useState('');
  const [rep, setRep] = useState('');
  const [idx, setIdx] = useState(0);
  const [count, setCount] = useState(0);
  const [tick, setTick] = useState(0);
  const [place, setPlace] = useState({ top: 84, right: 28 });
  const ranges = useRef([]);
  const lastQ = useRef('');
  const input = useRef(null);
  const repInput = useRef(null);
  useEffect(() => {
    if (withReplace && editable) { repInput.current?.focus(); } else { input.current?.focus(); input.current?.select(); }
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('keydown', esc); try { CSS.highlights.delete('pb-find'); CSS.highlights.delete('pb-find-cur'); } catch { /* not supported */ } };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const at = () => { const r = root.current?.getBoundingClientRect(); if (r) setPlace({ top: Math.max(76, r.top + 12), right: Math.max(12, window.innerWidth - r.right + 12) }); };
    at(); window.addEventListener('resize', at);
    return () => window.removeEventListener('resize', at);
  }, [root]);
  useEffect(() => {
    const el = selector ? root.current?.querySelector(selector) : root.current;
    ranges.current = [];
    if (el && q) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const ql = q.toLowerCase();
      let n;
      while ((n = walker.nextNode())) {
        const t = n.nodeValue.toLowerCase();
        let i = t.indexOf(ql);
        while (i >= 0 && ranges.current.length < 500) {
          const r = new Range(); r.setStart(n, i); r.setEnd(n, i + q.length); ranges.current.push(r);
          i = t.indexOf(ql, i + q.length);
        }
      }
    }
    try { CSS.highlights.set('pb-find', new Highlight(...ranges.current)); } catch { /* not supported */ }
    setCount(ranges.current.length);
    if (lastQ.current !== q) { setIdx(0); lastQ.current = q; } else setIdx((i) => Math.min(i, Math.max(0, ranges.current.length - 1)));
  }, [q, root, tick]);
  useEffect(() => {
    const r = ranges.current[idx];
    try {
      if (!r) { CSS.highlights.delete('pb-find-cur'); return; }
      CSS.highlights.set('pb-find-cur', new Highlight(r));
      r.startContainer.parentElement?.scrollIntoView({ block: 'center' });
    } catch { /* not supported */ }
  }, [idx, count, tick]);
  const step = (d) => { if (count) setIdx((i) => (i + d + count) % count); };
  const spans = (list) => { const v = editor.prosemirrorView; return list.map((r) => [v.posAtDOM(r.startContainer, r.startOffset), v.posAtDOM(r.endContainer, r.endOffset)]); };
  const replaceOne = () => {
    if (!editable || !ranges.current[idx]) return;
    try {
      const v = editor.prosemirrorView; const [[from, to]] = spans([ranges.current[idx]]);
      v.dispatch(v.state.tr.insertText(rep, from, to));
      setTimeout(() => setTick((t) => t + 1), 30);
    } catch { /* the match moved */ }
  };
  const replaceAll = () => {
    if (!editable || !ranges.current.length) return;
    try {
      const v = editor.prosemirrorView; let tr = v.state.tr;
      for (const [from, to] of spans(ranges.current).sort((a, c) => c[0] - a[0])) tr = tr.insertText(rep, from, to);
      v.dispatch(tr);
      setTimeout(() => setTick((t) => t + 1), 30);
    } catch { /* the document changed */ }
  };
  const keys = (onEnter) => (e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(e); } if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
  return (
    <div className="pb-find" role="search" style={{ top: place.top, right: place.right }} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }}>
      <div className="row">
        <input ref={input} className="q" aria-label="Find in this note" placeholder="Find in this note" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={keys((e) => step(e.shiftKey ? -1 : 1))} />
        <span className="n">{q ? (count ? `${idx + 1} of ${count}` : 'No matches') : ''}</span>
        <button type="button" aria-label="Previous match" onClick={() => step(-1)}><ChevronLeft size={15} /></button>
        <button type="button" aria-label="Next match" onClick={() => step(1)}><ChevronRight size={15} /></button>
        <button type="button" aria-label="Close find" onClick={onClose}><X size={15} /></button>
      </div>
      {editable ? (
        <div className="row">
          <input ref={repInput} className="r" aria-label="Replace with" placeholder="Replace with" value={rep} onChange={(e) => setRep(e.target.value)} onKeyDown={keys(replaceOne)} />
          <button type="button" className="txt" data-testid="replace-one" disabled={!count} onClick={replaceOne}>Replace</button>
          <button type="button" className="txt ac" data-testid="replace-all" disabled={!count} onClick={replaceAll}>All</button>
        </div>
      ) : <div className="hint">Viewers get Find only. Editors also get Replace. Opens with Ctrl F.</div>}
    </div>
  );
}
