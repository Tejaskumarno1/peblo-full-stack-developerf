import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

const KEY = 'peblo-guest-tour';
const STOPS = [
  { t: 'Find your way', b: 'Press [ to show or hide the outline, and ] for people and comments.' },
  { t: 'Keep your place', b: 'Hover a line and press B to bookmark it. Peblo also remembers where you stopped.' },
  { t: 'Tools when you want them', b: 'Press / for the tool bar, F for full screen, and ? for every shortcut.' },
];
const seen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };

/** Three small hints for someone opening a share link for the first time. Shown once, easy to skip. */
export default function GuestTour({ ready }) {
  const [show, setShow] = useState(false);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!ready || seen()) return undefined;
    const t = window.setTimeout(() => setShow(true), 1200);
    return () => window.clearTimeout(t);
  }, [ready]);
  if (!show) return null;
  const done = () => { setShow(false); try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } };
  const last = i === STOPS.length - 1;
  return (
    <div className="gt" role="dialog" aria-label="Quick tour" data-testid="guest-tour">
      <button type="button" className="gt-x" aria-label="Skip the tour" data-testid="tour-skip" onClick={done}><X size={14} /></button>
      <small>{i + 1} of {STOPS.length}</small>
      <b>{STOPS[i].t}</b>
      <p>{STOPS[i].b}</p>
      <div className="gt-row">
        <button type="button" data-testid="tour-next" onClick={() => (last ? done() : setI(i + 1))}>{last ? 'Got it' : 'Next'}</button>
      </div>
      <style>{`
.gt{position:fixed;left:16px;bottom:18px;z-index:60;width:272px;background:#1b1b22;color:#f4f4f6;border-radius:14px;padding:14px 16px 12px;box-shadow:0 14px 40px rgba(0,0,0,.35);display:flex;flex-direction:column;gap:4px;font-size:13px}
.gt small{opacity:.6;font-size:11.5px}
.gt b{font-size:14.5px}
.gt p{margin:0;line-height:1.45;opacity:.9}
.gt-row{display:flex;justify-content:flex-end;margin-top:6px}
.gt-row button{border:0;border-radius:8px;background:#fff;color:#111;font:inherit;font-weight:600;padding:6px 14px;cursor:pointer}
.gt-x{position:absolute;top:8px;right:8px;border:0;background:transparent;color:inherit;opacity:.7;cursor:pointer;display:grid;place-items:center}
@media (max-width:760px){.gt{left:12px;right:12px;width:auto;bottom:78px}}
      `}</style>
    </div>
  );
}
