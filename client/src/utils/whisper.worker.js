// Speech to text inside the browser: Whisper (tiny, 8-bit) run by onnxruntime-web, off the main thread.
// The model downloads once on first use and is kept by the browser (Cache Storage); after that it works offline.
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = { mjs: `${self.location.origin}/ort/ort-wasm-simd-threaded.mjs`, wasm: `${self.location.origin}/ort/ort-wasm-simd-threaded.wasm` };
env.backends.onnx.wasm.numThreads = 1; // threads need cross-origin isolation, which the app does not use

let asr = null;
let language = null;

const languageName = (tag) => {
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(String(tag).split('-')[0]).toLowerCase(); } catch { return null; }
};

self.onmessage = async (e) => {
  const m = e.data || {};
  if (m.type === 'load') {
    try {
      const english = /^en/i.test(m.lang || 'en');
      language = english ? null : languageName(m.lang);
      const files = new Map();
      asr = await pipeline('automatic-speech-recognition', english ? 'Xenova/whisper-tiny.en' : 'Xenova/whisper-tiny', {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (p) => {
          if (p.status !== 'progress' || !/\.onnx/.test(p.file || '')) return;
          files.set(p.file, { l: p.loaded, t: p.total });
          let l = 0; let t = 0;
          files.forEach((v) => { l += v.l; t += v.t; });
          self.postMessage({ type: 'progress', pct: t ? Math.min(99, Math.round((l / t) * 100)) : 0 });
        },
      });
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'fail', error: String(err?.message || err) });
    }
  } else if (m.type === 'run') {
    try {
      const out = await asr(m.audio, { ...(language ? { language, task: 'transcribe' } : {}), chunk_length_s: 30 });
      self.postMessage({ type: 'result', id: m.id, text: String(out?.text || '') });
    } catch (err) {
      self.postMessage({ type: 'error', id: m.id, error: String(err?.message || err) });
    }
  }
};
