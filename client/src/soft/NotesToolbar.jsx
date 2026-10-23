import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { toneOf, toneVar } from './softUtils';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
export const SORTS = [['updated', 'Last edited'], ['created', 'Date created'], ['title', 'Title A to Z'], ['pinned', 'Pinned first']];
export const GROUPS = [['date', 'Date'], ['tag', 'Tag'], ['none', 'No grouping']];

/**
 * The controls above the notes list: All / Inbox, then a Tags menu (search, counts, match any or all),
 * Sort and Group menus, and the chosen tags as removable chips.
 */
export default function NotesToolbar({ allNotes, filter, setFilter, inboxCount, selTags, setSelTags, tagMatch, setTagMatch, sort, setSort, group, setGroup, resultCount }) {
  const [menu, setMenu] = useState(null); // 'tags' | 'sort' | 'group' | null
  const [q, setQ] = useState('');
  const box = useRef(null);

  useEffect(() => {
    if (!menu) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setMenu(null); };
    const esc = (e) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [menu]);

  const counts = useMemo(() => {
    const m = new Map();
    for (const n of allNotes) for (const t of n.tags || []) if (t !== 'inbox' && t !== 'private') m.set(t, (m.get(t) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [allNotes]);
  const shown = counts.filter(([t]) => t.includes(q.trim().replace(/^#/, '').toLowerCase()));
  const popular = q ? [] : shown.slice(0, 5);
  const rest = q ? shown : [...shown.slice(5)].sort((a, b) => a[0].localeCompare(b[0]));
  const toggle = (t) => setSelTags(selTags.includes(t) ? selTags.filter((x) => x !== t) : [...selTags, t]);
  const sortName = { updated: 'Edited', created: 'Created', title: 'A to Z', pinned: 'Pinned' }[sort] || 'Edited';
  const groupName = { date: 'Date', tag: 'Tag', none: 'None' }[group] || 'Date';
  const hideChips = filter === 'archive' || filter === 'trash';

  const opt = (t, n) => (
    <button key={t} type="button" role="menuitemcheckbox" aria-checked={selTags.includes(t)} className={`s-nt-opt${selTags.includes(t) ? ' on' : ''}`} onClick={() => toggle(t)}>
      <span className="box">{selTags.includes(t) && <Check size={12} strokeWidth={3.4} />}</span>
      <span className="dot" style={{ background: toneVar(toneOf(t)) }} aria-hidden="true" />
      <span className="nm">#{t}</span><span className="n">{n}</span>
    </button>
  );

  return (
    <div className="s-nt" ref={box}>
      {!hideChips && (
        <div className="s-filter" role="tablist" aria-label="Filter notes">
          <button type="button" role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'all on' : 'all'} onClick={() => setFilter('all')}>All · {allNotes.length}</button>
          <button type="button" role="tab" aria-selected={filter === 'inbox'} className={filter === 'inbox' ? 'on' : ''} style={{ background: 'var(--s-butter)' }} onClick={() => setFilter('inbox')}>Inbox{inboxCount ? ` · ${inboxCount}` : ''}</button>
        </div>
      )}
      {!hideChips && (
        <div className="s-nt-row">
          <button type="button" className={`s-nt-btn${selTags.length ? ' active' : ''}`} aria-haspopup="menu" aria-expanded={menu === 'tags'} onClick={() => setMenu(menu === 'tags' ? null : 'tags')}>
            Tags{selTags.length > 0 && <span className="badge">{selTags.length}</span>}<ChevronDown size={14} />
          </button>
          <button type="button" className="s-nt-btn" aria-haspopup="menu" aria-expanded={menu === 'sort'} onClick={() => setMenu(menu === 'sort' ? null : 'sort')}>Sort: {sortName}<ChevronDown size={14} /></button>
          <button type="button" className="s-nt-btn" aria-haspopup="menu" aria-expanded={menu === 'group'} onClick={() => setMenu(menu === 'group' ? null : 'group')}>Group: {groupName}<ChevronDown size={14} /></button>
        </div>
      )}
      {!hideChips && selTags.length > 0 && (
        <div className="s-nt-chosen">
          {selTags.map((t) => (
            <span key={t} className="s-tag" style={{ background: toneVar(toneOf(t)) }}>#{t}<button type="button" aria-label={`Remove tag ${t}`} onClick={() => toggle(t)}><X size={11} strokeWidth={2.8} /></button></span>
          ))}
          <button type="button" className="clear" onClick={() => setSelTags([])}>Clear · {resultCount} note{resultCount === 1 ? '' : 's'}</button>
        </div>
      )}

      {menu === 'tags' && (
        <div className="s-nt-pop" role="menu" aria-label="Tags">
          <label className="s-nt-search"><Search size={14} /><input autoFocus aria-label="Find a tag" placeholder="Find a tag" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <div className="s-nt-scroll">
            {counts.length === 0 && <p className="s-empty small" style={{ padding: '6px 10px' }}>No tags yet. Add one to a note.</p>}
            {popular.length > 0 && <div className="s-nt-grp">Most used</div>}
            {popular.map(([t, n]) => opt(t, n))}
            {rest.length > 0 && <div className="s-nt-grp">{q ? 'Matches' : 'All tags A to Z'}</div>}
            {rest.map(([t, n]) => opt(t, n))}
            {q && shown.length === 0 && <p className="s-empty small" style={{ padding: '6px 10px' }}>No tag matches.</p>}
          </div>
          <div className="s-nt-foot">
            <span>Match</span>
            <button type="button" className={tagMatch === 'any' ? 'on' : ''} onClick={() => setTagMatch('any')}>any</button>
            <button type="button" className={tagMatch === 'all' ? 'on' : ''} onClick={() => setTagMatch('all')}>all</button>
            <span className="grow" />
            {selTags.length > 0 && <button type="button" className="clear" onClick={() => setSelTags([])}>Clear</button>}
          </div>
        </div>
      )}
      {menu === 'sort' && (
        <div className="s-nt-pop small" role="menu" aria-label="Sort notes">
          {SORTS.map(([k, name]) => <button key={k} type="button" role="menuitemradio" aria-checked={sort === k} className="s-nt-opt" onClick={() => { setSort(k); setMenu(null); }}><span className="box round">{sort === k && <Check size={12} strokeWidth={3.4} />}</span><span className="nm">{name}</span></button>)}
        </div>
      )}
      {menu === 'group' && (
        <div className="s-nt-pop small" role="menu" aria-label="Group notes">
          {GROUPS.map(([k, name]) => <button key={k} type="button" role="menuitemradio" aria-checked={group === k} className="s-nt-opt" onClick={() => { setGroup(k); setMenu(null); }}><span className="box round">{group === k && <Check size={12} strokeWidth={3.4} />}</span><span className="nm">{name}</span></button>)}
        </div>
      )}
    </div>
  );
}

export { cap };
