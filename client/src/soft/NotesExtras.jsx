import { useMemo, useRef, useState } from 'react';
import { Tag as TagIcon, X } from 'lucide-react';
import { useOutside } from './NotesPanelParts';
import { useDialogFocus } from './a11y';
import './notesextras.css';

/** The Tags filter row: a "Tags" button that opens a picker (many tags, Any / All), chips for the chosen tags and Clear. */
export function TagFilterBar({ tags, sel, setSel, match, setMatch }) {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const all = useMemo(() => [...new Set([...tags, ...sel])], [tags, sel]);
  const toggle = (t) => setSel(sel.includes(t) ? sel.filter((x) => x !== t) : [...sel, t]);
  if (!all.length && !sel.length) return null;
  return (
    <div className="np-tagbar" data-testid="tag-filter">
      <button type="button" ref={btn} className={`np-tagbtn${sel.length ? ' set' : ''}`} data-testid="tag-filter-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)}><TagIcon size={14} strokeWidth={1.9} />Tags{sel.length ? ` (${sel.length})` : ''}</button>
      {sel.map((t) => <span key={t} className="np-tagchip" data-testid="tag-chip">#{t}<button type="button" aria-label={`Remove tag ${t}`} onClick={() => toggle(t)}><X size={12} strokeWidth={2.6} /></button></span>)}
      {sel.length > 1 && <span className="np-tagmode" data-testid="tag-mode-note">{match === 'all' ? 'all of these' : 'any of these'}</span>}
      {sel.length > 0 && <button type="button" className="np-tagclear" data-testid="tag-clear" onClick={() => setSel([])}>Clear</button>}
      {open && <TagPicker tags={all} sel={sel} toggle={toggle} match={match} setMatch={setMatch} onClose={() => setOpen(false)} />}
    </div>
  );
}

function TagPicker({ tags, sel, toggle, match, setMatch, onClose }) {
  const ref = useRef(null);
  const [f, setF] = useState('');
  useOutside(ref, true, onClose);
  useDialogFocus(ref, false);
  const shown = tags.filter((t) => t.toLowerCase().includes(f.trim().toLowerCase().replace(/^#/, '')));
  return (
    <div className="np-tagpop" role="dialog" aria-label="Filter by tags" ref={ref} tabIndex={-1} data-testid="tag-picker">
      <input className="np-tagfind" aria-label="Find a tag" placeholder="Find a tag" value={f} onChange={(e) => setF(e.target.value)} />
      <div className="np-taglist" role="group" aria-label="Tags">
        {shown.map((t) => <label key={t} className="np-tagopt"><input type="checkbox" checked={sel.includes(t)} onChange={() => toggle(t)} />#{t}</label>)}
        {shown.length === 0 && <p className="np-hint">No tag matches.</p>}
      </div>
      <div className="np-seg" role="radiogroup" aria-label="Match">
        {[['any', 'Any tag'], ['all', 'All tags']].map(([k, n]) => <button key={k} type="button" role="radio" aria-checked={match === k} className={match === k ? 'on' : ''} data-testid={`tag-match-${k}`} onClick={() => setMatch(k)}>{n}</button>)}
      </div>
    </div>
  );
}

/** After a bulk action that partly failed: the notes that did not work and why. `extra` is an optional button (e.g. Undo the ones that did). */
export function BulkFailDialog({ fails, extra, onClose }) {
  const ref = useRef(null);
  useDialogFocus(ref, true);
  return (
    <div className="bf-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="bf-box" role="dialog" aria-modal="true" aria-label="Notes that failed" data-testid="bulk-fail-dialog" ref={ref} tabIndex={-1}>
        <h3>{fails.length} note{fails.length === 1 ? '' : 's'} did not work</h3>
        <ul>{fails.map((f) => <li key={f.id}><b>{f.title}</b><span>{f.error}</span></li>)}</ul>
        <div className="bf-btns">{extra && <button type="button" onClick={() => { extra.run(); onClose(); }}>{extra.label}</button>}<button type="button" className="go" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
