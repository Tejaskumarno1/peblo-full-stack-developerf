import { useEffect, useMemo, useRef, useState } from 'react';
import { AlignLeft, Search } from 'lucide-react';

/*
 * Ctrl K on the share page: type to jump to a heading or run an action. Same look as the mockup (S21).
 * headings: [{ id, title, level, comments? }], actions: [{ id, title, icon, hint, run }]
 */
export default function SharePalette({ headings = [], actions = [], onJump, onClose }) {
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const input = useRef(null);
  const list = useRef(null);
  useEffect(() => { input.current?.focus(); }, []);
  const needle = q.trim().toLowerCase();
  const jumps = useMemo(() => headings.filter((h) => !needle || h.title.toLowerCase().includes(needle)).map((h) => ({ kind: 'jump', key: `j${h.id}`, title: h.title, sub: `Heading${h.comments ? `, ${h.comments} comment${h.comments > 1 ? 's' : ''}` : ''}`, id: h.id })), [headings, needle]);
  const acts = useMemo(() => actions.filter((a) => !needle || a.title.toLowerCase().includes(needle)).map((a) => ({ kind: 'action', key: `a${a.id}`, ...a })), [actions, needle]);
  const all = [...jumps, ...acts];
  useEffect(() => { setAt(0); }, [needle]);
  useEffect(() => { list.current?.querySelector('[data-on="1"]')?.scrollIntoView({ block: 'nearest' }); }, [at]);
  const run = (item) => { if (!item) return; onClose(); if (item.kind === 'jump') onJump(item.id); else item.run(); };
  const onKey = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setAt((i) => (all.length ? (i + 1) % all.length : 0)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setAt((i) => (all.length ? (i - 1 + all.length) % all.length : 0)); }
    else if (event.key === 'Enter') { event.preventDefault(); run(all[at]); }
  };
  const row = (item, index) => {
    const Icon = item.kind === 'jump' ? AlignLeft : item.icon;
    return (
      <button key={item.key} type="button" role="option" aria-selected={index === at} data-on={index === at ? '1' : '0'} data-testid="palette-item" className={`sp-row${index === at ? ' on' : ''}`} onMouseMove={() => setAt(index)} onClick={() => run(item)}>
        <span className="sp-ic"><Icon size={16} /></span>
        <span className="sp-t"><b>{item.title}</b>{item.sub && <small>{item.sub}</small>}</span>
        {index === at && item.kind === 'jump' ? <kbd>Enter</kbd> : item.hint ? <kbd>{item.hint}</kbd> : null}
      </button>
    );
  };
  return (
    <div className="sp-back" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sp" role="dialog" aria-modal="true" aria-label="Command palette" data-testid="palette" onKeyDown={onKey}>
        <label className="sp-in"><Search size={17} /><input ref={input} value={q} onChange={(event) => setQ(event.target.value)} placeholder="Type a command or a heading" aria-label="Type a command or a heading" data-testid="palette-input" /><kbd>Esc</kbd></label>
        <div className="sp-list" role="listbox" ref={list}>
          {jumps.length > 0 && <div className="sp-cap">Jump to</div>}
          {jumps.map((item, i) => row(item, i))}
          {acts.length > 0 && <div className="sp-cap">Actions</div>}
          {acts.map((item, i) => row(item, jumps.length + i))}
          {all.length === 0 && <p className="sp-empty">Nothing matches. Try a heading or an action such as copy link.</p>}
        </div>
      </div>
    </div>
  );
}
