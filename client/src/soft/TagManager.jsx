import { useEffect, useState } from 'react';
import { X, Pencil, Trash2, Check } from 'lucide-react';
import { tagsAPI } from '../api/index';
import { TONES, toneOf, toneVar, setTagTone } from './softUtils';

// Rename, merge, recolor or remove tags in one place. Renaming to a tag that exists merges the two.
export default function TagManager({ onClose, onChanged }) {
  const [tags, setTags] = useState(null);
  const [editing, setEditing] = useState(null); // { name, to }
  const [confirm, setConfirm] = useState(null); // tag name waiting for "Remove"
  const [msg, setMsg] = useState('');
  const [, bump] = useState(0);

  const load = () => tagsAPI.list().then((r) => setTags((r.data.tags || []).filter((t) => t.name !== 'inbox' && t.name !== 'private'))).catch(() => setMsg('Could not load your tags.'));
  useEffect(() => { load(); }, []);

  const rename = async () => {
    const to = editing.to.trim().replace(/^#/, '').toLowerCase();
    if (!to || to === editing.name) { setEditing(null); return; }
    try {
      const r = await tagsAPI.rename(editing.name, to);
      setMsg(r.data.merged ? `Merged #${editing.name} into #${to}.` : `Renamed to #${to}.`);
      setEditing(null); await load(); onChanged?.();
    } catch (e) { setMsg(e.response?.data?.error || 'Could not rename that tag.'); }
  };
  const remove = async (name) => {
    try { await tagsAPI.remove(name); setConfirm(null); setMsg(`Removed #${name} from your notes and tasks. Nothing else was deleted.`); await load(); onChanged?.(); }
    catch (e) { setMsg(e.response?.data?.error || 'Could not remove that tag.'); }
  };
  const paint = (name, tone) => { setTagTone(name, tone); bump((n) => n + 1); onChanged?.(); };

  return (
    <div className="s-share-back" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="s-share s-tm" role="dialog" aria-label="Manage tags">
        <div className="s-share-head">
          <div><b>Manage tags</b><small>Rename, merge, recolor or remove. Renaming to a name that exists merges them.</small></div>
          <button type="button" className="s-capture-close" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={2.4} /></button>
        </div>
        {msg && <p className="s-share-msg" role="status">{msg}</p>}
        {tags === null && !msg && <p className="s-share-msg">Loading…</p>}
        {tags && tags.length === 0 && <p className="s-share-msg">No tags yet. Add one to a note and it will show up here.</p>}
        <div className="s-tm-list">
          {(tags || []).map((t) => (
            <div key={t.name} className="s-tm-row">
              <span className="s-tm-dot" style={{ background: toneVar(toneOf(t.name)) }} aria-hidden="true" />
              {editing?.name === t.name ? (
                <form className="s-tm-edit" onSubmit={(e) => { e.preventDefault(); rename(); }}>
                  <input autoFocus aria-label={`New name for ${t.name}`} value={editing.to} onChange={(e) => setEditing({ ...editing, to: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); } }} />
                  <button type="submit" aria-label="Save name"><Check size={14} strokeWidth={2.6} /></button>
                </form>
              ) : (
                <span className="s-tm-name">#{t.name}<small>{t.notes} note{t.notes === 1 ? '' : 's'}{t.todos ? ` · ${t.todos} task${t.todos === 1 ? '' : 's'}` : ''}</small></span>
              )}
              <span className="s-tm-tones" role="group" aria-label={`Color for ${t.name}`}>
                {TONES.map((tone) => <button key={tone} type="button" className={toneOf(t.name) === tone ? 'on' : ''} style={{ background: toneVar(tone) }} aria-label={tone} onClick={() => paint(t.name, tone)} />)}
              </span>
              <button type="button" className="s-tm-btn" aria-label={`Rename ${t.name}`} onClick={() => setEditing({ name: t.name, to: t.name })}><Pencil size={13} /></button>
              {confirm === t.name
                ? <button type="button" className="s-tm-btn danger" onClick={() => remove(t.name)}>Remove from all</button>
                : <button type="button" className="s-tm-btn" aria-label={`Remove ${t.name}`} onClick={() => setConfirm(t.name)}><Trash2 size={13} /></button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
