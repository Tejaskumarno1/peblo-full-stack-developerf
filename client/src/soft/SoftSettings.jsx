import { useCallback, useMemo, useRef, useState } from 'react';
import { NavLink, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Search, User, Users, Palette, PenLine, Sparkles, Plug, Link2, Archive, Keyboard, Info, Check, Bell, Laptop } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { SaveCtx, isDesktopApp } from './settings/ui';
import { ProfileSection, AccountsSection, AppearanceSection, NotesSection } from './settings/sections1';
import { AISection, ConnectSection, SharedSection, DataSection, ShortcutsSection, AboutSection, NotificationsSection, SystemSection } from './settings/sections2';
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
  { label: 'Reminders', items: [
    { id: 'notifications', name: 'Notifications', icon: Bell, view: NotificationsSection, words: 'reminder meeting popup alert notification email sound join' },
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
  { label: 'This computer', desktopOnly: true, items: [
    { id: 'system', name: 'On this computer', icon: Laptop, view: SystemSection, desktopOnly: true, words: 'startup login windows tray background quit close launch' },
  ] },
  { label: 'Help', items: [
    { id: 'shortcuts', name: 'Shortcuts', icon: Keyboard, view: ShortcutsSection, words: 'keyboard keys hotkey capture' },
    { id: 'about', name: 'About', icon: Info, view: AboutSection, words: 'version feedback address' },
  ] },
];
const TONES = { You: 'mint', 'Look and feel': 'butter', Reminders: 'sky', AI: 'lilac', Connections: 'sky', 'Your data': 'peach', 'This computer': 'line', Help: 'line' };
const SUBS = {
  profile: 'How you appear in Peblo and in notes you share.',
  accounts: 'Who you are, and which account Peblo is using right now.',
  appearance: 'Make Peblo look the way you like to work.',
  notes: 'Writing, calendar and voice.',
  notifications: 'Heads-up before meetings, and pop-up alerts.',
  system: 'How the Peblo app behaves on this computer.',
  ai: 'Choose where Peblo\'s AI runs. Your notes only leave this computer when you pick the cloud.',
  connect: 'Let other AI apps work with your Peblo, safely.',
  shared: 'Everything you have shared with a link, and who can change it.',
  data: 'Take your notes with you, bring notes in, and find deleted ones.',
  shortcuts: 'Keys that save time.',
  about: 'Version, address and feedback.',
};
GROUPS.forEach((g) => { g.tone = TONES[g.label]; g.items.forEach((i) => { i.sub = SUBS[i.id]; }); });
const ALL = GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })));
// Single settings people look for, so "find a setting" can jump straight to the right page.
const INDEX = [
  ['Change name', 'profile', 'name rename display'], ['Profile picture', 'profile', 'photo avatar image picture'], ['About you (bio)', 'profile', 'bio about role job title'],
  ['Confirm email', 'profile', 'verify verification email confirm link'], ['Change email', 'profile', 'email address change new'],
  ['Change password', 'accounts', 'password security'], ['Sign out everywhere', 'accounts', 'sign out logout devices lost laptop'], ['Switch account', 'accounts', 'add another account switch'], ['Delete account', 'accounts', 'delete remove close account'],
  ['Style (Soft, River, Orbit)', 'appearance', 'layout style soft river orbit'], ['Dark mode', 'appearance', 'dark light midnight theme colours colors system'], ['Compact mode', 'appearance', 'compact dense tighter'],
  ['Text size', 'notes', 'font size text small large'], ['Spell check', 'notes', 'spelling spellcheck typo'], ['Week starts on', 'notes', 'week monday sunday saturday calendar'], ['Time zone', 'notes', 'timezone time zone clock'],
  ['Meeting reminders', 'notifications', 'reminder meeting minutes before'], ['Pop-up alerts', 'notifications', 'popup notification desktop alert permission'],
  ['Turn off all AI', 'ai', 'ai off disable stop'], ['Add an AI key', 'ai', 'api key openai gemini claude groq model provider connect'], ['Where AI runs', 'ai', 'local cloud ollama privacy private'], ['Private notes', 'ai', 'private tag never sent'],
  ['Connect Claude', 'connect', 'claude cursor mcp connector address'], ['Connected apps', 'connect', 'revoke remove access apps'], ['Access tokens', 'connect', 'token script api'], ['App activity log', 'connect', 'activity log history'],
  ['Shared links', 'shared', 'share link stop sharing public edit view'],
  ['Export notes', 'data', 'export backup download zip markdown'], ['Import notes', 'data', 'import notion markdown csv'], ['Calendar file (.ics)', 'data', 'ics calendar google outlook export import'], ['Trash', 'data', 'trash deleted restore bin'],
  ['Quick capture key', 'shortcuts', 'capture shortcut hotkey key'], ['Keyboard shortcuts', 'shortcuts', 'keyboard keys shortcuts'],
  ['Version', 'about', 'version build about'], ['Send feedback', 'about', 'feedback bug report problem idea'], ['Uninstall Peblo', 'about', 'uninstall remove app'],
  ['Start with Windows', 'system', 'startup login launch windows boot'], ['Keep running in the tray', 'system', 'tray background quit close window'],
].map(([name, id, words]) => ({ name, id, words }));

