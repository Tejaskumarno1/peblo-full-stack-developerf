// Which Ollama addresses a person may point Peblo at (PEB-24, SSRF).
// On the desktop app the server and the person share one computer, so any http(s) address is fine.
// On a shared server (PEBLO_HOSTED=1) a custom address would let a person make the server call its own network,
// so only addresses the owner lists in OLLAMA_ALLOWED_HOSTS (comma separated, "host" or "host:port") are accepted,
// and everyone else uses OLLAMA_URL if the owner set one, or no local AI at all.

export const hosted = () => /^(1|true|yes)$/i.test(process.env.PEBLO_HOSTED || '');

const allowList = () => (process.env.OLLAMA_ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

function shapeProblem(raw: string): { problem: string | null; url?: URL } {
  let u: URL;
  try { u = new URL(raw); } catch { return { problem: 'The Ollama address must look like http://127.0.0.1:11434' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { problem: 'The Ollama address must start with http:// or https://' };
  if (u.username || u.password) return { problem: 'The Ollama address must not contain a user name or password.' };
  return { problem: null, url: u };
}

/** Why this address cannot be used, or null when it is fine. */
export function ollamaUrlProblem(raw: string): string | null {
  const s = shapeProblem(raw);
  if (s.problem || !s.url) return s.problem;
  const u = s.url;
  if (!hosted()) return null;
  const list = allowList();
  if (list.includes(u.host.toLowerCase()) || list.includes(u.hostname.toLowerCase())) return null;
  return 'This server does not allow custom Ollama addresses.';
}

/**
 * The Ollama address to use for a person's setting, or null when local AI is not available to them.
 * `fallback` is the built-in desktop default (only used when not hosted).
 */
export function effectiveOllamaUrl(custom: unknown, fallback: string): string | null {
  const wanted = typeof custom === 'string' ? custom.trim() : '';
  if (wanted && !ollamaUrlProblem(wanted)) return wanted.replace(/\/+$/, '');
  if (hosted()) {
    const owner = (process.env.OLLAMA_URL || '').trim();
    return owner && !shapeProblem(owner).problem ? owner.replace(/\/+$/, '') : null; // an owner address needs no allow-list entry
  }
  return fallback;
}
