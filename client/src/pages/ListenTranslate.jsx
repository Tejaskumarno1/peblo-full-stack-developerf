import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** S26: read the page aloud with the browser's own voices, paragraph by paragraph. */
export function ListenBar({ getParagraphs, onClose, onHighlight }) {
  const [paras] = useState(() => getParagraphs());
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [rate, setRate] = useState(1);
  const [voices, setVoices] = useState([]);
  const [voiceIx, setVoiceIx] = useState(0);
  const ref = useRef({ idx: 0, playing: true });
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

  useEffect(() => {
    if (!synth) return undefined;
    const load = () => setVoices(synth.getVoices());
    load(); synth.addEventListener?.('voiceschanged', load);
    return () => synth.removeEventListener?.('voiceschanged', load);
  }, [synth]);

  const speak = useCallback((i) => {
    if (!synth || i >= paras.length) { setPlaying(false); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(paras[i].text);
    u.rate = rate;
    if (voices[voiceIx]) u.voice = voices[voiceIx];
    u.onend = () => { if (ref.current.playing && ref.current.idx === i) { ref.current.idx = i + 1; setIdx(i + 1); if (i + 1 >= paras.length) setPlaying(false); else speak(i + 1); } };
    ref.current.idx = i; setIdx(i);
    onHighlight?.(paras[i].el);
    synth.speak(u);
  }, [synth, paras, rate, voices, voiceIx, onHighlight]);

  useEffect(() => { ref.current.playing = playing; }, [playing]);
  useEffect(() => { speak(ref.current.idx); /* restart on rate or voice change */ }, [rate, voiceIx]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { try { synth?.cancel(); } catch { /* none */ } onHighlight?.(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const total = paras.reduce((n, p) => n + p.text.length, 0) / (15 * rate);
  const done = paras.slice(0, idx).reduce((n, p) => n + p.text.length, 0) / (15 * rate);
  const toggle = () => { if (playing) { synth?.pause?.(); synth?.cancel(); setPlaying(false); } else { setPlaying(true); ref.current.playing = true; speak(ref.current.idx); } };
  const jump = (d) => { const n = Math.max(0, Math.min(paras.length - 1, ref.current.idx + d)); ref.current.idx = n; setPlaying(true); ref.current.playing = true; speak(n); };

  return (
    <div className="listen-bar" data-testid="listen-bar" role="region" aria-label="Listening">
      <button type="button" className="lb-play" data-testid="lb-play" aria-label={playing ? 'Pause' : 'Play'} onClick={toggle}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
      <button type="button" className="lb-ic" aria-label="Previous paragraph" onClick={() => jump(-1)}><SkipBack size={16} /></button>
      <button type="button" className="lb-ic" aria-label="Next paragraph" onClick={() => jump(1)}><SkipForward size={16} /></button>
      <span className="lb-t">{fmt(done)}</span>
      <span className="lb-bar" aria-hidden="true"><i style={{ width: `${total ? Math.min(100, (done / total) * 100) : 0}%` }} /></span>
      <span className="lb-t">{fmt(total)}</span>
      <button type="button" className="lb-chip" data-testid="lb-rate" onClick={() => setRate((r) => ({ 1: 1.25, 1.25: 1.5, 1.5: 1 })[r] || 1)}>{rate}x</button>
      {voices.length > 1 && <button type="button" className="lb-chip" data-testid="lb-voice" onClick={() => setVoiceIx((v) => (v + 1) % voices.length)}>Voice: {(voices[voiceIx]?.name || 'Default').replace(/^(Microsoft|Google)\s+/, '').split(' ')[0]}</button>}
      <button type="button" className="lb-ic" data-testid="lb-close" aria-label="Stop listening" onClick={onClose}><X size={16} /></button>
    </div>
  );
}

export const LANGUAGES = [['hi', 'Hindi'], ['te', 'Telugu'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German']];

/** S26: translate this page. The words come from the owner's AI; the original is never changed. */
export function TranslateMenu({ current, busy, onPick, onClose }) {
  return (
    <div className="menu tr-menu" role="menu" aria-label="Translate this page" data-testid="tr-menu">
      <h4>Translate this page</h4>
      <button type="button" role="menuitem" data-testid="tr-original" onClick={() => onPick(null)}><span>Original</span>{!current && <Check size={16} />}</button>
      {LANGUAGES.map(([code, name]) => <button key={code} type="button" role="menuitem" data-testid={`tr-${code}`} disabled={busy} onClick={() => onPick(code)}><span>{name}</span>{current === code && <Check size={16} />}</button>)}
      <div className="menu-note">Translated by Peblo AI. The original is kept and the owner is not changed.</div>
      <button type="button" className="tr-close" onClick={onClose} aria-label="Close">Close</button>
    </div>
  );
}
