import { useEffect, useRef, useState } from 'react';
import { Undo2, Redo2 } from 'lucide-react';
import './bulk.css';

const KEYS_ANYWHERE = [['New task', ['N']], ['Search', ['/']], ['Command palette', ['Ctrl', 'K']], ['This help', ['?']]];
const KEYS_TASK = [
  ['Move up and down', ['J', 'K']], ['Complete', ['X'], 'or', ['Space']], ['Edit', ['E']], ['Priority 1, 2, 3', ['1', '2', '3']],
  ['Due today, tomorrow', ['T', 'M']], ['Select', ['S']], ['Undo, redo', ['Ctrl', 'Z']],
];
const Keys = ({ k }) => k.map((x, i) => <kbd key={i}>{x}</kbd>);

/** Press ? on the Tasks page. */
export function ShortcutSheet({ onClose }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const row = ([name, a, mid, b]) => (
    <div className="kr" key={name}>{name}<span><Keys k={a} />{mid ? <> {mid} <Keys k={b} /></> : null}</span></div>
  );
  return (
    <div className="s-keys-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="s-keys" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" tabIndex={-1} ref={ref} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <h2>Keyboard</h2>
        <div className="sec">Anywhere</div>
        {KEYS_ANYWHERE.map(row)}
        <div className="sec">On a task</div>
        {KEYS_TASK.map(row)}
      </div>
    </div>
  );
}

const DATES = [['today', 'Today'], ['tomorrow', 'Tomorrow'], ['weekend', 'This weekend'], ['nextweek', 'Next week'], ['none', 'No date']];
const PRIOS = [['high', 'High'], ['medium', 'Normal'], ['low', 'Low']];

/** The dark pill at the bottom while tasks are selected. */
export function BulkBar({ count, lists = [], onDone, onDate, onMove, onTag, onPriority, onDelete, onCancel }) {
  const [menu, setMenu] = useState(null);
  const [text, setText] = useState('');
  const pick = (fn) => (v) => { setMenu(null); setText(''); fn(v); };
  const open = (k) => { setText(''); setMenu((m) => (m === k ? null : k)); };
  return (
    <div className="s-bulk" role="toolbar" aria-label="Bulk actions" data-testid="bulk-bar">
      {menu && (
        <div className="s-bulk-menu" role="menu" aria-label={menu}>
          {menu === 'date' && DATES.map(([k, n]) => <button key={k} type="button" role="menuitem" onClick={() => pick(onDate)(k)}>{n}</button>)}
          {menu === 'priority' && PRIOS.map(([k, n]) => <button key={k} type="button" role="menuitem" onClick={() => pick(onPriority)(k)}>{n}</button>)}
          {menu === 'move' && (
            <>
              <button type="button" role="menuitem" onClick={() => pick(onMove)('')}>Inbox</button>
              {lists.map((l) => <button key={l} type="button" role="menuitem" onClick={() => pick(onMove)(l)}>{l}</button>)}
              <input aria-label="New list name" placeholder="New list, press Enter" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { e.preventDefault(); pick(onMove)(text.trim()); } }} />
            </>
          )}
          {menu === 'tag' && <input aria-label="Tag to add" autoFocus placeholder="Tag name, press Enter" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { e.preventDefault(); pick(onTag)(text.trim().replace(/^#/, '').toLowerCase()); } }} />}
        </div>
      )}
      <span className="n">{count}</span>
      <button type="button" className="go" onClick={onDone}>Done</button>
      <button type="button" aria-expanded={menu === 'date'} onClick={() => open('date')}>Date</button>
      <button type="button" aria-expanded={menu === 'move'} onClick={() => open('move')}>Move</button>
      <button type="button" aria-expanded={menu === 'tag'} onClick={() => open('tag')}>Tag</button>
      <button type="button" aria-expanded={menu === 'priority'} onClick={() => open('priority')}>Priority</button>
      <button type="button" className="del" onClick={onDelete}>Delete</button>
      <button type="button" className="x" onClick={onCancel} aria-label="Cancel selection">Cancel</button>
    </div>
  );
}

/** "Undo the last change" chip with Redo. */
export function UndoRedo({ canUndo, canRedo, label, onUndo, onRedo }) {
  if (!canUndo && !canRedo) return null;
  return (
    <div className="s-undoredo" data-testid="undo-redo">
      <button type="button" disabled={!canUndo} onClick={onUndo}><Undo2 size={13} /> {canUndo ? `Undo ${label}` : 'Undo'} <kbd>Ctrl Z</kbd></button>
      <button type="button" disabled={!canRedo} onClick={onRedo}><Redo2 size={13} /> Redo <kbd>Ctrl Shift Z</kbd></button>
    </div>
  );
}

/** What deleting will take with it, so a repeating task never goes without a word. */
export function DeleteConfirm({ tasks, repeating, occurrences, onCancel, onConfirm }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="s-keys-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="s-del" role="dialog" aria-modal="true" aria-label="Delete tasks" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}>
        <h2>Delete {tasks} task{tasks === 1 ? '' : 's'}?</h2>
        <p>
          {repeating > 0
            ? `${repeating} of them repeat${repeating === 1 ? 's' : ''}. Every copy goes too: ${occurrences} in all. `
            : ''}
          You can undo this for a few seconds.
        </p>
        <div className="row">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="warn" ref={ref} onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}
