import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Search, Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { notesAPI, todosAPI, studyAPI } from '../api';
import OrbitMap from './OrbitMap';
import OrbitCapture from './OrbitCapture';
import { tagCounts, topicName, levelOf, levelVar, tagsOfNote, pickSubject } from './orbitUtils';
import { initialsOf } from '../river/riverUtils';
import './orbit.css';

const OrbitContext = createContext(null);
export const useOrbit = () => useContext(OrbitContext);

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

/** Closes a pop-over when you click outside it or press Escape. */
export function useDismiss(open, onClose) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open, onClose]);
  return ref;
}

const NAV = [
  { to: '/', end: true, label: 'Map' },
  { to: '/notes', label: 'Notes' },
  { to: '/tasks', label: 'Due' },
  { to: '/ai', end: true, label: 'Ask' },
];

/** Notes, tasks and mastery, shared by every Orbit screen. */
function useOrbitData() {
  const { data: notes = [] } = useQuery({
    queryKey: ['notes', 'sidebar'],
    queryFn: () => notesAPI.getAll({ sort: 'updated' }).then((r) => r.data.notes || []),
  });
  const { data: todos = [] } = useQuery({
    queryKey: ['todos', 'orbit-all'],
    queryFn: () => todosAPI.getAll({}).then((r) => r.data.todos || []),
  });
  const { data: masteryList = [] } = useQuery({
    queryKey: ['study', 'mastery'],
    queryFn: () => studyAPI.mastery().then((r) => r.data.mastery || []),
  });
  const mastery = useMemo(() => new Map(masteryList.map((m) => [m.topic, m])), [masteryList]);
  return { notes, todos, mastery };
}

/** The top bar: brand and space, the four places, "ask the map", capture and your menu. */
function OrbitTop({ data }) {
  const { user, theme, setTheme } = useAuth();
  const navigate = useNavigate();
  const { space, setSpace, setSelected } = useOrbit();
  const [spaceOpen, setSpaceOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [q, setQ] = useState('');
  const [askOpen, setAskOpen] = useState(false);
  const spaceRef = useDismiss(spaceOpen, () => setSpaceOpen(false));
  const menuRef = useDismiss(menu, () => setMenu(false));
  const askRef = useDismiss(askOpen, () => setAskOpen(false));
  const tags = useMemo(() => tagCounts(data.notes), [data.notes]);
  const nextTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'midnight' : 'light';

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const out = [];
    if (/weak|revise|worst|study first/.test(s)) {
      const weakest = tags.map(([t]) => ({ t, score: data.mastery.get(t)?.score })).filter((x) => x.score !== undefined).sort((a, b) => a.score - b.score)[0];
      if (weakest) out.push({ kind: 'WEAKEST', title: `${topicName(weakest.t)} · ${weakest.score}%`, tag: weakest.t });
    }
    for (const [t, n] of tags) if (t.includes(s.replace(/^#/, '')) || topicName(t).toLowerCase().includes(s)) out.push({ kind: 'TOPIC', title: topicName(t), meta: `${n} notes`, tag: t });
    for (const n of data.notes) if ((n.title || '').toLowerCase().includes(s)) out.push({ kind: 'NOTE', title: n.title || 'Untitled', note: n });
    out.splice(7);
    out.push({ kind: 'ASK', title: `Ask Peblo: "${q.trim()}"`, ask: q.trim() });
    return out;
  }, [q, tags, data]);

  const pick = (r) => {
    setAskOpen(false);
    setQ('');
    if (r.ask) navigate(`/ai?q=${encodeURIComponent(r.ask)}`);
    else if (r.note) navigate(`/notes/${r.note.id}`);
    else if (r.tag) {
      // Show the topic in the space it belongs to and select it
      if (space && space !== r.tag && !data.notes.some((n) => tagsOfNote(n).includes(space) && tagsOfNote(n).includes(r.tag))) setSpace(null);
      setSelected(`t-${r.tag}`);
      navigate('/');
    }
  };

  return (
    <header className="o-top">
      <div className="o-pill o-brand">
        <Link to="/" className="word" onClick={() => setSelected(null)}>peblo</Link>
        <span className="div" />
        <div className="o-menu-wrap" ref={spaceRef}>
          <button type="button" className="o-space" aria-expanded={spaceOpen} onClick={() => setSpaceOpen((v) => !v)}>
            Whole map <ChevronDown size={14} strokeWidth={2.4} />
          </button>
          {spaceOpen && (
            <div className="o-pop" style={{ width: 260 }}>
              <button type="button" className={!space ? 'on' : ''} onClick={() => { setSpace(null); setSpaceOpen(false); navigate('/'); }}><span className="t">Whole map</span><span className="m">{data.notes.length} notes</span></button>
              {tags.slice(0, 14).map(([t, n]) => (
                <button key={t} type="button" className={space === t ? 'on' : ''} onClick={() => { setSpace(t); setSpaceOpen(false); navigate('/'); }}>
                  <span className="dot" style={{ borderColor: levelVar(levelOf(data.mastery.get(t)?.score)) }} />
                  <span className="t">{topicName(t)}</span><span className="m">{n}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {space && (<><span className="slash">/</span><span className="crumb">{topicName(space)}</span></>)}
      </div>

      <nav aria-label="Main" className="o-pill o-nav">
        {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>{n.label}</NavLink>)}
      </nav>

      <span className="grow" />
      <div className="o-pill o-ask" ref={askRef}>
        <Search size={18} strokeWidth={2.2} aria-hidden="true" />
        <label htmlFor="orb-ask" className="o-sr">Search or ask the map</label>
        <input
          id="orb-ask"
          value={q}
          onChange={(e) => { setQ(e.target.value); setAskOpen(true); }}
          onFocus={() => setAskOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) pick(results[0]); }}
          placeholder="Ask the map: what am I weakest at?"
          autoComplete="off"
        />
        <kbd>/</kbd>
        {askOpen && q.trim() && (
          <div className="o-pop">
            {results.map((r, i) => (
              <button key={i} type="button" onClick={() => pick(r)}>
                <span className="kind">{r.kind}</span><span className="t">{r.title}</span>{r.meta && <span className="m">{r.meta}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="grow" />
      <button type="button" className="o-pill o-plus" aria-label="Capture a note or task" title="Capture" onClick={() => window.dispatchEvent(new CustomEvent('peblo:capture', { detail: space ? { tag: space } : {} }))}>
        <Plus size={20} strokeWidth={2.4} />
      </button>
      <div className="o-menu-wrap" ref={menuRef}>
        <button type="button" className="o-avatar" aria-label="Your menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>{initialsOf(user?.name)}</button>
        {menu && (
          <div className="o-pop right" role="menu" style={{ width: 230 }}>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); navigate('/ai/connections'); }}>Your AI and privacy</button>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); navigate('/calendar'); }}>This week</button>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); setTheme(nextTheme); }}>Switch to {nextTheme} theme</button>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); window.dispatchEvent(new Event('peblo:open-settings')); }}>Settings</button>
          </div>
        )}
      </div>
    </header>
  );
}

