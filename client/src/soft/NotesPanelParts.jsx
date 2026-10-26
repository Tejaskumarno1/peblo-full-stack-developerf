import { useEffect, useMemo, useRef, useState } from 'react';
import { Folder, Zap, Plus, X, ChevronLeft, FileText, Tag as TagIcon } from 'lucide-react';
import { FOLDER_COLORS, colorOf, RULE_FIELDS, EDITED, YESNO, opOf, tagFor, smartMatch, newId } from './folders';
import { relTime, snippetOf } from './softUtils';

/** Closes a popover or sheet when the pointer goes down outside it, or on Escape. */
export function useOutside(ref, on, close) {
  useEffect(() => {
    if (!on) return undefined;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) close(); };
    const esc = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
}

export const DEFAULT_VIEW = { sort: 'updated', group: 'date', density: 'cozy', pinFirst: true, preview: true, labels: true, subs: false };

const Seg = ({ label, value, opts, onPick }) => (
  <div>
    <h4>{label}</h4>
    <div className="np-seg" role="radiogroup" aria-label={label}>
      {opts.map(([k, name]) => <button key={k} type="button" role="radio" aria-checked={value === k} className={value === k ? 'on' : ''} onClick={() => onPick(k)}>{name}</button>)}
    </div>
  </div>
);
const Toggle = ({ label, on, onChange }) => (
  <button type="button" role="switch" aria-checked={on} className="np-tg" onClick={() => onChange(!on)}>{label}<span className={`np-sw${on ? ' on' : ''}`} aria-hidden="true" /></button>
);

/** One View menu: sort, group, density and the list switches. */
export function ViewPopover({ view, setView, onClose }) {
  const ref = useRef(null);
  useOutside(ref, true, onClose);
  const set = (k) => (v) => setView({ ...view, [k]: v });
  return (
    <div className="np-pop" role="dialog" aria-label="View options" ref={ref}>
      <Seg label="Sort by" value={view.sort} opts={[['updated', 'Edited'], ['created', 'Created'], ['title', 'Title']]} onPick={set('sort')} />
      <Seg label="Group by" value={view.group} opts={[['date', 'Date'], ['folder', 'Folder'], ['tag', 'Tag'], ['none', 'None']]} onPick={set('group')} />
      <Seg label="Density" value={view.density} opts={[['cozy', 'Cozy'], ['compact', 'Compact']]} onPick={set('density')} />
      <Toggle label="Pinned notes first" on={view.pinFirst} onChange={set('pinFirst')} />
      <Toggle label="Show preview text" on={view.preview} onChange={set('preview')} />
      <Toggle label="Show folder labels" on={view.labels} onChange={set('labels')} />
      <Toggle label="Include sub-folders" on={view.subs} onChange={set('subs')} />
      <button type="button" className="np-reset" onClick={() => setView({ ...DEFAULT_VIEW })}>Reset to default</button>
    </div>
  );
}

