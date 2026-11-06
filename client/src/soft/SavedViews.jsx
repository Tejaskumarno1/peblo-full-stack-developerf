import { useEffect, useRef, useState } from 'react';
import { Plus, MoreHorizontal } from 'lucide-react';
import { addView, renameView, updateView, duplicateView, removeView, sameView, snapshot, describe, storeViews } from './viewStore';
import './savedviews.css';

/** Chips row for saved task views, plus the save popover, view menu and delete confirm. */
export default function SavedViews({ views, setViews, current, activeId, setActiveId, onApply, say }) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [menu, setMenu] = useState(null); // view id
  const [renaming, setRenaming] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const nameRef = useRef(null);
  const cur = snapshot(current);
  const active = views.find((v) => v.id === activeId) || null;
  const dirty = active && !sameView(active, cur);
  const commit = (next) => { setViews(next); storeViews(next); };

  useEffect(() => { if (saving || renaming) nameRef.current?.focus(); }, [saving, renaming]);
  useEffect(() => {
    if (!menu && !saving) return undefined;
    const esc = (e) => { if (e.key === 'Escape') { setMenu(null); setSaving(false); setRenaming(null); } };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [menu, saving]);

  const save = (e) => {
    e.preventDefault();
    const next = addView(views, name || 'Untitled view', cur);
    commit(next);
    setActiveId(next.at(-1).id);
    setSaving(false); setName('');
    say?.(`Saved view "${next.at(-1).name}"`);
  };
  const doRename = (e) => {
    e.preventDefault();
    commit(renameView(views, renaming, nameRef.current.value));
    setRenaming(null); setMenu(null);
  };
  const apply = (v) => { setActiveId(v.id); onApply(v); setMenu(null); };

  return (
    <div className="s-views" data-testid="saved-views">
      <div className="s-views-row" role="group" aria-label="Saved views">
        <button type="button" className={`s-vchip${!active ? ' on' : ''}`} aria-pressed={!active} onClick={() => { setActiveId(null); onApply({ q: '', pill: 'all', lg: 'when', ls: 'due' }); }}>All tasks</button>
        {views.map((v) => (
          <button key={v.id} type="button" className={`s-vchip${activeId === v.id ? ' on' : ''}`} aria-pressed={activeId === v.id} onClick={() => apply(v)}>{v.name}</button>
        ))}
        <button type="button" className="s-vchip ghost" aria-expanded={saving} onClick={() => { setSaving(!saving); setMenu(null); }}><Plus size={14} /> Save this view</button>
      </div>

      {saving && (
        <form className="s-vpop" onSubmit={save} aria-label="Save this view">
          <b>Save this view</b>
          <p>Keeps the search, filter, group and sort you have now.</p>
          <label htmlFor="s-vname">Name</label>
          <input id="s-vname" ref={nameRef} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="For example, Work this week" />
          <span className="s-vcap">It will remember</span>
          <div className="s-vtags">{describe(cur).map((t) => <span key={t}>{t}</span>)}</div>
          <div className="s-vbtns"><button type="submit" className="pri">Save view</button><button type="button" onClick={() => setSaving(false)}>Cancel</button></div>
        </form>
      )}

      {active && (
        <div className="s-vactive">
          <div className="s-vinfo">
            {renaming === active.id
              ? <form onSubmit={doRename}><input ref={nameRef} defaultValue={active.name} maxLength={40} aria-label="View name" /></form>
              : <b>{active.name}</b>}
            <span className="s-vdesc">{describe(active).map((t) => <i key={t}>{t}</i>)}</span>
          </div>
          {dirty && <button type="button" className="s-vupd" onClick={() => { commit(updateView(views, active.id, cur)); say?.(`Updated "${active.name}"`); }}>Update to current filters</button>}
          <button type="button" className="s-vmore" aria-label="View menu" aria-haspopup="menu" aria-expanded={menu === active.id} onClick={() => setMenu(menu ? null : active.id)}><MoreHorizontal size={16} /></button>
          {menu === active.id && (
            <div className="s-vmenu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setRenaming(active.id); setMenu(null); }}>Rename</button>
              <button type="button" role="menuitem" disabled={!dirty} onClick={() => { commit(updateView(views, active.id, cur)); setMenu(null); }}>Update to current filters</button>
              <button type="button" role="menuitem" onClick={() => { const next = duplicateView(views, active.id); commit(next); setActiveId(next.at(-1).id); setMenu(null); }}>Duplicate</button>
              <button type="button" role="menuitem" className="danger" onClick={() => { setConfirm(active); setMenu(null); }}>Delete view</button>
            </div>
          )}
        </div>
      )}

      {confirm && (
        <div className="s-vconfirm" role="alertdialog" aria-label={`Delete ${confirm.name}`}>
          <b>Delete &ldquo;{confirm.name}&rdquo;?</b>
          <p>Only the saved view goes. No tasks are deleted.</p>
          <div className="s-vbtns">
            <button type="button" className="danger" onClick={() => { commit(removeView(views, confirm.id)); if (activeId === confirm.id) setActiveId(null); say?.(`Deleted view "${confirm.name}"`, () => { commit(views); }); setConfirm(null); }}>Yes, delete</button>
            <button type="button" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        </div>
      )}
      {views.length === 0 && !saving && <p className="s-vempty">No saved views yet. Set a filter, then press Save this view.</p>}
    </div>
  );
}

