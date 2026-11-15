import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import './lists.css';

/** Colours a list card can take (Soft Studio tones). */
export const LIST_TONES = [['peach', '#ffd9c9'], ['mint', '#cdebdb'], ['lilac', '#ddd8ff'], ['butter', '#fde8a9'], ['sand', '#f1e8da'], ['white', '#ffffff']];
export const toneOf = (k) => (LIST_TONES.find((t) => t[0] === k) || LIST_TONES[4])[1];
const FALLBACK = ['peach', 'mint', 'lilac', 'butter', 'sand'];
export const newListId = () => `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
export const INBOX = '__inbox';

/** Registry (account settings) plus any list name that tasks already use, so older lists keep working. */
export function withLegacyLists(reg, todos) {
  const out = [...reg];
  const seen = new Set(reg.map((l) => l.name));
  for (const t of todos) {
    const n = t.meta?.list;
    if (n && !seen.has(n)) { seen.add(n); out.push({ id: `legacy-${n}`, name: n, color: FALLBACK[out.length % FALLBACK.length], legacy: true }); }
  }
  return out;
}

/** Row of list cards: same pattern as the folder cards in Notes. */
export function ListCards({ lists, stats, sel, dragging, onOpen, onNew, onMenu, onDropTask }) {
  const [over, setOver] = useState(null);
  const drop = (key) => ({
    onDragOver: (e) => { if (dragging) { e.preventDefault(); setOver(key); } },
    onDragLeave: () => setOver((o) => (o === key ? null : o)),
    onDrop: (e) => { e.preventDefault(); setOver(null); onDropTask(key); },
  });
  const inbox = stats[INBOX] || { open: 0 };
  return (
    <div className="tl-cards" role="list" aria-label="Task lists">
      {lists.filter((l) => !l.archived).map((l) => {
        const s = stats[l.name] || { open: 0, done: 0, overdue: 0 };
        const total = s.open + s.done;
        return (
          <button key={l.id} type="button" role="listitem" data-testid="list-card" data-list={l.name} className={`tl-card${l.archived ? " arch" : ""}${sel === l.name ? ' on' : ''}${over === l.name ? ' over' : ''}`} style={{ background: toneOf(l.color) }} onClick={() => onOpen(l.name)} onContextMenu={(e) => { e.preventDefault(); onMenu(l, e.currentTarget); }} {...drop(l.name)}>
            <b>{l.name}</b>
            <span className="meta">{s.open} open{s.overdue ? ` · ${s.overdue} overdue` : ''}</span>
            {total > 0 && <span className="bar" aria-hidden="true"><i style={{ width: `${Math.round((s.done / total) * 100)}%` }} /></span>}
            <span className="foot">{over === l.name ? 'Drop to move it here' : total > 0 ? `${Math.round((s.done / total) * 100)}% done` : 'Empty for now'}</span>
            <span className="more" role="button" tabIndex={0} aria-label={`Options for ${l.name}`} onClick={(e) => { e.stopPropagation(); onMenu(l, e.currentTarget.parentElement); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onMenu(l, e.currentTarget.parentElement); } }}>...</span>
          </button>
        );
      })}
      <button type="button" className="tl-card new" onClick={onNew}><Plus size={15} strokeWidth={2.6} /> New list</button>
      <button type="button" data-testid="list-card-inbox" className={`tl-card inbox${sel === INBOX ? ' on' : ''}${over === INBOX ? ' over' : ''}`} onClick={() => onOpen(INBOX)} {...drop(INBOX)}>
        <b>Inbox</b>
        <span className="meta">{inbox.open} not sorted yet</span>
        <span className="foot">{over === INBOX ? 'Drop to take it out of its list' : 'Tasks with no list'}</span>
      </button>
    </div>
  );
}

/** Right-click menu on a list card: Rename, Colour, Archive, Share, Delete. */
export function ListMenu({ list, anchor, onRename, onColor, onArchive, onShare, onDelete, onClose }) {
  const ref = useRef(null);
  const [pane, setPane] = useState('menu');
  const [name, setName] = useState(list.name);
  useEffect(() => {
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const r = anchor?.getBoundingClientRect?.();
  const style = r ? { left: Math.min(r.left, window.innerWidth - 230), top: Math.min(r.bottom + 6, window.innerHeight - 280) } : {};
  const go = (fn) => () => { fn(); onClose(); };
  return (
    <div className="tl-menu" role="menu" aria-label={`${list.name} options`} ref={ref} style={style}>
      {pane === 'menu' && (
        <>
          <button type="button" role="menuitem" onClick={() => setPane('rename')}>Rename</button>
          <button type="button" role="menuitem" onClick={() => setPane('color')}>Colour</button>
          <button type="button" role="menuitem" onClick={go(() => onArchive(list))}>{list.archived ? 'Bring back' : 'Archive'}</button>
          {onShare && <button type="button" role="menuitem" onClick={go(() => onShare(list))}>Share</button>}
          <button type="button" role="menuitem" className="bad" onClick={go(() => onDelete(list))}>Delete</button>
        </>
      )}
      {pane === 'rename' && (
        <form onSubmit={(e) => { e.preventDefault(); const n = name.trim().slice(0, 60); if (n) { onRename(list, n); onClose(); } }}>
          <input autoFocus aria-label="List name" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="go" disabled={!name.trim()}>Save</button>
        </form>
      )}
      {pane === 'color' && (
        <div className="tl-tones" role="group" aria-label="Colour">
          {LIST_TONES.map(([k, c]) => <button key={k} type="button" aria-label={k} title={k} className={list.color === k ? 'on' : ''} style={{ background: c }} onClick={go(() => onColor(list, k))} />)}
        </div>
      )}
    </div>
  );
}

/** New list: just a name. */
export function NewListDialog({ taken, onCreate, onClose }) {
  const [name, setName] = useState('');
  const dup = taken.includes(name.trim());
  return (
    <div className="tl-back" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <form className="tl-dlg" role="dialog" aria-label="New list" onSubmit={(e) => { e.preventDefault(); if (name.trim() && !dup) onCreate(name.trim().slice(0, 60)); }}>
        <h2>New list</h2>
        <input autoFocus aria-label="List name" placeholder="Exams, Home, Work..." value={name} onChange={(e) => setName(e.target.value)} />
        {dup && <p className="warn">You already have a list with that name.</p>}
        <div className="acts"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button type="submit" className="go" disabled={!name.trim() || dup}>Create list</button></div>
      </form>
    </div>
  );
}

/** Delete a list: its tasks go to Inbox or to the trash with it. */
export function DeleteListDialog({ list, open, done, onCancel, onConfirm }) {
  const [mode, setMode] = useState('inbox');
  const n = open + done;
  return (
    <div className="tl-back" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}>
      <div className="tl-dlg" role="alertdialog" aria-label={`Delete the list ${list.name}`}>
        <h2>Delete the list {list.name}?</h2>
        <p>{n === 0 ? 'It has no tasks.' : `It holds ${open} open and ${done} finished task${n === 1 ? '' : 's'}. Pick what happens to them.`}</p>
        {n > 0 && (
          <div className="tl-opts" role="radiogroup" aria-label="What happens to the tasks">
            <button type="button" role="radio" aria-checked={mode === 'inbox'} className={mode === 'inbox' ? 'on' : ''} onClick={() => setMode('inbox')}>Move them to Inbox</button>
            <button type="button" role="radio" aria-checked={mode === 'trash'} className={mode === 'trash' ? 'on' : ''} onClick={() => setMode('trash')}>Move them to Trash with the list</button>
          </div>
        )}
        <div className="acts"><button type="button" className="ghost" onClick={onCancel}>Cancel</button><button type="button" className="go bad" autoFocus onClick={() => onConfirm(n === 0 ? 'inbox' : mode)}>Delete list</button></div>
      </div>
    </div>
  );
}

/** Small cards for "group by": pick one and only its tasks show, click again for all. */
export function MiniCards({ groups, picked, onPick }) {
  return (
    <div className="tl-mini" role="list" aria-label="Groups">
      {groups.map((g) => (
        <button key={g.key} type="button" role="listitem" data-testid="mini-card" data-key={g.key} className={`${picked === g.key ? 'on' : ''}${g.key === 'late' ? ' late' : ''}`} aria-pressed={picked === g.key} onClick={() => onPick(picked === g.key ? null : g.key)}>
          <b>{g.label}</b><span>{g.items.length} {g.items.length === 1 ? 'task' : 'tasks'}</span>
        </button>
      ))}
    </div>
  );
}