const Sheet = ({ label, onClose, children, cls = '', light = false }) => {
  const ref = useRef(null);
  // in select mode the sheet keeps the list usable: no dim, no close on outside click
  useOutside(ref, !light, onClose);
  useEffect(() => {
    if (!light) return undefined;
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [light]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {!light && <div className="np-dim" aria-hidden="true" />}
      <div className={`np-sheet ${cls}`} role="dialog" aria-label={label} ref={ref}>
        <div className="np-grab" aria-hidden="true" />
        {children}
      </div>
    </>
  );
};

/** Bottom sheet: pick the folder the selected notes move to. */
export function MoveSheet({ folders, current, count, bare, onMove, onNew, onClose }) {
  const [pick, setPick] = useState(current && folders.some((f) => f.name === current) ? current : null);
  return (
    <Sheet label="Move to folder" onClose={onClose} cls="move" light={bare}>
      <h4 className="np-sh">Move {count} note{count === 1 ? '' : 's'} to<small>Choose one</small></h4>
      <div className="np-fl" role="radiogroup" aria-label="Folders">
        {folders.map((f) => (
          <button key={f.id} type="button" role="radio" aria-checked={pick === f.name} className={`np-fo${pick === f.name ? ' on' : ''}`} onClick={() => setPick(f.name)}>
            <span className="sw" style={{ background: colorOf(f.color)[1] }}><Folder size={14} strokeWidth={1.8} /></span>{f.name}<span className="r" />
          </button>
        ))}
        <button type="button" role="radio" aria-checked={pick === ''} className={`np-fo${pick === '' ? ' on' : ''}`} onClick={() => setPick('')}>
          <span className="sw" style={{ background: '#F4EEE5' }}><Folder size={14} strokeWidth={1.8} /></span>No folder<span className="r" />
        </button>
        <button type="button" className="np-fo new" onClick={onNew}><span className="sw dashed"><Plus size={14} /></span>New folder...</button>
      </div>
      <button type="button" className="np-go" disabled={pick === null} onClick={() => onMove(pick)}><Folder size={16} strokeWidth={1.8} />{pick === null ? 'Choose a folder' : pick === '' ? 'Take out of folder' : `Move to ${pick}`}</button>
    </Sheet>
  );
}

/** Bottom sheet: put one tag on every selected note. */
export function TagSheet({ tags, count, bare, onApply, onClose }) {
  const [draft, setDraft] = useState('');
  const add = (e) => { e.preventDefault(); const t = draft.trim().replace(/^#/, '').toLowerCase(); if (t) onApply(t); };
  return (
    <Sheet label="Tag notes" onClose={onClose} cls="move" light={bare}>
      <h4 className="np-sh">Tag {count} note{count === 1 ? '' : 's'}<small>Pick or type one</small></h4>
      <div className="np-fl">
        {tags.slice(0, 6).map((t) => <button key={t} type="button" className="np-fo" onClick={() => onApply(t)}><span className="sw" style={{ background: '#FFE9A6' }}><TagIcon size={14} strokeWidth={1.8} /></span>#{t}</button>)}
        {tags.length === 0 && <p className="np-hint">No tags yet. Type the first one below.</p>}
      </div>
      <form className="np-add" onSubmit={add}>
        <input aria-label="New tag" placeholder="New tag" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="np-go small" disabled={!draft.trim()}>Add tag</button>
      </form>
    </Sheet>
  );
}

const Swatch = ({ tone, icon: I }) => <span className="np-swt" style={{ background: colorOf(tone)[1] }}><I size={15} strokeWidth={1.8} /></span>;
const KindSeg = ({ smart, onKind }) => (
  <div className="np-kind" role="radiogroup" aria-label="Kind of folder">
    <button type="button" role="radio" aria-checked={!smart} className={!smart ? 'on' : ''} onClick={() => onKind(false)}><Folder size={15} strokeWidth={1.8} />Folder</button>
    <button type="button" role="radio" aria-checked={smart} className={smart ? 'on' : ''} onClick={() => onKind(true)}><Zap size={15} strokeWidth={1.8} />Smart folder</button>
  </div>
);

/** Bottom sheet: create (or edit) a folder. */
export function NewFolderSheet({ defs, notes, initial, onSave, onSmart, onDelete, onClose }) {
  const edit = !!initial?.id;
  const [name, setName] = useState(initial?.name || '');
  const [color, setColor] = useState(initial?.color || 'lilac');
  const [parent, setParent] = useState(initial?.parent || '');
  const [pickParent, setPickParent] = useState(false);
  const tag = tagFor(name);
  const [collect, setCollect] = useState(edit ? !!initial.tag : true);
  const tagged = tag ? notes.filter((n) => (n.tags || []).includes(tag)).length : 0;
  const top = defs.filter((d) => !d.smart && !d.parent && d.id !== initial?.id);
  const parentName = top.find((d) => d.id === parent)?.name || 'Top level';
  const dupe = defs.some((d) => !d.smart && d.id !== initial?.id && d.name.toLowerCase() === name.trim().toLowerCase());
  const ok = name.trim() && !dupe;
  const save = () => ok && onSave({ id: initial?.id || newId(), name: name.trim().slice(0, 60), color, parent: parent || undefined, tag: collect && tag ? tag : undefined });
  return (
    <Sheet label={edit ? 'Edit folder' : 'New folder'} onClose={onClose} cls="nf">
      <h4 className="np-h4">{edit ? 'Edit folder' : 'New folder'}</h4>
      {!edit && <KindSeg smart={false} onKind={(s) => s && onSmart(name)} />}
      <div><span className="np-lab">Name</span>
        <label className="np-inp"><Swatch tone={color} icon={Folder} /><input autoFocus aria-label="Folder name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} placeholder="Folder name" /></label>
        {dupe && <p className="np-err">A folder with this name already exists.</p>}
      </div>
      <div><span className="np-lab">Colour</span>
        <div className="np-cols" role="radiogroup" aria-label="Colour">{FOLDER_COLORS.map(([k, c]) => <button key={k} type="button" role="radio" aria-checked={color === k} aria-label={k} className={color === k ? 'on' : ''} style={{ background: c }} onClick={() => setColor(k)} />)}</div>
      </div>
      <div><span className="np-lab">Inside</span>
        <div className="np-where"><Folder size={15} strokeWidth={1.8} />{parentName}<button type="button" onClick={() => setPickParent((v) => !v)}>Change</button></div>
        {pickParent && <div className="np-parents" role="radiogroup" aria-label="Parent folder">
          <button type="button" role="radio" aria-checked={!parent} className={!parent ? 'on' : ''} onClick={() => { setParent(''); setPickParent(false); }}>Top level</button>
          {top.map((d) => <button key={d.id} type="button" role="radio" aria-checked={parent === d.id} className={parent === d.id ? 'on' : ''} onClick={() => { setParent(d.id); setPickParent(false); }}>{d.name}</button>)}
        </div>}
      </div>
      {tag && <button type="button" role="switch" aria-checked={collect} className="np-tg big" onClick={() => setCollect((v) => !v)}>
        <span>Also collect notes tagged #{tag}<small>{tagged} note{tagged === 1 ? '' : 's'} already {tagged === 1 ? 'has' : 'have'} this tag</small></span><span className={`np-sw big${collect ? ' on' : ''}`} aria-hidden="true" /></button>}
      <div className="np-btns"><button type="button" onClick={onClose}>Cancel</button><button type="button" className="go" disabled={!ok} onClick={save}>{edit ? 'Save folder' : 'Create folder'}</button></div>
      {edit && <button type="button" className="np-del" onClick={onDelete}>Delete folder</button>}
    </Sheet>
  );
}

const Pick = ({ value, onChange, opts, label, cls }) => (
  <select className={`np-pick ${cls || ''}`} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>{opts.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
);

/** Whole-panel page: a smart folder is a set of rules; it shows whichever notes match. */
export function SmartFolderPage({ defs, notes, tags, folderNames, initial, startName, onSave, onKind, onDelete, onClose }) {
  const edit = !!initial?.id;
  const [name, setName] = useState(initial?.name || startName || '');
  const [rules, setRules] = useState(initial?.smart?.length ? initial.smart : [{ f: 'tag', v: tags[0] || '' }]);
  const match = useMemo(() => notes.filter((n) => smartMatch(n, rules)), [notes, rules]);
  const first = (f) => (f === 'tag' ? tags[0] || '' : f === 'edited' ? '7' : f === 'folder' ? folderNames[0] || '' : 'yes');
  const setRule = (i, p) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const valOpts = (f) => (f === 'tag' ? tags.map((t) => [t, `#${t}`]) : f === 'edited' ? EDITED : f === 'folder' ? folderNames.map((x) => [x, x]) : YESNO);
  const ok = name.trim() && rules.length > 0 && rules.every((r) => r.v);
  const dupe = defs.some((d) => d.smart && d.id !== initial?.id && d.name.toLowerCase() === name.trim().toLowerCase());
  const save = () => ok && !dupe && onSave({ id: initial?.id || newId(), name: name.trim().slice(0, 60), color: initial?.color || 'lilac', smart: rules });
  return (
    <div className="np-page" role="dialog" aria-label="New smart folder">
      <div className="np-ph"><button type="button" className="np-back" aria-label="Back" onClick={onClose}><ChevronLeft size={18} strokeWidth={1.8} /></button><b>{edit ? 'Edit smart folder' : 'New smart folder'}</b></div>
      {!edit && <KindSeg smart onKind={(s) => !s && onKind(name)} />}
      <label className="np-inp"><Swatch tone="lilac" icon={Zap} /><input autoFocus aria-label="Smart folder name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Smart folder name" /></label>
      {dupe && <p className="np-err">A smart folder with this name already exists.</p>}
      <div className="np-lab p">Notes that match</div>
      {rules.map((r, i) => (
        <div key={i} className="np-rulewrap">
          {i > 0 && <div className="np-and">AND</div>}
          <div className="np-rule">
            <Pick label="Rule field" value={r.f} opts={RULE_FIELDS} onChange={(f) => setRule(i, { f, v: first(f) })} />
            <span className="op">{opOf(r.f)}</span>
            {valOpts(r.f).length ? <Pick label="Rule value" cls="v" value={r.v} opts={valOpts(r.f)} onChange={(v) => setRule(i, { v })} /> : <span className="op">nothing yet</span>}
            <button type="button" className="x" aria-label="Remove rule" disabled={rules.length === 1} onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}><X size={15} strokeWidth={1.8} /></button>
          </div>
        </div>
      ))}
      <button type="button" className="np-addrule" onClick={() => setRules((rs) => [...rs, { f: 'tag', v: tags[0] || '' }])}><Plus size={14} strokeWidth={1.8} />Add a rule</button>
      <div className="np-pv"><header>Preview<small>{match.length} note{match.length === 1 ? '' : 's'} match</small></header>
        {match.slice(0, 4).map((n) => <div key={n.id}><FileText size={15} strokeWidth={1.8} />{n.title && n.title !== 'Untitled' ? n.title : 'Untitled'}<small>{relTime(n.updatedAt)}</small></div>)}
        {match.length === 0 && <p className="np-hint">No notes match yet.</p>}
      </div>
      <p className="np-note">A smart folder holds no notes itself. It shows every note that matches, and updates as you write or tag.</p>
      <div className="np-btns"><button type="button" onClick={onClose}>Cancel</button><button type="button" className="go" disabled={!ok || dupe} onClick={save}>{edit ? 'Save changes' : 'Save smart folder'}</button></div>
      {edit && <button type="button" className="np-del" onClick={onDelete}>Delete smart folder</button>}
    </div>
  );
}
export { snippetOf };
