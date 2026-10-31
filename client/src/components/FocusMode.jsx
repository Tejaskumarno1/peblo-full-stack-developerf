import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GripVertical, Mic, Minimize2, Timer, Volume2 } from 'lucide-react';
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

// The bar: which items show, in what order, and whether the side drawer is open. Kept for each person in this browser.
const BAR_KEY = 'peblo-fs-bar';
const readBar = () => {
  try {
    const j = JSON.parse(rd(BAR_KEY, 'null'));
    if (j && typeof j === 'object') return { order: Array.isArray(j.order) ? j.order : [], off: Array.isArray(j.off) ? j.off : [], drawer: j.drawer !== false, tab: ['bar', 'note', 'share'].includes(j.tab) ? j.tab : 'bar' };
  } catch { /* defaults */ }
  return { order: [], off: [], drawer: true, tab: 'bar' };
};
export function useBarPrefs() {
  const [b, setB] = useState(readBar);
  const upd = useCallback((patch) => setB((o) => { const n = { ...o, ...(typeof patch === 'function' ? patch(o) : patch) }; wr(BAR_KEY, JSON.stringify(n)); return n; }), []);
  return [b, upd];
}

const Svg = ({ children }) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">{children}</svg>;
const plain = (t) => String(t || '').replace(/[*_`]/g, '').trim();
const fmt = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

// words in each section (from one heading to the next), read from the page
function sectionMinutes() {
  const out = []; let words = 0; let started = false;
  document.querySelectorAll('.bn-editor .bn-block-content').forEach((el) => {
    if (el.getAttribute('data-content-type') === 'heading') { if (started) out.push(words); started = true; words = 0; return; }
    words += (el.textContent || '').trim().split(/\s+/).filter(Boolean).length;
  });
  if (started) out.push(words);
  return out.map((w) => (w > 0 ? Math.max(1, Math.round(w / 200)) : 0));
}

export default function FocusChrome({ active, prefs, set, title, saveStatus = 'saved', words = 0, docKey, outline = [], onJump, onExit, getScroller, hasOptions = false, optsOpen = false, onOptions, barItems = [], noteNode = null, shareNode = null, onQuickTask = null }) {
  const [shown, setShown] = useState(true);
  const [pct, setPct] = useState(0);
  const [cur, setCur] = useState(0);
  const [mins, setMins] = useState([]);
  const [day, setDay] = useState(readDay);
  const [bar, setBar] = useBarPrefs();
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [sprint, setSprint] = useState(null);
  const [sprintDone, setSprintDone] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [listening, setListening] = useState(false);
  const [ambient, setAmbient] = useState(false);
  const [qc, setQc] = useState(null);
  const [qcMsg, setQcMsg] = useState('');
  const [hintOn, setHintOn] = useState(false);
  const timer = useRef(0);
  const last = useRef({ x: -99, y: -99 });
  const prev = useRef(null);
  const wordsRef = useRef(words);
  wordsRef.current = words;
  const rec = useRef(null);
  const range = useRef(null);
  const audio = useRef(null);
  const [savedAt, setSavedAt] = useState(() => Date.now());
  useEffect(() => { if (saveStatus === 'saved') setSavedAt(Date.now()); }, [saveStatus]);
  const [, tick] = useState(0);
  useEffect(() => { if (!active) return undefined; const t = setInterval(() => tick((n) => n + 1), 20000); return () => clearInterval(t); }, [active]);

  const drawerOn = !!noteNode && bar.drawer;
  // the page is restyled through attributes on <html>
  useLayoutEffect(() => {
    if (!active) return undefined;
    const h = document.documentElement;
    h.setAttribute('data-fs', '1');
    return () => { h.removeAttribute('data-fs'); h.removeAttribute('data-fs-width'); h.removeAttribute('data-fs-theme'); h.removeAttribute('data-fs-outline'); h.removeAttribute('data-fs-type'); h.removeAttribute('data-fs-drawer'); h.style.removeProperty('--fs-size'); };
  }, [active]);
  useLayoutEffect(() => {
    if (!active) return;
    const h = document.documentElement;
    h.setAttribute('data-fs-type', prefs.type ? '1' : '0');
    h.setAttribute('data-fs-width', prefs.width);
    h.setAttribute('data-fs-theme', prefs.theme);
    h.setAttribute('data-fs-outline', prefs.outline ? '1' : '0');
    h.setAttribute('data-fs-drawer', drawerOn ? '1' : '0');
    h.style.setProperty('--fs-size', `${FS_SIZES[prefs.size]}px`);
  }, [active, prefs.width, prefs.theme, prefs.outline, prefs.size, prefs.type, drawerOn]);

  // the keyboard hint is shown the first three times only
  useEffect(() => {
    if (!active) { setHintOn(false); return; }
    const n = Number(rd('peblo-fs-hint', '0')) || 0;
    setHintOn(n < 3); wr('peblo-fs-hint', n + 1);
  }, [active]);

  // the bar fades two seconds after typing begins and comes back when the mouse moves
  useEffect(() => {
    if (!active) return undefined;
    setShown(true);
    const key = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || ['Shift', 'Control', 'Alt', 'Meta', 'Escape', 'Tab'].includes(e.key)) return;
      if (e.target?.closest?.('.fsx-bar, .fsx-drawer')) return;
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

  // reading progress, the heading being read, and the minutes in each section
  useEffect(() => {
    if (!active) return undefined;
    const upd = () => {
      const sc = getScroller?.();
      if (sc) { const m = sc.scrollHeight - sc.clientHeight; setPct(m > 0 ? Math.min(100, Math.max(0, (sc.scrollTop / m) * 100)) : 0); }
      const hs = [...document.querySelectorAll('.bn-editor [data-content-type="heading"]')];
      let at = -1;
      hs.forEach((el, i) => { if (el.getBoundingClientRect().top < 170) at = i; });
      setCur(Math.max(0, at));
      const m = sectionMinutes(); setMins((o) => (o.length === m.length && o.every((v, i) => v === m[i]) ? o : m));
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

  // writing sprint: 15, 25 or 45 minutes, with the words written inside it
  useEffect(() => {
    if (!sprint) return undefined;
    const t = setInterval(() => {
      const n = Date.now(); setNow(n);
      if (n >= sprint.end) { setSprintDone({ words: Math.max(0, wordsRef.current - sprint.from), mins: sprint.mins }); setSprint(null); }
    }, 1000);
    return () => clearInterval(t);
  }, [sprint]);
  useEffect(() => { if (!active) { setSprint(null); setSprintDone(null); } }, [active]);

  // dictation: speech is typed where the caret was
  useEffect(() => {
    if (!active) return undefined;
    const sel = () => { const s = window.getSelection(); if (s && s.rangeCount && s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement)?.closest?.('.bn-editor')) range.current = s.getRangeAt(0).cloneRange(); };
    document.addEventListener('selectionchange', sel);
    return () => document.removeEventListener('selectionchange', sel);
  }, [active]);
  const stopDictation = useCallback(() => { try { rec.current?.stop(); } catch { /* not running */ } rec.current = null; setListening(false); }, []);
  const toggleDictation = () => {
    if (!SR) return;
    if (listening) { stopDictation(); return; }
    const r = new SR(); r.continuous = true; r.interimResults = false; r.lang = navigator.language || 'en-US';
    r.onresult = (e) => {
      const text = [...e.results].slice(e.resultIndex).filter((x) => x.isFinal).map((x) => x[0].transcript).join(' ').trim();
      if (!text) return;
      const ed = document.querySelector('.bn-editor[contenteditable="true"], .bn-editor [contenteditable="true"]'); if (!ed) return;
      ed.focus();
      if (range.current) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(range.current); }
      document.execCommand('insertText', false, `${text} `);
    };
    r.onend = () => { if (rec.current === r) { rec.current = null; setListening(false); } };
    r.onerror = () => { if (rec.current === r) { rec.current = null; setListening(false); } };
    rec.current = r; try { r.start(); setListening(true); } catch { rec.current = null; }
  };

  // soft background sound (brown noise), made in the browser, no file needed
  const stopAmbient = useCallback(() => { try { audio.current?.src.stop(); audio.current?.ctx.close(); } catch { /* already stopped */ } audio.current = null; setAmbient(false); }, []);
  const toggleAmbient = () => {
    if (ambient) { stopAmbient(); return; }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext; const ctx = new Ctx();
      const buf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate); const d = buf.getChannelData(0); let l = 0;
      for (let i = 0; i < d.length; i += 1) { const w = Math.random() * 2 - 1; l = (l + 0.02 * w) / 1.02; d[i] = l * 3.5; }
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const g = ctx.createGain(); g.gain.value = 0.35; src.connect(g); g.connect(ctx.destination); src.start();
      audio.current = { ctx, src }; setAmbient(true);
    } catch { /* no audio in this browser */ }
  };
  useEffect(() => { if (!active) { stopDictation(); stopAmbient(); } }, [active, stopDictation, stopAmbient]);
  useEffect(() => () => { try { rec.current?.stop(); audio.current?.ctx.close(); } catch { /* gone */ } }, []);

  // quick capture: Alt+Q adds a to-do without leaving the page
  useEffect(() => {
    if (!active || !onQuickTask) return undefined;
    const k = (e) => { if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'q' || e.key === 'Q')) { e.preventDefault(); setQc(''); setQcMsg(''); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [active, onQuickTask]);
  const sendQuick = async () => {
    const t = (qc || '').trim(); if (!t) { setQc(null); return; }
    try { await onQuickTask(t); setQc(null); setQcMsg('To-do added'); setTimeout(() => setQcMsg(''), 2200); } catch { setQcMsg('Could not add the to-do'); }
  };

  if (!active || typeof document === 'undefined') return null;
  const readMins = Math.max(1, Math.round(words / 200));
  const saveState = saveStatus === 'error' ? 'error' : saveStatus === 'saving' || saveStatus === 'unsaved' ? 'saving' : 'saved';
  const saveText = saveStatus === 'error' ? "Couldn't save" : saveStatus === 'saving' ? 'Saving' : saveStatus === 'unsaved' ? 'Editing' : Date.now() - savedAt < 90000 ? 'Saved just now' : 'Saved';
  const goalPct = Math.min(100, Math.round((day.n / prefs.goal) * 100));
  const nextGoal = () => set('goal', GOALS[(GOALS.indexOf(prefs.goal) + 1) % GOALS.length] || 500);
  const btn = (label, extra = {}) => ({ type: 'button', className: `fsx-ic${extra.on ? ' on' : ''}`, 'aria-label': label, title: label, 'aria-pressed': extra.on === undefined ? undefined : !!extra.on, 'data-testid': extra.id, onClick: extra.onClick });

  // the items the person can show, hide and reorder
  const defs = [
    ...barItems,
    { id: 'normal', label: 'Normal screen', node: <button {...btn('Normal screen', { id: 'fs-normal', onClick: onExit })}><Minimize2 size={17} /></button> },
    { id: 'counter', label: 'Words today counter', node: null },
  ];
  const ids = defs.map((d) => d.id);
  const ordered = [...bar.order.filter((i) => ids.includes(i)), ...ids.filter((i) => !bar.order.includes(i))].map((i) => defs.find((d) => d.id === i));
  const visible = ordered.filter((d) => d.node && !bar.off.includes(d.id));
  const counterOn = !bar.off.includes('counter');
  const toggleItem = (id) => setBar((o) => ({ off: o.off.includes(id) ? o.off.filter((x) => x !== id) : [...o.off, id] }));
  const moveItem = (id, to) => setBar((o) => {
    const cur2 = [...o.order.filter((i) => ids.includes(i)), ...ids.filter((i) => !o.order.includes(i))];
    const a = cur2.indexOf(id); const b = cur2.indexOf(to); if (a < 0 || b < 0 || a === b) return {};
    cur2.splice(a, 1); cur2.splice(b, 0, id);
    return { order: cur2 };
  });
  const startSprint = (m) => { setSprintDone(null); setSprint({ end: Date.now() + m * 60000, from: words, mins: m }); setNow(Date.now()); };

  return createPortal(
    <div className="fsx" data-shown={shown ? '1' : '0'} data-testid="fs-root">
      <div className="fsx-progress" data-testid="fs-progress" role="progressbar" aria-label="How far through the note" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}><i style={{ width: `${pct}%` }} /></div>

      <div className="fsx-bar" role="toolbar" aria-label="Full screen tools" data-testid="fs-bar">
        <div className="fsx-title">
          <span className="t" data-testid="fs-title">{title || 'Untitled note'}</span>
          <span className="s" data-testid="fs-status"><i className={`dot ${saveState}`} />{saveText} · {words} word{words === 1 ? '' : 's'}<span className="rt"> · {readMins} min read</span></span>
        </div>
        <div className="fsx-items" data-testid="fs-items">
          {visible.map((d) => <span key={d.id} className="fsx-item" data-item={d.id}>{d.node}</span>)}
          {sprint && <span className="fsx-sprint" data-testid="fs-sprint" title="Writing sprint"><Timer size={13} />{fmt(sprint.end - now)}<b>+{Math.max(0, words - sprint.from)}</b></span>}
          {sprintDone && <button type="button" className="fsx-sprint done" data-testid="fs-sprint-done" onClick={() => setSprintDone(null)} title="Dismiss">Sprint done: +{sprintDone.words} words in {sprintDone.mins} min</button>}
        </div>
        <span className="fsx-grow" />
        <button {...btn('Outline', { on: prefs.outline, id: 'fs-outline-btn', onClick: () => set('outline', !prefs.outline) })}><Svg><path d="M4 6h16M8 12h12M12 18h8" /></Svg></button>
        <button {...btn('Typewriter mode', { on: prefs.type, id: 'fs-type', onClick: () => set('type', !prefs.type) })}><Svg><path d="M4 12h16M12 4v4M12 16v4" /></Svg></button>
        <button {...btn('Focus on one paragraph', { on: prefs.para, id: 'fs-para', onClick: () => set('para', !prefs.para) })}><Svg><path d="M4 7h16M4 12h16M4 17h16" opacity=".35" /><path d="M4 12h16" /></Svg></button>
        <button {...btn('Find in note', { id: 'fs-find', onClick: () => window.dispatchEvent(new Event('pb-find-open')) })}><Svg><circle cx="11" cy="11" r="6" /><path d="M20 20l-4-4" /></Svg></button>
        {(noteNode || hasOptions) && <button {...btn(noteNode ? 'Bar, note and share panel' : 'Note options', { on: noteNode ? drawerOn : optsOpen, id: 'fs-opts', onClick: noteNode ? () => setBar((o) => ({ drawer: !o.drawer })) : onOptions })}><Svg><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></Svg></button>}
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

      {drawerOn && (
        <aside className="fsx-drawer" data-testid="fs-drawer" aria-label="Bar, note and share">
          <div className="fsx-tabs" role="tablist">
            {[['bar', 'Bar'], ['note', 'Note'], ['share', 'Share']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={bar.tab === k} className={bar.tab === k ? 'on' : ''} data-testid={`fs-tab-${k}`} onClick={() => setBar({ tab: k })}>{l}</button>)}
          </div>
          <div className="fsx-dbody">
            {bar.tab === 'bar' && (
              <>
                <div className="fsx-dh">Show in the bar, drag to reorder</div>
                <div className="fsx-rows" data-testid="fs-rows">
                  {ordered.map((d) => (
                    <div
                      key={d.id}
                      className={`fsx-row${dragId === d.id ? ' lift' : ''}${overId === d.id && dragId && dragId !== d.id ? ' over' : ''}`}
                      data-row={d.id}
                      draggable
                      tabIndex={0}
                      onDragStart={(e) => { setDragId(d.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', d.id); } catch { /* old browser */ } }}
                      onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverId(d.id); } }}
                      onDrop={(e) => { e.preventDefault(); if (dragId) moveItem(dragId, d.id); setDragId(null); setOverId(null); }}
                      onDragEnd={() => { setDragId(null); setOverId(null); }}
                      onKeyDown={(e) => { if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); const i = ordered.findIndex((x) => x.id === d.id); const t = ordered[i + (e.key === 'ArrowUp' ? -1 : 1)]; if (t) moveItem(d.id, t.id); } }}
                    >
                      <GripVertical size={15} className="grip" aria-hidden="true" />
                      <span className="lb">{d.label}</span>
                      <button type="button" role="switch" aria-checked={!bar.off.includes(d.id)} aria-label={`Show ${d.label}`} className="fsx-sw" data-testid={`fs-sw-${d.id}`} onClick={() => toggleItem(d.id)}><i /></button>
                    </div>
                  ))}
                </div>
                <div className="fsx-dh">Focus tools</div>
                <div className="fsx-tools">
                  <div className="fsx-tool">
                    <Timer size={15} /><span className="lb">Writing sprint</span>
                    {sprint ? <button type="button" className="fsx-pill" data-testid="fs-sprint-stop" onClick={() => setSprint(null)}>Stop {fmt(sprint.end - now)}</button>
                      : [15, 25, 45].map((m) => <button key={m} type="button" className="fsx-pill" data-testid={`fs-sprint-${m}`} onClick={() => startSprint(m)}>{m}</button>)}
                  </div>
                  <div className="fsx-tool">
                    <Mic size={15} /><span className="lb">Dictation</span>
                    <button type="button" className={`fsx-pill${listening ? ' on' : ''}`} data-testid="fs-dictate" disabled={!SR} title={SR ? 'Type what you say where the cursor is' : 'This browser cannot do speech to text'} onClick={toggleDictation}>{listening ? 'Listening' : SR ? 'Start' : 'Unavailable'}</button>
                  </div>
                  <div className="fsx-tool">
                    <Volume2 size={15} /><span className="lb">Soft sound</span>
                    <button type="button" className={`fsx-pill${ambient ? ' on' : ''}`} data-testid="fs-ambient" onClick={toggleAmbient}>{ambient ? 'On' : 'Off'}</button>
                  </div>
                  {onQuickTask && <div className="fsx-tool"><span className="lb" style={{ marginLeft: 23 }}>Add a to-do from here</span><kbd>Alt+Q</kbd></div>}
                </div>
              </>
            )}
            {bar.tab === 'note' && <div className="fsx-nm" data-testid="fs-note-tab" role="menu">{noteNode}</div>}
            {bar.tab === 'share' && <div className="fsx-share" data-testid="fs-share-tab">{shareNode}</div>}
          </div>
          <div className="fsx-dfoot"><span>Opens by default on the three dots</span><button type="button" data-testid="fs-drawer-close" onClick={() => setBar({ drawer: false })}>Close</button></div>
        </aside>
      )}

      {prefs.outline && (
        <nav className="fsx-outline" aria-label="Outline" data-testid="fs-outline">
          <div className="lab">Outline</div>
          {outline.length === 0 && <div className="none">Add a heading to see it here.</div>}
          {outline.map((h, i) => (
            <button key={i} type="button" className={i === cur ? 'on' : ''} style={{ paddingLeft: (h.level - 1) * 12 }} aria-current={i === cur ? 'true' : undefined} onClick={() => onJump?.(h.text, i)}>
              <span className="mark" />
              <span className="txt">{plain(h.text)}</span>
              {mins[i] > 0 && <span className="rt" data-testid="outline-mins">{mins[i]} min</span>}
              {(h.pips || []).length > 0 && <span className="s-pips" data-testid="outline-pips">{h.pips.map((p) => <i key={p.id} title={`${p.name} is here`} style={{ background: p.color }} />)}</span>}
            </button>
          ))}
        </nav>
      )}

      {counterOn && (
        <aside className="fsx-count" aria-label="Words written today" data-testid="fs-counter">
          <span className="lab">Today</span>
          <span className="n" data-testid="fs-today">{day.n}</span>
          <span className="of">words</span>
          <span className="track" role="progressbar" aria-label="Progress to today's word goal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={goalPct}><i style={{ width: `${goalPct}%` }} /></span>
          <button type="button" className="goal" data-testid="fs-goal" title="Change the daily goal" onClick={nextGoal}>goal {prefs.goal}</button>
        </aside>
      )}

      {qc !== null && (
        <form className="fsx-quick" data-testid="fs-quick" onSubmit={(e) => { e.preventDefault(); sendQuick(); }}>
          <input autoFocus aria-label="New to-do" placeholder="Add a to-do, press Enter" value={qc} onChange={(e) => setQc(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setQc(null); } }} />
          <kbd>Enter</kbd>
        </form>
      )}
      {qcMsg && <div className="fsx-flash" role="status" data-testid="fs-flash">{qcMsg}</div>}

      {hintOn && (
        <div className="fsx-hint" data-testid="fs-hint">
          <span>Typing hides the bar. Move the mouse to bring it back.</span>
          <kbd>Ctrl+Shift+F</kbd>
        </div>
      )}
    </div>,
    document.body,
  );
}
