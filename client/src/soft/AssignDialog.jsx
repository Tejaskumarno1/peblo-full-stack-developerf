// Who is on this task: a pop-up with a search box, everyone in the team, and a summary of who is picked.
import { useMemo, useState } from 'react';
import { Search, X, Check } from 'lucide-react';
import { Backdrop } from './spaces';
import './teamshare.css';

const AV = ['#FFD8C2', '#CDEFDC', '#FFE594', '#D3E6FF', '#E4DAFB'];
export const avColor = (id) => AV[[...String(id)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AV.length];

export default function AssignDialog({ task, people, me, picked, onToggle, onClear, onClose }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = people.filter((p) => !s || p.name.toLowerCase().includes(s));
    return [...list].sort((a, b) => (b.id === me) - (a.id === me) || a.name.localeCompare(b.name));
  }, [people, q, me]);
  const chosen = people.filter((p) => picked.includes(p.id));
  return (
    <Backdrop onClose={onClose} label="Assign this task">
      <div className="s-share-head"><div><b>Assign this task</b><small>{task.text}</small></div><button type="button" className="s-capture-close" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={2.4} /></button></div>
      <div className="ad" data-testid="assign-dialog">
        <label className="ad-search"><Search size={16} /><input autoFocus aria-label="Search people" placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        {chosen.length > 0 && (
          <div className="ad-chosen" aria-label="Picked">
            {chosen.map((p) => <button key={p.id} type="button" className="ad-pill" aria-label={`Remove ${p.name}`} onClick={() => onToggle(p.id)}><span className="kb-a" style={{ background: avColor(p.id) }}>{p.name[0]?.toUpperCase()}</span>{p.id === me ? 'Me' : p.name.split(' ')[0]}<X size={12} /></button>)}
          </div>
        )}
        <ul className="ad-list" aria-label="People">
          {shown.map((p) => {
            const on = picked.includes(p.id);
            return (
              <li key={p.id}>
                <button type="button" role="checkbox" aria-checked={on} data-testid="assign-person" className={on ? 'on' : ''} onClick={() => onToggle(p.id)}>
                  <span className="kb-a" style={{ background: avColor(p.id) }}>{p.name[0]?.toUpperCase()}</span>
                  <span className="ad-name">{p.name}{p.id === me && <em>You</em>}</span>
                  <span className="ad-tick">{on && <Check size={16} />}</span>
                </button>
              </li>
            );
          })}
          {shown.length === 0 && <li className="ad-none">Nobody matches "{q}".</li>}
        </ul>
        <div className="s-space-btns">
          <button type="button" className="s-share-go" data-testid="assign-done" onClick={onClose}>Done</button>
          {picked.length > 0 && <button type="button" className="s-space-ghost" data-testid="assign-clear" onClick={onClear}>Unassign everyone</button>}
          {me && !picked.includes(me) && <button type="button" className="s-space-ghost" data-testid="assign-me" onClick={() => onToggle(me)}>Assign to me</button>}
        </div>
      </div>
    </Backdrop>
  );
}
