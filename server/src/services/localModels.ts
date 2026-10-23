// Local AI model store (PEB-281): see what this computer can run, and download models through the person's own Ollama
// without leaving Peblo. Only models in this catalog can be downloaded, so the button can never be used to pull
// arbitrary files. Not available on a shared server (hosted()): there the model would land on the server's disk.
import os from 'os';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { execFile } from 'child_process';
import { effectiveOllamaUrl } from '../utils/ollamaPolicy.js';

export interface CatalogModel {
  id: string;            // the Ollama model name
  name: string;
  kind: 'chat' | 'search';
  sizeGb: number;        // approximate download size
  minRamGb: number;      // memory needed to run it comfortably
  blurb: string;
}

export const CATALOG: CatalogModel[] = [
  { id: 'llama3.2:1b', name: 'Llama 3.2 · Tiny', kind: 'chat', sizeGb: 1.3, minRamGb: 4, blurb: 'Fastest. Fine for titles, tags and short summaries on an older laptop.' },
  { id: 'llama3.2', name: 'Llama 3.2 · Small', kind: 'chat', sizeGb: 2.0, minRamGb: 8, blurb: 'Good all-rounder for notes and questions. Runs well on most laptops.' },
  { id: 'llama3.1:8b', name: 'Llama 3.1 · Standard', kind: 'chat', sizeGb: 4.9, minRamGb: 16, blurb: 'Noticeably smarter answers. Needs a recent laptop with 16 GB of memory.' },
  { id: 'qwen2.5:14b', name: 'Qwen 2.5 · Large', kind: 'chat', sizeGb: 9.0, minRamGb: 32, blurb: 'Best quality here. For powerful machines with 32 GB or more.' },
  { id: 'nomic-embed-text', name: 'Nomic Embed · Search', kind: 'search', sizeGb: 0.3, minRamGb: 4, blurb: 'Lets Peblo find notes by meaning. Small, and worth installing with any chat model.' },
];

/** The graphics card, when there is one Ollama can use. Asked once; the answer does not change while Peblo runs. */
let gpuCache: Promise<{ name: string; vramGb: number | null } | null> | null = null;
export function detectGpu() {
  gpuCache ||= new Promise((resolve) => {
    if (process.platform === 'darwin' && process.arch === 'arm64') return resolve({ name: 'Apple silicon (shared memory)', vramGb: null });
    execFile('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { timeout: 4000, windowsHide: true }, (err, out) => {
      if (err) return resolve(null);
      const [name, mb] = String(out).split('\n')[0].split(',').map((s) => s.trim());
      resolve(name ? { name, vramGb: Math.round((Number(mb) / 1024) * 10) / 10 || null } : null);
    });
  });
  return gpuCache;
}

export function hardware() {
  const gb = (n: number) => Math.round((n / 1024 ** 3) * 10) / 10;
  let freeDiskGb: number | null = null;
  try { const s = fs.statfsSync(os.homedir()); freeDiskGb = gb(Number(s.bavail) * Number(s.bsize)); } catch { /* unknown */ }
  const cpus = os.cpus();
  return { ramGb: gb(os.totalmem()), freeDiskGb, cpuCores: cpus.length, cpu: cpus[0]?.model?.trim() || 'Unknown', platform: process.platform };
}

// A "16 GB" laptop reports about 15.7 GB, so allow a little under the nominal figure.
const RAM_SLACK_GB = 1.5;
export function fits(m: CatalogModel, ramGb: number) { return ramGb + RAM_SLACK_GB >= m.minRamGb; }

/** The largest chat model this much memory runs comfortably. */
export function recommendedChat(ramGb: number): string {
  const chat = CATALOG.filter((m) => m.kind === 'chat').sort((a, b) => b.minRamGb - a.minRamGb);
  return (chat.find((m) => fits(m, ramGb)) || chat[chat.length - 1]).id;
}

interface Job { model: string; status: string; completed: number; total: number; done: boolean; error?: string; startedAt: number; abort: AbortController }
const jobs = new Map<string, Job>();

export function pullsSnapshot() {
  return [...jobs.values()].map(({ abort, ...j }) => ({ ...j, percent: j.total > 0 ? Math.min(100, Math.floor((j.completed / j.total) * 100)) : 0 }));
}

export function cancelPull(model: string) {
  const j = jobs.get(model);
  if (!j || j.done) return false;
  j.abort.abort();
  return true;
}

/** Starts a download and returns at once; progress is read with pullsSnapshot(). */
/** Removes a downloaded model from Ollama. Catalog models only. */
export async function removeModel(userUrl: unknown, model: string): Promise<{ ok: boolean; error?: string }> {
  if (!CATALOG.some((m) => m.id === model)) return { ok: false, error: 'That model is not in the list.' };
  const base = effectiveOllamaUrl(userUrl, 'http://127.0.0.1:11434');
  if (!base) return { ok: false, error: 'Local AI is not available on this server.' };
  try {
    const r = await fetch(`${base}/api/delete`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }), signal: AbortSignal.timeout(15000) });
    if (!r.ok && r.status !== 404) return { ok: false, error: `Ollama answered with HTTP ${r.status}` };
    jobs.delete(model);
    return { ok: true };
  } catch { return { ok: false, error: 'Ollama is not running.' }; }
}

