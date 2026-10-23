import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import '../styles/help-dialog.css';

// PEB-167 / PEB-171: one Help dialog for every style. Press ? or use "Help and shortcuts"
// (command palette, account menu). Open it from code with window.dispatchEvent(new Event('peblo:help')).
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
const MOD = isMac ? 'Cmd' : 'Ctrl';

const SHORTCUTS = [
  { group: 'Everywhere', rows: [
    [[`${MOD}+K`], 'Command palette: jump anywhere, find a note, change style'],
    [[`${MOD}+J`], 'Open the AI Hub'],
    [['?'], 'Show this help'],
  ] },
  { group: 'Notes (Studio, Console)', rows: [
    [[`${MOD}+N`], 'New note'],
    [[`${MOD}+S`], 'Save now'],
    [[`${MOD}+P`], 'Toggle preview'],
    [[`${MOD}+/`], 'Search notes'],
  ] },
  { group: 'Orbit', rows: [[['/'], 'Ask or search the map']] },
  { group: 'Calendar', rows: [
    [['←', '→'], 'Previous / next period'],
    [['N'], 'New event'],
  ] },
  { group: 'Quick capture', rows: [
    [['Tab'], 'Switch between note and task'],
    [['Esc'], 'Close'],
  ] },
];

const NEWS = [
  ['Oct 2026', 'Undo after ticking a task, and for deleting one in Orbit and Soft Studio.'],
  ['Oct 2026', 'Orbit: ticked tasks stay in Due (struck through), with a Hide completed switch. The notes list folds big topics.'],
  ['Oct 2026', 'Orbit: a "?" guide on the map explains topics, ring colours and the revision path.'],
  ['Oct 2026', 'Note history keeps up to 50 versions, with Compare and Restore.'],
  ['Oct 2026', 'Settings → AI Providers has a switch to turn off all AI.'],
];

const FEEDBACK_URL = 'https://github.com/Tejaskumarno1/peblo-full-stack-developerf/issues/new';

const typing = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export default function HelpDialog() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('keys');
  const navigate = useNavigate();
  const { uiStyle } = useAuth();
  const closeBtn = useRef(null);

  useEffect(() => {
    const show = () => { setTab('keys'); setOpen(true); };
    const key = (e) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || typing(document.activeElement)) return;
      e.preventDefault();
      setTab('keys');
      setOpen((v) => !v);
    };
    window.addEventListener('peblo:help', show);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('peblo:help', show); window.removeEventListener('keydown', key); };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const esc = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); } };
    document.addEventListener('keydown', esc, true);
    setTimeout(() => closeBtn.current?.focus(), 30);
    return () => document.removeEventListener('keydown', esc, true);
  }, [open]);

  if (!open) return null;
  const tour = () => { setOpen(false); navigate('/'); setTimeout(() => window.dispatchEvent(new Event('peblo:orbit-tour')), 400); };
  const tabs = [['keys', 'Shortcuts'], ['news', "What's new"], ['feedback', 'Send feedback']];

  return createPortal(
    <div className="pb-help-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="pb-help" role="dialog" aria-modal="true" aria-labelledby="pb-help-title">
        <div className="pb-help-head">
          <h2 id="pb-help-title">Help</h2>
          <button ref={closeBtn} type="button" className="pb-help-x" aria-label="Close help" onClick={() => setOpen(false)}><X size={18} /></button>
        </div>
        <div className="pb-help-tabs" role="tablist">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
        <div className="pb-help-body" role="tabpanel">
          {tab === 'keys' && SHORTCUTS.map((g) => (
            <section key={g.group}>
              <h3>{g.group}</h3>
              <dl>
                {g.rows.map(([keys, what]) => (
                  <div key={what}><dt>{keys.map((k) => <kbd key={k}>{k}</kbd>)}</dt><dd>{what}</dd></div>
                ))}
              </dl>
            </section>
          ))}
          {tab === 'news' && (
            <ul className="pb-help-news">
              {NEWS.map(([when, what]) => (<li key={what}><b>{when}</b> {what}</li>))}
            </ul>
          )}
          {tab === 'feedback' && (
            <div className="pb-help-feedback">
              <p>Found a bug, or want something changed? Tell us on GitHub. Nothing is sent from here: the link opens a new issue page where you write it.</p>
              <a className="pb-help-btn" href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer">Open the feedback page</a>
            </div>
          )}
        </div>
        {uiStyle === 'orbit' && tab === 'keys' && (
          <div className="pb-help-foot"><button type="button" className="pb-help-btn" onClick={tour}>Take the map tour</button></div>
        )}
      </div>
    </div>,
    document.body,
  );
}