/** Settings for every style: Soft Studio draws it as itself, River and Orbit wear their own colours and fonts (skin). */
export default function SoftSettings({ skin = 'soft' }) {
  const { section } = useParams();
  const navigate = useNavigate();
  const { updateSettings } = useAuth();
  const [status, setStatus] = useState('idle'); // idle | saving | saved | local
  const timer = useRef(null);
  const lastTry = useRef(null);
  const [q, setQ] = useState('');
  const desktop = isDesktopApp();
  const groups = useMemo(() => GROUPS.filter((g) => !g.desktopOnly || desktop), [desktop]);

  // save(patch) writes settings; save(fn) runs fn (which resolves true/false). Either way the header says what happened.
  const save = useCallback(async (what) => {
    lastTry.current = what;
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
    const visible = (i) => !i.desktopOnly || desktop;
    const bySection = ALL.filter((i) => visible(i) && `${i.name} ${i.group} ${i.words}`.toLowerCase().includes(s)).map((i) => ({ ...i, key: i.id, label: i.name, sub: i.group }));
    const bySetting = INDEX.filter((x) => `${x.name} ${x.words}`.toLowerCase().includes(s) && visible(ALL.find((i) => i.id === x.id) || {})).map((x) => { const sec = ALL.find((i) => i.id === x.id); return { ...sec, key: `${x.id}:${x.name}`, label: x.name, sub: sec.name }; });
    const seen = new Set();
    return [...bySetting, ...bySection].filter((h) => (seen.has(h.key) ? false : seen.add(h.key))).slice(0, 8);
  }, [q, desktop]);

  const current = ALL.find((i) => i.id === section && (!i.desktopOnly || desktop));
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
                  <li key={h.key}><button type="button" role="option" onClick={() => { navigate(`/settings/${h.id}`); setQ(''); }}><h.icon size={15} /> {h.label}<small>{h.sub}</small></button></li>
                ))}
              </ul>
            )}
          </div>
          <div className="s-set-chips">
          {groups.map((g) => (
            <div key={g.label} className="s-set-group">
              <span>{g.label}</span>
              {g.items.map((i) => (
                <NavLink key={i.id} to={`/settings/${i.id}`} className={({ isActive }) => `s-set-link${isActive ? ' on' : ''}`}><i className="ico" style={{ background: `var(--s-${g.tone})` }}><i.icon size={16} strokeWidth={2.2} aria-hidden="true" /></i>{i.name}</NavLink>
              ))}
            </div>
          ))}
          </div>
        </nav>

        <main className="s-set-main" aria-label={current.name}>
          <header className="s-set-head">
            <div>
              <h2 className="s-set-h2">{current.name}</h2>
              <span className="s-set-subtitle">{current.id === 'ai' && typeof window !== 'undefined' && !window.pebloDesktop ? 'Add your AI keys and pick the models Peblo uses. Notes tagged #private are never sent.' : current.sub}</span>
            </div>
            <span className={`s-set-status ${status}`} role="status" aria-live="polite">
              {status === 'idle' && 'Saved automatically'}
              {status === 'saving' && 'Saving…'}
              {status === 'saved' && <><Check size={14} strokeWidth={3} /> Saved</>}
              {status === 'local' && <>Saved on this computer only <button type="button" className="s-link-btn" onClick={() => lastTry.current && save(lastTry.current)}>Try again</button></>}
            </span>
          </header>
          <SaveCtx.Provider value={save}><View /></SaveCtx.Provider>
        </main>
      </div>
    </div>
  );
}
