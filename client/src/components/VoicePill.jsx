import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, GripVertical, Mic, Pause, Play, X } from 'lucide-react';
import { startDictation, startWebSpeech, warmUp, onStt, sttState } from '../utils/stt';
import './voicepill.css';

const announce = (on) => window.dispatchEvent(new CustomEvent('pb-dictation-state', { detail: { on } }));
const POS_KEY = 'peblo-voice-pos';
const readPos = () => { try { const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null; } catch { return null; } };
const savePos = (p) => { try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* private window */ } };
// CSS zoom on html or body (the text-size setting) multiplies left and top of a fixed element, so the position is divided by it
const zoomOf = () => { const z = (n) => { const v = parseFloat(getComputedStyle(n).zoom); return v > 0 ? v : 1; }; return z(document.documentElement) * z(document.body); };
const clamp = (p, w, h) => ({ x: Math.max(8, Math.min(window.innerWidth - w - 8, p.x)), y: Math.max(8, Math.min(window.innerHeight - h - 8, p.y)) });
const homeOf = (w, h) => ({ x: window.innerWidth - w - 20 - (document.documentElement.getAttribute('data-fs-drawer') === '1' ? 290 : 0), // beside the full-screen side panel, never over it
   y: window.innerHeight - h - (window.innerWidth < 1280 ? 104 : 24) });

