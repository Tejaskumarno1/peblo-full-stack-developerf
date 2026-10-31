import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './focusMode.css';

/* Owner full-screen writing mode, shared by the Soft, River and Orbit note pages.
   The page keeps its own editor (so live editing, comments and saving go on as usual) and only restyles it through the
   attributes this file puts on <html>; the bar, the outline rail, today's word counter and the hint are drawn here. */

const rd = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
const wr = (k, v) => { try { localStorage.setItem(k, String(v)); } catch { /* private window: the choice lasts until the page closes */ } };
export const FS_SIZES = [17, 19, 21, 24, 28];
const GOALS = [250, 500, 750, 1000, 1500, 2000];
const dayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const readDay = () => { try { const j = JSON.parse(rd('peblo-fs-day', 'null')); if (j && j.d === dayKey() && Number.isFinite(j.n)) return j; } catch { /* start the day at zero */ } return { d: dayKey(), n: 0 }; };

// The choices people make in full screen, kept for each person in this browser.
export function useFocusPrefs() {
  const [p, setP] = useState(() => {
    const w = rd('peblo-fs-width', 'wide'); const s = Number(rd('peblo-fs-size', '2')); const g = Number(rd('peblo-fs-goal', '500'));
    return {
      width: ['narrow', 'wide', 'full'].includes(w) ? w : 'wide',
      size: Number.isInteger(s) && s >= 0 && s < FS_SIZES.length ? s : 2,
      theme: rd('peblo-fs-theme', 'light') === 'dark' ? 'dark' : 'light',
      outline: rd('peblo-fs-outline', '1') !== '0',
      type: rd('peblo-fs-typewriter', '0') === '1',
      para: rd('peblo-fs-paragraph', '0') === '1',
      goal: g > 0 ? g : 500,
    };
  });
  const set = useCallback((k, v) => {
    setP((o) => ({ ...o, [k]: v }));
    const key = { width: 'peblo-fs-width', size: 'peblo-fs-size', theme: 'peblo-fs-theme', outline: 'peblo-fs-outline', type: 'peblo-fs-typewriter', para: 'peblo-fs-paragraph', goal: 'peblo-fs-goal' }[k];
    wr(key, typeof v === 'boolean' ? (v ? '1' : '0') : v);
  }, []);
  return [p, set];
}

// Ctrl+Shift+F opens and closes full screen; Esc leaves it (unless a menu, the find box or a dialog is using Esc).
export function useFocusKeys({ enabled, active, toggle, exit }) {
  const ref = useRef({});
  ref.current = { enabled, active, toggle, exit };
  useEffect(() => {
    const k = (e) => {
      const c = ref.current;
      if (c.enabled && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); e.stopPropagation(); c.toggle(); return; }
      if (c.active && e.key === 'Escape' && !e.defaultPrevented) {
        if (document.querySelector('.bn-suggestion-menu, .pb-find, .pb-crop-veil, .pb-lightbox, .pb-sel-menu, .pb-picbar-row, [role="dialog"], [role="menu"]')) return;
        const a = document.activeElement;
        if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !a.closest('.s-note-head, .r-sheet, .o-title-row')) return;
        c.exit();
      }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, []);
}

