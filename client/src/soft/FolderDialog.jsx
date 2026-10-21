import { useState } from 'react';
import { X, Folder } from 'lucide-react';

// Pick a folder for one note (or for all the selected notes), or start a new one.
export default function FolderDialog({ folders, current, count = 1, onPick, onClose }) {
  const [name, setName] = useState('');
  const make = (e) => { e.preventDefault(); const n = name.trim().slice(0, 60); if (n) onPick(n); };
  return (
    <div className="s-share-back" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="s-share" role="dialog" aria-label="Move to a folder">
        <div className="s-share-head">
          <div><b>Move to a folder</b><small>{count === 1 ? 'This note' : `${count} notes`}</small></div>
          <button type="button" className="s-capture-close" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={2.4} /></button>
        </div>
        <div className="s-fd-list">
          {folders.map((f) => <button key={f} type="button" className={`s-fd-item${f === current ? ' on' : ''}`} onClick={() => onPick(f)}><Folder size={14} /> {f}</button>)}
          {folders.length === 0 && <p className="s-share-msg">No folders yet. Name the first one below.</p>}
        </div>
        <form className="s-share-row" onSubmit={make}>
          <input aria-label="New folder name" placeholder="New folder name" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="s-share-go" disabled={!name.trim()}>Create</button>
        </form>
        <button type="button" className="s-share-off" onClick={() => onPick(null)}>Take out of its folder</button>
      </div>
    </div>
  );
}
