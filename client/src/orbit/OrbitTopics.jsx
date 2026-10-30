import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { tagsAPI } from '../api';
import { useAuth } from '../context/AuthContext';
import { orbitPrefs } from './orbitPrefs';
import { LABELS, LABEL_HEX } from './taskMeta';
import { topicName } from './orbitUtils';
import { IconPicker, TOPIC_CHOICES } from './OrbitIcons';

// The saved value is still the emoji string (old data keeps working); the picker draws line icons for them.
export const TOPIC_ICONS = TOPIC_CHOICES;

/** Manage topics: rename, merge into another, delete, and give each a colour. */
export default function OrbitTopics({ onClose }) {
  const queryClient = useQueryClient();
  const { settings, updateSettings } = useAuth();
  const colors = orbitPrefs(settings).tagColors || {};
  const icons = orbitPrefs(settings).tagIcons || {};
  // One settings write per change: two writes in a row would each start from the same old copy and the second would undo the first
  const saveOrbit = async (patch, failMsg) => {
    let ok = false;
    try { ok = await updateSettings({ orbit: { ...orbitPrefs(settings), ...patch } }); } catch { ok = false; }
    if (!ok) setMsg(failMsg);
    return ok;
  };
  const saveIcon = (name, icon) => {
    const next = { ...icons };
    if (icon) next[name] = icon; else delete next[name];
    return saveOrbit({ tagIcons: next }, 'Could not save the icon.');
  };
  const [q, setQ] = useState('');
  const [working, setWorking] = useState(false);
  const [editing, setEditing] = useState(null); // { name, to }
  const [confirm, setConfirm] = useState(null); // name waiting for a second click to delete
  const [msg, setMsg] = useState('');
  const { data: tags = [], isLoading } = useQuery({
    queryKey: ['tags', 'manage'],
    queryFn: () => tagsAPI.list().then((r) => r.data.tags || []),
  });
  const known = new Set(tags.map((t) => t.name));

  const refresh = () => {
    for (const k of ['tags', 'notes', 'todos', 'study', 'dashboard']) queryClient.invalidateQueries({ queryKey: [k] });
  };
  const fail = (e) => setMsg(e.response?.data?.error || 'That did not work. Try again.');
  const saveColor = (name, c) => {
    const next = { ...colors };
    if (c) next[name] = c; else delete next[name];
    return saveOrbit({ tagColors: next }, 'Could not save the colour.');
  };
  const rename = async (e) => {
    e.preventDefault();
    if (working) return;
    const from = editing.name;
    const to = editing.to.trim().replace(/^#/, '').toLowerCase();
    if (!to || to === from) { setEditing(null); return; }
    setWorking(true);
    try {
      const r = await tagsAPI.rename(from, to);
      // the colour and icon follow the topic to its new name (kept on the target when merging into one that has its own)
      if (colors[from] || icons[from]) {
        const nc = { ...colors };
        const ni = { ...icons };
        if (colors[from]) { if (!nc[to]) nc[to] = colors[from]; delete nc[from]; }
        if (icons[from]) { if (!ni[to]) ni[to] = icons[from]; delete ni[from]; }
        await saveOrbit({ tagColors: nc, tagIcons: ni }, 'Renamed, but its colour and icon could not be moved.');
      }
      setMsg(r.data?.merged ? `Merged “${from}” into “${to}”.` : `Renamed to “${to}”.`);
      setEditing(null);
    } catch (err) { fail(err); } finally { setWorking(false); refresh(); }
  };
  const remove = async (name) => {
    if (working) return;
    if (confirm !== name) { setConfirm(name); return; }
    setWorking(true);
    try {
      await tagsAPI.remove(name);
      if (colors[name] || icons[name]) {
        const nc = { ...colors };
        const ni = { ...icons };
        delete nc[name];
        delete ni[name];
        await saveOrbit({ tagColors: nc, tagIcons: ni }, 'Removed, but its colour and icon could not be cleared.');
      }
      setMsg(`Took “${name}” off your notes and tasks. Nothing else was deleted.`);
    } catch (err) { fail(err); } finally { setWorking(false); setConfirm(null); refresh(); }
  };
  useEffect(() => { // Escape cancels a rename first, then closes the sheet
    const key = (e) => {
      if (e.key !== 'Escape') return;
      if (editing) setEditing(null); else onClose();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [editing, onClose]);

  const shown = tags.filter((t) => !['inbox', 'private'].includes(t.name) && (!q || t.name.includes(q.toLowerCase())));
  return (
    <>
      <div className="o-scrim" onMouseDown={onClose} />
      <article className="o-sheet" style={{ top: 92, width: 720 }} role="dialog" aria-label="Manage topics">
        <header className="o-sheet-head">
          <span className="crumb">Topics</span>
          <span className="grow" />
          <button type="button" className="o-btn ghost small" style={{ height: 44 }} onClick={onClose}>Close</button>
        </header>
        <div className="o-due">
          <input className="o-topic-search" aria-label="Search topics" placeholder="Search topics" value={q} onChange={(e) => setQ(e.target.value)} />
          {msg && <p className="o-quiet" role="status">{msg}</p>}
          {isLoading && <p className="o-quiet">Loading…</p>}
          {!isLoading && shown.length === 0 && <p className="o-quiet">{q ? 'No topic matches.' : 'No topics yet. Put a topic on a note and it appears here.'}</p>}
          {shown.map((t) => (
            <div key={t.name} className="o-topic-row">
              <div className="o-topic-main">
                <i className="o-dot" style={{ background: LABEL_HEX[colors[t.name]] || 'var(--o-wire)' }} />
                {editing?.name === t.name ? (
                  <form onSubmit={rename} className="o-topic-edit">
                    <input autoFocus aria-label={`New name for ${t.name}`} value={editing.to} onChange={(e) => setEditing({ ...editing, to: e.target.value })} />
                    <button type="submit" className="o-btn small" disabled={working}>{known.has(editing.to.trim().toLowerCase()) && editing.to.trim().toLowerCase() !== t.name ? 'Merge' : 'Save'}</button>
                    <button type="button" className="o-btn ghost small" onClick={() => setEditing(null)}>Cancel</button>
                  </form>
                ) : (
                  <>
                    <b>{topicName(t.name)}</b>
                    <span className="o-quiet">{t.notes} {t.notes === 1 ? 'note' : 'notes'} · {t.todos} {t.todos === 1 ? 'task' : 'tasks'}</span>
                  </>
                )}
              </div>
              {editing?.name !== t.name && (
                <div className="o-topic-acts">
                  <span className="o-colors" role="group" aria-label={`Colour for ${t.name}`}>
                    {LABELS.map((c) => <button key={c} type="button" className={`o-swatch${colors[t.name] === c ? ' on' : ''}`} style={{ background: LABEL_HEX[c] }} aria-label={`${c} for ${t.name}`} aria-pressed={colors[t.name] === c} onClick={() => saveColor(t.name, colors[t.name] === c ? null : c)} />)}
                  </span>
                  <IconPicker value={icons[t.name]} choices={TOPIC_CHOICES} subject={`Icon for ${t.name}`} popClassName="right" triggerClassName="o-chip" onChange={(v) => saveIcon(t.name, v)} />
                  <button type="button" className="o-chip" aria-label={`Rename ${t.name}`} onClick={() => { setConfirm(null); setEditing({ name: t.name, to: t.name }); }}>Rename</button>
                  <button type="button" className={`o-chip${confirm === t.name ? ' on' : ''}`} aria-label={`Delete ${t.name}`} disabled={working} onClick={() => remove(t.name)}>{confirm === t.name ? 'Confirm delete' : <X size={13} />}</button>
                </div>
              )}
            </div>
          ))}
          <p className="o-quiet">Deleting a topic only takes it off notes and tasks. Typing an existing name when renaming merges the two.</p>
        </div>
      </article>
    </>
  );
}