const Svg = ({ children }) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">{children}</svg>;
const plain = (t) => String(t || '').replace(/[*_`]/g, '').trim();

export default function FocusChrome({ active, prefs, set, title, saveStatus = 'saved', words = 0, docKey, outline = [], onJump, onExit, getScroller, hasOptions = false, optsOpen = false, onOptions }) {
  const [shown, setShown] = useState(true);
  const [pct, setPct] = useState(0);
  const [cur, setCur] = useState(0);
  const [day, setDay] = useState(readDay);
  const timer = useRef(0);
  const last = useRef({ x: -99, y: -99 });
  const prev = useRef(null);
  const [savedAt, setSavedAt] = useState(() => Date.now());
  useEffect(() => { if (saveStatus === 'saved') setSavedAt(Date.now()); }, [saveStatus]);
  const [, tick] = useState(0);
  useEffect(() => { if (!active) return undefined; const t = setInterval(() => tick((n) => n + 1), 20000); return () => clearInterval(t); }, [active]);

  // the page is restyled through attributes on <html>
  useLayoutEffect(() => {
    if (!active) return undefined;
    const h = document.documentElement;
    h.setAttribute('data-fs', '1');
    return () => { h.removeAttribute('data-fs'); h.removeAttribute('data-fs-width'); h.removeAttribute('data-fs-theme'); h.removeAttribute('data-fs-outline'); h.removeAttribute('data-fs-type'); h.style.removeProperty('--fs-size'); };
  }, [active]);
  useLayoutEffect(() => {
    if (!active) return;
    const h = document.documentElement;
    h.setAttribute('data-fs-type', prefs.type ? '1' : '0');
    h.setAttribute('data-fs-width', prefs.width);
    h.setAttribute('data-fs-theme', prefs.theme);
    h.setAttribute('data-fs-outline', prefs.outline ? '1' : '0');
    h.style.setProperty('--fs-size', `${FS_SIZES[prefs.size]}px`);
  }, [active, prefs.width, prefs.theme, prefs.outline, prefs.size, prefs.type]);

  // the bar fades two seconds after typing begins and comes back when the mouse moves
  useEffect(() => {
    if (!active) return undefined;
    setShown(true);
    const key = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || ['Shift', 'Control', 'Alt', 'Meta', 'Escape', 'Tab'].includes(e.key)) return;
      if (e.target?.closest?.('.fsx-bar')) return;
      if (!e.target?.closest?.('[contenteditable="true"], input, textarea')) return;
      if (timer.current) return;
      timer.current = setTimeout(() => { timer.current = 0; setShown(false); }, 2000);
    };
    const move = (e) => {
      if (Math.abs(e.clientX - last.current.x) + Math.abs(e.clientY - last.current.y) < 4) return;
      last.current = { x: e.clientX, y: e.clientY };
      if (timer.current) { clearTimeout(timer.current); timer.current = 0; }
      setShown(true);
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('mousemove', move, true);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('mousemove', move, true); if (timer.current) { clearTimeout(timer.current); timer.current = 0; } };
  }, [active]);

  // reading progress and the heading being read
  useEffect(() => {
    if (!active) return undefined;
    const upd = () => {
      const sc = getScroller?.();
      if (sc) { const m = sc.scrollHeight - sc.clientHeight; setPct(m > 0 ? Math.min(100, Math.max(0, (sc.scrollTop / m) * 100)) : 0); }
      const hs = [...document.querySelectorAll('.bn-editor [data-content-type="heading"]')];
      let at = -1;
      hs.forEach((el, i) => { if (el.getBoundingClientRect().top < 170) at = i; });
      setCur(Math.max(0, at));
    };
    upd();
    document.addEventListener('scroll', upd, true);
    window.addEventListener('resize', upd);
    const t = setInterval(upd, 1200);
    return () => { document.removeEventListener('scroll', upd, true); window.removeEventListener('resize', upd); clearInterval(t); };
  }, [active, getScroller, words]);

  // words written today: what is added while full screen is open, kept for the day
  useEffect(() => { prev.current = null; }, [active, docKey]);
  useEffect(() => {
    if (!active) return;
    if (prev.current === null) { prev.current = words; return; }
    const d = words - prev.current; prev.current = words;
    if (d > 0 && d <= 400) { const o = readDay(); const n = { d: o.d, n: o.n + d }; wr('peblo-fs-day', JSON.stringify(n)); setDay(n); }
  }, [words, active]);

  if (!active || typeof document === 'undefined') return null;
  const mins = Math.max(1, Math.round(words / 200));
  const saveState = saveStatus === 'error' ? 'error' : saveStatus === 'saving' || saveStatus === 'unsaved' ? 'saving' : 'saved';
  const saveText = saveStatus === 'error' ? "Couldn't save" : saveStatus === 'saving' ? 'Saving' : saveStatus === 'unsaved' ? 'Editing' : Date.now() - savedAt < 90000 ? 'Saved just now' : 'Saved';
  const goalPct = Math.min(100, Math.round((day.n / prefs.goal) * 100));
  const nextGoal = () => set('goal', GOALS[(GOALS.indexOf(prefs.goal) + 1) % GOALS.length] || 500);
  const btn = (label, extra = {}) => ({ type: 'button', className: `fsx-ic${extra.on ? ' on' : ''}`, 'aria-label': label, title: label, 'aria-pressed': extra.on === undefined ? undefined : !!extra.on, 'data-testid': extra.id, onClick: extra.onClick });
  return createPortal(
    <div className="fsx" data-shown={shown ? '1' : '0'} data-testid="fs-root">
      <div className="fsx-progress" data-testid="fs-progress" role="progressbar" aria-label="How far through the note" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}><i style={{ width: `${pct}%` }} /></div>

      <div className="fsx-bar" role="toolbar" aria-label="Full screen tools" data-testid="fs-bar">
        <div className="fsx-title">
          <span className="t" data-testid="fs-title">{title || 'Untitled note'}</span>
          <span className="s" data-testid="fs-status"><i className={`dot ${saveState}`} />{saveText} · {words} word{words === 1 ? '' : 's'} · {mins} min read</span>
        </div>
        <span className="fsx-grow" />
        <button {...btn('Outline', { on: prefs.outline, id: 'fs-outline-btn', onClick: () => set('outline', !prefs.outline) })}><Svg><path d="M4 6h16M8 12h12M12 18h8" /></Svg></button>
        <button {...btn('Typewriter mode', { on: prefs.type, id: 'fs-type', onClick: () => set('type', !prefs.type) })}><Svg><path d="M4 12h16M12 4v4M12 16v4" /></Svg></button>
        <button {...btn('Focus on one paragraph', { on: prefs.para, id: 'fs-para', onClick: () => set('para', !prefs.para) })}><Svg><path d="M4 7h16M4 12h16M4 17h16" opacity=".35" /><path d="M4 12h16" /></Svg></button>
        <button {...btn('Find in note', { id: 'fs-find', onClick: () => window.dispatchEvent(new Event('pb-find-open')) })}><Svg><circle cx="11" cy="11" r="6" /><path d="M20 20l-4-4" /></Svg></button>
        {hasOptions && <button {...btn('Note options', { on: optsOpen, id: 'fs-opts', onClick: onOptions })}><Svg><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></Svg></button>}
        <span className="fsx-sep" />
        <div className="fsx-seg" role="group" aria-label="Writing width">
          {[['narrow', 'Narrow'], ['wide', 'Wide'], ['full', 'Full']].map(([k, l]) => <button key={k} type="button" aria-pressed={prefs.width === k} className={prefs.width === k ? 'on' : ''} data-testid={`fs-w-${k}`} onClick={() => set('width', k)}>{l}</button>)}
        </div>
        <div className="fsx-sizes">
          <button {...btn('Smaller text', { id: 'fs-smaller', onClick: () => set('size', Math.max(0, prefs.size - 1)) })} style={{ fontWeight: 700, fontSize: 13 }} disabled={prefs.size === 0}>A-</button>
          <button {...btn('Larger text', { id: 'fs-larger', onClick: () => set('size', Math.min(FS_SIZES.length - 1, prefs.size + 1)) })} style={{ fontWeight: 700, fontSize: 17 }} disabled={prefs.size === FS_SIZES.length - 1}>A+</button>
        </div>
        <button {...btn(prefs.theme === 'dark' ? 'Light theme' : 'Dark theme', { id: 'fs-theme', onClick: () => set('theme', prefs.theme === 'dark' ? 'light' : 'dark') })}>
          {prefs.theme === 'dark' ? <Svg><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></Svg> : <Svg><path d="M20 14A8 8 0 019.5 4 8 8 0 1020 14z" /></Svg>}
        </button>
        <button type="button" className="fsx-exit" data-testid="fs-exit" aria-label="Exit full screen" onClick={onExit}>Exit <kbd>Esc</kbd></button>
      </div>

      {prefs.outline && (
        <nav className="fsx-outline" aria-label="Outline" data-testid="fs-outline">
          <div className="lab">Outline</div>
          {outline.length === 0 && <div className="none">Add a heading to see it here.</div>}
          {outline.map((h, i) => (
            <button key={i} type="button" className={i === cur ? 'on' : ''} style={{ paddingLeft: (h.level - 1) * 12 }} aria-current={i === cur ? 'true' : undefined} onClick={() => onJump?.(h.text, i)}>
              <span className="mark" />
              <span className="txt">{plain(h.text)}</span>
              {(h.pips || []).length > 0 && <span className="s-pips" data-testid="outline-pips">{h.pips.map((p) => <i key={p.id} title={`${p.name} is here`} style={{ background: p.color }} />)}</span>}
            </button>
          ))}
        </nav>
      )}

      <aside className="fsx-count" aria-label="Words written today" data-testid="fs-counter">
        <div className="lab">Today</div>
        <div className="n" data-testid="fs-today">{day.n}</div>
        <div>words written</div>
        <div className="track" role="progressbar" aria-label="Progress to today's word goal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={goalPct}><i style={{ width: `${goalPct}%` }} /></div>
        <button type="button" className="goal" data-testid="fs-goal" title="Change the daily goal" onClick={nextGoal}>goal {prefs.goal}</button>
      </aside>

      <div className="fsx-hint" data-testid="fs-hint">
        <span>Typing hides the bar. Move the mouse to bring it back.</span>
        <kbd>Ctrl+Shift+F</kbd>
      </div>
    </div>,
    document.body,
  );
}