/** The microphone control for the note editor: a small round button that opens into a pill, draggable anywhere, remembered. */
export default function VoicePill({ editor, openSignal, onActive }) {
  const [on, setOn] = useState(false);
  const [state, setState] = useState('listening'); // listening | paused | error
  const [busy, setBusy] = useState(0);
  const [level, setLevel] = useState(0);
  const [msg, setMsg] = useState('');
  const [stt, setStt] = useState(sttState());
  const [pos, setPos] = useState(() => readPos());
  const el = useRef(null);
  const ctl = useRef(null);
  const drag = useRef(null);
  const [browserSR, setBrowserSR] = useState(false);
  const usingSR = useRef(false);

  const place = useCallback((p) => {
    const b = el.current?.getBoundingClientRect();
    const w = b?.width || 44; const h = b?.height || 44;
    return clamp(p || homeOf(w, h), w, h);
  }, []);

  useEffect(() => onStt(setStt), []);
  // keep it on screen when the window changes size or the pill grows
  useEffect(() => {
    const fit = () => setPos((p) => place(p));
    window.addEventListener('resize', fit);
    fit();
    // the full-screen side panel opening or closing moves the resting place (a spot the person chose is left alone)
    const mo = new MutationObserver(() => { let saved = null; try { saved = localStorage.getItem(POS_KEY); } catch { /* x */ } if (!saved) setPos(place(null)); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-fs-drawer'] });
    return () => { window.removeEventListener('resize', fit); mo.disconnect(); };
  }, [place, on, state]);

  const insert = useCallback((text) => {
    try { editor.focus(); editor.insertInlineContent([{ type: 'text', text: `${text} `, styles: {} }]); } catch { /* no cursor in the note */ }
  }, [editor]);

  const stop = useCallback(async () => {
    const c = ctl.current; ctl.current = null;
    setOn(false); setLevel(0); setBusy(0); announce(false); onActive?.(false);
    try { await c?.stop(); } catch { /* already stopped */ }
  }, [onActive]);

  const start = useCallback(async () => {
    usingSR.current = false; setBrowserSR(false);
    setMsg(''); setState('listening'); setOn(true); announce(true); onActive?.(true);
    warmUp();
    try {
      ctl.current = await startDictation({
        text: (t) => insert(t),
        level: (l) => setLevel(l),
        busy: setBusy,
        error: () => {
          // neither Whisper nor the server could do it: carry on with the browser's own speech service if it has one
          if (!usingSR.current) {
            const sr = startWebSpeech({ text: (t) => insert(t), error: () => { setState('error'); setMsg('Voice typing is not available right now.'); } });
            if (sr) { usingSR.current = true; setBrowserSR(true); const old = ctl.current; ctl.current = sr; old?.stop?.(); return; }
          }
          setState('error'); setMsg('Could not turn that into text. Check the connection and try again.');
        },
      });
    } catch (e) {
      setState('error');
      setMsg(/denied|NotAllowed|Permission/i.test(String(e?.name || e)) ? 'The microphone is blocked. Allow it for this site and try again.' : 'No microphone was found.');
    }
  }, [insert, onActive]);

  // "Dictate" from the insert menu, and Focus mode, ask the pill to start or stop
  useEffect(() => {
    const t = (e) => { if (e.detail?.act === 'dictate') (ctl.current ? stop() : start()); };
    window.addEventListener('pb-media', t);
    return () => window.removeEventListener('pb-media', t);
  }, [start, stop]);
  useEffect(() => () => { try { ctl.current?.stop(); } catch { /* x */ } }, []);
  useEffect(() => { if (openSignal) start(); }, [openSignal]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape' && ctl.current) stop(); };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [stop]);

  const toggleDictation = () => { if (ctl.current) { if (state === 'paused') { ctl.current.resume(); setState('listening'); } else { ctl.current.pause(); setState('paused'); setLevel(0); } } };

  // dragging: pointer anywhere on the pill that is not a button; arrow keys when the grip or round button has focus
  const down = (e) => {
    if (e.button !== 0 || e.target.closest('[data-nodrag]')) return;
    const b = el.current.getBoundingClientRect();
    drag.current = { dx: e.clientX - b.left, dy: e.clientY - b.top, sx: e.clientX, sy: e.clientY, moved: false };
    el.current.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    const d = drag.current; if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
    d.moved = true;
    setPos(place({ x: e.clientX - d.dx, y: e.clientY - d.dy }));
  };
  const up = (e) => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    el.current?.releasePointerCapture?.(e.pointerId);
    if (d.moved) { setPos((p) => { savePos(p); return p; }); suppress.current = true; setTimeout(() => { suppress.current = false; }, 0); }
  };
  const suppress = useRef(false);
  const keyMove = (e) => {
    const step = e.shiftKey ? 64 : 16;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (e.key === 'Home') { e.preventDefault(); try { localStorage.removeItem(POS_KEY); } catch { /* x */ } setPos(place(null)); return; }
    if (!d) return;
    e.preventDefault();
    setPos((p) => { const n = place({ x: (p?.x ?? place(null).x) + d[0], y: (p?.y ?? place(null).y) + d[1] }); savePos(n); return n; });
  };

  const zf = zoomOf();
  const style = { left: (pos || place(null)).x / zf, top: (pos || place(null)).y / zf };
  const loading = stt.status === 'loading';
  const label = state === 'error' ? msg : state === 'paused' ? 'Paused' : browserSR ? 'Listening' : loading && stt.pct < 100 ? `Getting ready ${stt.pct}%` : busy ? 'Typing it out' : 'Listening';

  return createPortal(
    on ? (
      <div ref={el} className={`vp pill${state === 'error' ? ' err' : ''}`} role="group" aria-label="Voice typing" data-testid="dictation" data-state={state} data-engine={browserSR ? 'browser' : stt.status === 'failed' ? 'server' : stt.engine || 'loading'} style={style} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <span className="vp-grip" role="button" tabIndex={0} aria-label="Move the voice control. Arrow keys move it, Home puts it back" data-testid="voice-grip" onKeyDown={keyMove}><GripVertical size={15} /></span>
        <span className={`vp-mic${state === 'paused' ? ' off' : ''}`} style={{ '--lv': level }}><Mic size={17} /></span>
        <b className={state === 'error' ? 'msg' : ''} aria-live="polite" data-testid="dictation-status">{label}</b>
        {state !== 'error' && (
          <button type="button" data-nodrag className="vp-x" aria-label={state === 'paused' ? 'Resume' : 'Pause'} data-testid="dictation-pause" onClick={toggleDictation}>{state === 'paused' ? <Play size={14} /> : <Pause size={14} />}</button>
        )}
        <button type="button" data-nodrag className="vp-x" aria-label={state === 'error' ? 'Close' : 'Finish'} data-testid="dictation-done" onClick={stop}>{state === 'error' ? <X size={14} /> : <Check size={14} />}</button>
      </div>
    ) : (
      <button ref={el} type="button" className="vp round" aria-label="Dictate: speak and it types" title="Dictate (drag to move)" data-testid="voice-fab" style={style} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={keyMove} onClick={() => { if (!suppress.current) start(); }}>
        <Mic size={19} />
      </button>
    ),
    document.body,
  );
}
