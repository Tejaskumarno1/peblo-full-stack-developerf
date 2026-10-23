import api from '../api/client';

// Speech for the AI assistant: dictate with the microphone, hear answers read aloud.
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
// The desktop app's browser has the speech API but no speech service behind it, so it records and sends the audio to the server instead.
export const useServerSpeech = () => !SR || /Electron/i.test(navigator.userAgent || '');
export const makeRecognizer = () => (SR ? new SR() : null);
export const canSpeak = () => typeof window !== 'undefined' && !!window.speechSynthesis;

/** Markdown and [1]-style source marks read badly aloud. */
export function speakable(text) {
  return String(text || '').replace(/\[(\d+)\]/g, '').replace(/```[\s\S]*?```/g, ' code block. ').replace(/[*_`#>~|]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
}

let current = null;
export function stopSpeaking() { try { window.speechSynthesis?.cancel(); } catch { /* none */ } current = null; }
export function speak(text, onEnd) {
  if (!canSpeak()) return false;
  stopSpeaking();
  const u = new SpeechSynthesisUtterance(speakable(text).slice(0, 4000));
  u.lang = navigator.language || 'en-US';
  u.onend = u.onerror = () => { if (current === u) current = null; onEnd?.(); };
  current = u;
  window.speechSynthesis.speak(u);
  return true;
}

// Recording -> 16 kHz mono WAV (what the speech service accepts), as base64.
async function toWavBase64(blob) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  ctx.close?.();
  const rate = 16000;
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * rate)), rate);
  const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
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

export async function transcribeBlob(blob) {
  const audio = await toWavBase64(blob);
  const { data } = await api.post('/ai/transcribe', { audio, mime: 'audio/wav' });
  return String(data.text || '').trim();
}
