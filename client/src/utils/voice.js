
// Speech for the AI assistant: dictate with the microphone, hear answers read aloud.
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
// Dictation records and transcribes with Whisper (then the server); the browser's own speech service is the last fallback.
export const useServerSpeech = () => true;
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

export async function transcribeBlob(blob) {
  const { transcribeSamples, decodeToPcm } = await import('./stt');
  const { text } = await transcribeSamples(await decodeToPcm(blob));
  return text;
}
