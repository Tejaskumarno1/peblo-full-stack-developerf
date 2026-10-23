import { useCallback, useMemo, useRef, useState } from 'react';
import { NavLink, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Search, User, Users, Palette, PenLine, Sparkles, Plug, Link2, Archive, Keyboard, Info, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { SaveCtx } from './settings/ui';
import { ProfileSection, AccountsSection, AppearanceSection, NotesSection } from './settings/sections1';
import { AISection, ConnectSection, SharedSection, DataSection, ShortcutsSection, AboutSection } from './settings/sections2';
import './soft.css';
import './soft2.css';
import './settingsSkins.css';

const GROUPS = [
  { label: 'You', items: [
    { id: 'profile', name: 'Profile', icon: User, view: ProfileSection, words: 'name role photo email bio about' },
    { id: 'accounts', name: 'Accounts and sign-in', icon: Users, view: AccountsSection, words: 'password switch account sign out delete security' },
  ] },
  { label: 'Look and feel', items: [
    { id: 'appearance', name: 'Appearance', icon: Palette, view: AppearanceSection, words: 'style theme dark light midnight compact soft river orbit colours' },
    { id: 'notes', name: 'Notes and calendar', icon: PenLine, view: NotesSection, words: 'text size font week monday sunday voice' },
  ] },
  { label: 'AI', items: [
    { id: 'ai', name: 'AI and models', icon: Sparkles, view: AISection, words: 'ollama openai gemini key local cloud privacy model routing off' },
  ] },
  { label: 'Connections', items: [
    { id: 'connect', name: 'Connect apps', icon: Plug, view: ConnectSection, words: 'claude mcp cursor connector token address' },
    { id: 'shared', name: 'Shared links', icon: Link2, view: SharedSection, words: 'share link public edit view stop' },
  ] },
  { label: 'Your data', items: [
    { id: 'data', name: 'Back up, import, trash', icon: Archive, view: DataSection, words: 'export import backup notion zip trash csv' },
  ] },
  { label: 'Help', items: [
    { id: 'shortcuts', name: 'Shortcuts', icon: Keyboard, view: ShortcutsSection, words: 'keyboard keys hotkey capture' },
    { id: 'about', name: 'About', icon: Info, view: AboutSection, words: 'version feedback address' },
  ] },
];
const TONES = { You: 'mint', 'Look and feel': 'butter', AI: 'lilac', Connections: 'sky', 'Your data': 'peach', Help: 'line' };
const SUBS = {
  profile: 'How you appear in Peblo and in notes you share.',
  accounts: 'Who you are, and which account Peblo is using right now.',
  appearance: 'Make Peblo look the way you like to work.',
  notes: 'Writing, calendar and voice.',
  ai: 'Choose where Peblo\'s AI runs. Your notes only leave this computer when you pick the cloud.',
  connect: 'Let other AI apps work with your Peblo, safely.',
  shared: 'Everything you have shared with a link, and who can change it.',
  data: 'Take your notes with you, bring notes in, and find deleted ones.',
  shortcuts: 'Keys that save time.',
  about: 'Version, address and feedback.',
};
GROUPS.forEach((g) => { g.tone = TONES[g.label]; g.items.forEach((i) => { i.sub = SUBS[i.id]; }); });
const ALL = GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })));

/** Settings for every style: Soft Studio draws it as itself, River and Orbit wear their own colours and fonts (skin). */
export default function SoftSettings({ skin = 'soft' }) {
  const { section } = useParams();
  const navigate = useNavigate();
  const { updateSettings } = useAuth();
  const [status, setStatus] = useState('idle'); // idle | saving | saved | local
  const timer = useRef(null);
  const [q, setQ] = useState('');

  // save(patch) writes settings; save(fn) runs fn (which resolves true/false). Either way the header says what happened.
  const save = useCallback(async (what) => {
    setStatus('saving');
    let ok = true;
    try { ok = await (typeof what === 'function' ? what() : updateSettings(what)); } catch { ok = false; }
    setStatus(ok === false ? 'local' : 'saved');
    clearTimeout(timer.current);
    if (ok !== false) timer.current = setTimeout(() => setStatus('idle'), 2400);
    return ok !== false;
  }, [updateSettings]);

  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return ALL.filter((i) => `${i.name} ${i.group} ${i.words}`.toLowerCase().includes(s)).slice(0, 6);
  }, [q]);

  const current = ALL.find((i) => i.id === section);
  if (!current) return <Navigate to="/settings/profile" replace />;
  const View = current.view;

  return (
    <div className={skin === 'soft' ? 'soft-page s-set' : `soft s-skin s-skin-${skin} s-set`}>
      <div className="s-set-body">
        <nav className="s-set-nav" aria-label="Settings sections">
          <h1 className="s-set-h1">Settings</h1>
          <div className="s-set-find">
            <Search size={15} aria-hidden="true" />
            <input type="search" value={q} placeholder="Find a setting" aria-label="Find a setting" onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) { navigate(`/settings/${hits[0].id}`); setQ(''); } if (e.key === 'Escape') setQ(''); }} />
            {q && (
              <ul className="s-set-hits" role="listbox">
                {hits.length === 0 && <li className="none">No setting matches that</li>}
                {hits.map((h) => (
                  <li key={h.id}><button type="button" role="option" onClick={() => { navigate(`/settings/${h.id}`); setQ(''); }}><h.icon size={15} /> {h.name}<small>{h.group}</small></button></li>
                ))}
              </ul>
            )}
          </div>
          {GROUPS.map((g) => (
            <div key={g.label} className="s-set-group">
              <span>{g.label}</span>
              {g.items.map((i) => (
                <NavLink key={i.id} to={`/settings/${i.id}`} className={({ isActive }) => `s-set-link${isActive ? ' on' : ''}`}><i className="dot" style={{ background: `var(--s-${g.tone})` }} />{i.name}</NavLink>
              ))}
            </div>
          ))}
        </nav>

        <main className="s-set-main" aria-label={current.name}>
          <header className="s-set-head">
            <div>
              <h2 className="s-set-h2">{current.name}</h2>
              <span className="s-set-subtitle">{current.sub}</span>
            </div>
            <span className={`s-set-status ${status}`} role="status" aria-live="polite">
              {status === 'idle' && 'Saved automatically'}
              {status === 'saving' && 'Saving…'}
              {status === 'saved' && <><Check size={14} strokeWidth={3} /> Saved</>}
              {status === 'local' && 'Saved on this computer only'}
            </span>
          </header>
          <SaveCtx.Provider value={save}><View /></SaveCtx.Provider>
        </main>
      </div>
    </div>
  );
}