/**
 * Orbit frame: the dotted map is always there. The map screen works on it directly;
 * notes, quizzes and the due list open as sheets over it; Ask and Your AI cover it.
 */
export default function OrbitShell({ children }) {
  const { pathname } = useLocation();
  const data = useOrbitData();
  // undefined until you pick one: then the map opens on your main subject
  const [space, setSpaceState] = useState(() => load('peblo-orbit-space', undefined));
  const [selected, setSelected] = useState(null);
  const [pathOn, setPathOnState] = useState(() => load('peblo-orbit-path', true));
  const [capture, setCapture] = useState(null);

  const setSpace = (s) => { setSpaceState(s); setSelected(null); save('peblo-orbit-space', s); };
  const setPathOn = (v) => { setPathOnState(v); save('peblo-orbit-path', v); };

  // First visit: open on the main subject. A space whose tag is gone falls back to the whole map.
  useEffect(() => {
    if (!data.notes.length) return;
    if (space === undefined) setSpaceState(pickSubject(data.notes));
    else if (space && !data.notes.some((n) => tagsOfNote(n).includes(space))) setSpace(null);
  }, [space, data.notes]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const open = (e) => setCapture(e?.detail || {});
    window.addEventListener('peblo:capture', open);
    return () => window.removeEventListener('peblo:capture', open);
  }, []);

  // "/" focuses the ask box from anywhere (except while typing)
  useEffect(() => {
    const key = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey) return;
      const el = document.activeElement;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      document.getElementById('orb-ask')?.focus();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const ctx = { ...data, space: space ?? null, setSpace, selected, setSelected, pathOn, setPathOn };
  const home = pathname === '/';
  const covered = pathname.startsWith('/ai');

  return (
    <OrbitContext.Provider value={ctx}>
      <div className="orbit">
        {!covered && <OrbitMap interactive={home} />}
        <OrbitTop data={data} />
        {children}
        {capture && (
          <div className="o-capture-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setCapture(null); }}>
            <OrbitCapture preset={capture} onClose={() => setCapture(null)} />
          </div>
        )}
      </div>
    </OrbitContext.Provider>
  );
}
