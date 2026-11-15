import api from '../api/client';

/*
 * Speech to text, best first:
 *   1. Whisper (tiny) in the browser, in a worker. Open source, private (the audio never leaves the device),
 *      works in the desktop app, needs no server. The model (about 40 MB) downloads once and is cached.
 *   2. The server's /api/ai/transcribe (the AI provider's speech service).
 *   3. The browser's own SpeechRecognition (callers handle this one, it cannot take recorded audio).
 */

let state = { status: 'idle', pct: 0, engine: null, error: '' }; // idle | loading | ready | failed
const listeners = new Set();
const set = (p) => { state = { ...state, ...p }; listeners.forEach((f) => f(state)); };
export const sttState = () => state;
export const onStt = (f) => { listeners.add(f); return () => listeners.delete(f); };

let worker = null;
let readyP = null;
let seq = 0;
const waiting = new Map();

function boot() {
  if (readyP) return readyP;
  readyP = new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined') { reject(new Error('no workers')); return; }
    try { worker = new Worker(new URL('./whisper.worker.js', import.meta.url), { type: 'module' }); } catch (e) { reject(e); return; }
    worker.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'progress') set({ status: 'loading', pct: m.pct });
      else if (m.type === 'ready') { set({ status: 'ready', pct: 100, engine: 'whisper' }); resolve(); }
      else if (m.type === 'fail') reject(new Error(m.error));
      else if (m.type === 'result') { waiting.get(m.id)?.res(m.text); waiting.delete(m.id); }
      else if (m.type === 'error') { waiting.get(m.id)?.rej(new Error(m.error)); waiting.delete(m.id); }
    };
    worker.onerror = (e) => reject(new Error(e.message || 'the speech worker stopped'));
    set({ status: 'loading', pct: 0, error: '' });
    worker.postMessage({ type: 'load', lang: navigator.language || 'en' });
  }).catch((e) => {
    readyP = null;
    try { worker?.terminate(); } catch { /* gone */ }
    worker = null;
    set({ status: 'failed', error: e.message || String(e) });
    throw e;
  });
  return readyP;
}

/** Start fetching the model early (opening the voice control does this) so the first sentence is not slow. */
export const warmUp = () => { if (state.status === 'idle') boot().catch(() => {}); };
export const localReady = () => state.status === 'ready';
export const localFailed = () => state.status === 'failed';

/** Whisper writes these when it hears no speech. */
const NOISE = /^[\s.…]*$|^[\[(*].*[\])*]$|^(thank you\.?|thanks for watching\.?|you)$/i;
export const cleanText = (t) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return NOISE.test(s) ? '' : s; };

function localTranscribe(pcm) {
  return boot().then(() => new Promise((resolve, reject) => {
    const id = (seq += 1);
    waiting.set(id, { res: resolve, rej: reject });
    const copy = pcm.slice();
    worker.postMessage({ type: 'run', id, audio: copy }, [copy.buffer]);
  }));
}

export function pcmToWavBase64(pcm, rate = 16000) {
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  w(36, 'data'); out.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  const bytes = new Uint8Array(out.buffer);
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** 16 kHz mono samples to text: Whisper here, else the server. Throws when neither can. */
export async function transcribeSamples(pcm) {
  if (state.status !== 'failed') {
    try { return { text: cleanText(await localTranscribe(pcm)), engine: 'whisper' }; } catch { /* fall through to the server */ }
  }
  const { data } = await api.post('/ai/transcribe', { audio: pcmToWavBase64(pcm), mime: 'audio/wav' });
  return { text: cleanText(data.text), engine: 'server' };
}

/** A recording (webm, wav...) to 16 kHz mono samples. */
export async function decodeToPcm(blob) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  ctx.close?.();
  const rate = 16000;
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * rate)), rate);
  const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
  return (await off.startRendering()).getChannelData(0);
}

/**
 * Dictation: listens, cuts the speech into sentences at the pauses, and hands each to transcribeSamples.
 * on: { text(t), level(0..1), busy(n), error(err) }. Returns { pause(), resume(), stop() }.
 */
export async function startDictation(on) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  const Ctx = window.AudioContext || window.webkitAudioContext;
  let ctx;
  try { ctx = new Ctx({ sampleRate: 16000 }); } catch { ctx = new Ctx(); }
  await ctx.resume?.();
  const rate = ctx.sampleRate;
  const src = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain(); mute.gain.value = 0;
  src.connect(node); node.connect(mute); mute.connect(ctx.destination);

  let paused = false; let stopped = false;
  let chunks = []; let speech = 0; let quiet = 0; let total = 0;
  let floor = 0.008;
  const pre = []; // a little sound before the first word, so it is not clipped
  let queue = Promise.resolve(); let pending = 0;

  const flush = () => {
    const had = speech; const parts = chunks; chunks = []; speech = 0; quiet = 0; total = 0;
    if (had < 0.35 * rate) return; // a click or a cough, not a sentence
    const pcm = new Float32Array(parts.reduce((n, c) => n + c.length, 0));
    let o = 0; for (const c of parts) { pcm.set(c, o); o += c.length; }
    pending += 1; on.busy?.(pending);
    queue = queue.then(async () => {
      try { const r = await transcribeSamples(pcm); if (r.text) on.text?.(r.text, r.engine); }
      catch (err) { on.error?.(err); }
      finally { pending -= 1; on.busy?.(pending); }
    });
  };

  node.onaudioprocess = (e) => {
    if (stopped) return;
    const data = e.inputBuffer.getChannelData(0);
    let sum = 0; for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    on.level?.(Math.min(1, rms * 8));
    if (paused) return;
    const loud = rms > Math.max(0.015, floor * 3);
    if (!loud && !chunks.length) floor = floor * 0.95 + rms * 0.05;
    const copy = new Float32Array(data);
    if (loud) {
      if (!chunks.length) { chunks.push(...pre); pre.length = 0; }
      chunks.push(copy); speech += copy.length; quiet = 0; total += copy.length;
    } else if (chunks.length) {
      chunks.push(copy); quiet += copy.length; total += copy.length;
      if (quiet >= 0.8 * rate) flush();
    } else { pre.push(copy); if (pre.length > 3) pre.shift(); }
    if (total >= 25 * rate) flush();
  };

  return {
    pause() { paused = true; if (chunks.length) flush(); },
    resume() { paused = false; },
    async stop() {
      stopped = true; paused = true;
      if (chunks.length) flush();
      try { node.disconnect(); src.disconnect(); } catch { /* x */ }
      stream.getTracks().forEach((t) => t.stop());
      try { await ctx.close?.(); } catch { /* x */ }
      await queue;
    },
  };
}

/** Last resort when neither Whisper nor the server could turn speech into text: the browser's own speech service. */
export function startWebSpeech(on) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  let want = true;
  r.continuous = true; r.interimResults = false; r.lang = navigator.language || 'en-US';
  r.onresult = (ev) => { for (let i = ev.resultIndex; i < ev.results.length; i += 1) if (ev.results[i].isFinal) on.text?.(String(ev.results[i][0].transcript || '').trim(), 'browser'); };
  r.onerror = (ev) => { if (ev.error === 'no-speech' || ev.error === 'aborted') return; want = false; on.error?.(new Error(ev.error)); };
  r.onend = () => { if (want) { try { r.start(); } catch { /* running */ } } };
  try { r.start(); } catch { return null; }
  return {
    pause() { want = false; try { r.stop(); } catch { /* x */ } },
    resume() { want = true; try { r.start(); } catch { /* x */ } },
    async stop() { want = false; try { r.abort(); } catch { /* x */ } },
  };
}