export async function startPull(userUrl: unknown, model: string): Promise<{ ok: boolean; error?: string }> {
  if (!CATALOG.some((m) => m.id === model)) return { ok: false, error: 'That model is not in the list.' };
  const running = jobs.get(model);
  if (running && !running.done) return { ok: true };
  const base = effectiveOllamaUrl(userUrl, 'http://127.0.0.1:11434');
  if (!base) return { ok: false, error: 'Local AI is not available on this server.' };
  try { await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) }); }
  catch { return { ok: false, error: 'Ollama is not running. Install or start it first.' }; }

  const job: Job = { model, status: 'starting', completed: 0, total: 0, done: false, startedAt: Date.now(), abort: new AbortController() };
  jobs.set(model, job);
  (async () => {
    try {
      const res = await fetch(`${base}/api/pull`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: true }), signal: job.abort.signal });
      if (!res.ok || !res.body) throw new Error(`Ollama answered with HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: any; try { ev = JSON.parse(line); } catch { continue; }
          if (ev.error) throw new Error(String(ev.error));
          job.status = String(ev.status || job.status);
          if (typeof ev.total === 'number' && ev.total > 0) { job.total = ev.total; job.completed = ev.completed || 0; }
        }
      }
      job.status = 'ready'; job.done = true;
    } catch (e: any) {
      job.done = true;
      job.error = job.abort.signal.aborted ? 'Cancelled' : String(e?.message || e).slice(0, 200);
    }
  })();
  return { ok: true };
}

// --- Start Ollama from Peblo (no terminal) ---
/** Where an installed Ollama lives on this computer, or null. PEBLO_OLLAMA_EXE / PEBLO_OLLAMA_ARGS are for tests. */
export function findOllama(): { exe: string; args: string[] } | null {
  if (process.env.PEBLO_OLLAMA_EXE) return { exe: process.env.PEBLO_OLLAMA_EXE, args: JSON.parse(process.env.PEBLO_OLLAMA_ARGS || '[]') };
  const local = process.env.LOCALAPPDATA || '';
  const candidates = process.platform === 'win32'
    ? [path.join(local, 'Programs', 'Ollama', 'ollama.exe'), 'C:\\Program Files\\Ollama\\ollama.exe']
    : process.platform === 'darwin'
      ? ['/Applications/Ollama.app/Contents/Resources/ollama', '/usr/local/bin/ollama', '/opt/homebrew/bin/ollama']
      : ['/usr/local/bin/ollama', '/usr/bin/ollama'];
  const exe = candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
  return exe ? { exe, args: ['serve'] } : null;
}

/** Starts the person's installed Ollama in the background and waits until it answers. */
export async function startOllama(userUrl: unknown): Promise<{ ok: boolean; error?: string }> {
  const base = effectiveOllamaUrl(userUrl, 'http://127.0.0.1:11434');
  if (!base) return { ok: false, error: 'Local AI is not available on this server.' };
  const alive = async () => { try { return (await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } };
  if (await alive()) return { ok: true };
  const found = findOllama();
  if (!found) return { ok: false, error: 'Ollama is not installed on this computer yet.' };
  try {
    const child = spawn(found.exe, found.args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => { /* reported by the wait below */ });
    child.unref();
  } catch {
    return { ok: false, error: 'Could not start Ollama.' };
  }
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await alive()) return { ok: true };
  }
  return { ok: false, error: 'Ollama did not start in time.' };
}

// --- Install Ollama from Peblo (Windows). Only runs when the person presses the button. ---
const OLLAMA_INSTALLER = 'https://ollama.com/download/OllamaSetup.exe';
export const canInstallOllama = () => process.platform === 'win32';
interface Install { status: 'downloading' | 'installing' | 'done' | 'failed'; completed: number; total: number; error?: string; abort: AbortController }
let install: Install | null = null;

export function installSnapshot() {
  if (!install) return null;
  const { abort, ...i } = install;
  return { ...i, percent: i.total > 0 ? Math.min(100, Math.floor((i.completed / i.total) * 100)) : 0 };
}

export function startInstall(): { ok: boolean; error?: string } {
  if (!canInstallOllama()) return { ok: false, error: 'One-click install is only available on Windows for now. Use the Get Ollama button.' };
  if (install && (install.status === 'downloading' || install.status === 'installing')) return { ok: true };
  const job: Install = { status: 'downloading', completed: 0, total: 0, abort: new AbortController() };
  install = job;
  (async () => {
    const file = path.join(os.tmpdir(), `PebloOllamaSetup-${Date.now()}.exe`);
    try {
      const res = await fetch(OLLAMA_INSTALLER, { signal: job.abort.signal, redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}).`);
      job.total = Number(res.headers.get('content-length')) || 0;
      const out = fs.createWriteStream(file);
      const reader = res.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        job.completed += value.length;
        if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      }
      await new Promise<void>((r, j) => out.end((e: any) => (e ? j(e) : r())));
      if (job.completed < 1024 * 1024) throw new Error('The installer download looks incomplete.');
      job.status = 'installing';
      const child = spawn(file, ['/SILENT', '/NORESTART'], { stdio: 'ignore', windowsHide: false });
      child.on('error', (e) => { job.status = 'failed'; job.error = String(e.message); });
      child.on('exit', (code) => { if (job.status === 'installing') { if (code === 0) job.status = 'done'; else { job.status = 'failed'; job.error = `The installer stopped (code ${code}).`; } } fs.unlink(file, () => {}); });
    } catch (e: any) {
      job.status = 'failed';
      job.error = job.abort.signal.aborted ? 'Cancelled' : String(e?.message || e).slice(0, 200);
      fs.unlink(file, () => {});
    }
  })();
  return { ok: true };
}

export function cancelInstall() {
  if (install && install.status === 'downloading') { install.abort.abort(); return true; }
  return false;
}
