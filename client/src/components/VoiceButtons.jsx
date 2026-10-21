import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Loader2, Volume2, VolumeX } from 'lucide-react';
import { useServerSpeech, makeRecognizer, transcribeBlob, speak, stopSpeaking, canSpeak } from '../utils/voice';
import '../styles/voice.css';

/** Microphone: tap, speak, tap again (or pause). The words are added to the message box. */
export function MicButton({ onText, className = '', size = 18 }) {
  const [state, setState] = useState('idle'); // idle | listening | working
  const [err, setErr] = useState('');
  const rec = useRef(null); const media = useRef(null); const timer = useRef(null);
  const cb = useRef(onText); cb.current = onText;

  useEffect(() => () => { try { rec.current?.abort(); } catch { /* */ } try { media.current?.stop(); } catch { /* */ } clearTimeout(timer.current); }, []);
  useEffect(() => { if (!err) return undefined; const t = setTimeout(() => setErr(''), 6000); return () => clearTimeout(t); }, [err]);

  const recordAndSend = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setErr('This window cannot use the microphone.'); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { setErr('Peblo needs permission to use the microphone.'); return; }
    const chunks = [];
    const mr = new MediaRecorder(stream);
    media.current = mr;
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      clearTimeout(timer.current);
      media.current = null;
      if (!chunks.length) { setState('idle'); return; }
      setState('working');
      try {
        const text = await transcribeBlob(new Blob(chunks, { type: mr.mimeType || 'audio/webm' }));
        if (text) cb.current(text); else setErr('I did not catch anything. Try again.');
      } catch (e) { setErr(e?.response?.data?.error || 'Could not turn that into text.'); }
      setState('idle');
    };
    mr.start();
    setState('listening');
    timer.current = setTimeout(() => { try { mr.stop(); } catch { /* */ } }, 60000);
  };

  const start = () => {
    setErr('');
    if (useServerSpeech()) { recordAndSend(); return; }
    const r = makeRecognizer();
    rec.current = r;
    r.lang = navigator.language || 'en-US';
    r.interimResults = false;
    r.onresult = (e) => { const t = Array.from(e.results).map((x) => x[0].transcript).join(' ').trim(); if (t) cb.current(t); };
    r.onerror = (e) => {
      if (e.error === 'network' || e.error === 'service-not-allowed') { setState('idle'); recordAndSend(); return; }
      if (e.error === 'not-allowed') setErr('Peblo needs permission to use the microphone.');
      else if (e.error !== 'no-speech' && e.error !== 'aborted') setErr('The microphone stopped: ' + e.error);
    };
    r.onend = () => setState((s) => (s === 'listening' && rec.current === r ? 'idle' : s));
    try { r.start(); setState('listening'); } catch { setState('idle'); }
  };
  const stop = () => {
    if (media.current) { try { media.current.stop(); } catch { /* */ } return; }
    try { rec.current?.stop(); } catch { /* */ }
    setState('idle');
  };

  const label = state === 'listening' ? 'Stop listening' : state === 'working' ? 'Turning your voice into text' : 'Speak your message';
  return (
    <span className="pb-voice-wrap">
      <button type="button" className={`${className} pb-mic${state === 'listening' ? ' on' : ''}`} aria-label={label} title={label} disabled={state === 'working'} onClick={state === 'listening' ? stop : start}>
        {state === 'listening' ? <Square size={size - 3} fill="currentColor" /> : state === 'working' ? <Loader2 size={size} className="pb-spin" /> : <Mic size={size} />}
      </button>
      {err && <span className="pb-voice-err" role="alert">{err}</span>}
    </span>
  );
}

/** Reads one answer aloud; tap again to stop. */
export function SpeakButton({ text, className = '', children = 'Read aloud' }) {
  const [on, setOn] = useState(false);
  useEffect(() => () => { if (on) stopSpeaking(); }, [on]);
  if (!canSpeak()) return null;
  return (
    <button type="button" className={className} aria-pressed={on} onClick={() => { if (on) { stopSpeaking(); setOn(false); } else { setOn(speak(text, () => setOn(false))); } }}>
      {on ? <VolumeX size={13} /> : <Volume2 size={13} />} {on ? 'Stop' : children}
    </button>
  );
}
