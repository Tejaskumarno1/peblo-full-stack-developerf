import { assertPublicHost } from '../utils/safeFetch.js';
import { hosted } from '../utils/ollamaPolicy.js';

/*
 * AI connections: which providers Peblo knows by name, how a pasted key is recognised, and how a connection is checked.
 * Every provider here except Gemini speaks the OpenAI chat API, so one client (the openai package with a baseURL) serves all of them.
 * Gemini keeps its own native client and OpenAI keeps its own key field; both are still listed so a pasted key finds its place.
 */

export interface ProviderInfo {
  id: string;
  label: string;
  /** Fixed address of the provider. Empty for "custom", where the person supplies it. */
  baseUrl: string;
  defaultModel: string;
  /** Where the key is stored: its own field in the account (openai, gemini) or a connection row (everything else). */
  slot?: 'openAiKey' | 'geminiKey';
  /** Shown under the key box so a person knows where to get one. */
  keyHint: string;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', slot: 'openAiKey', keyHint: 'platform.openai.com/api-keys' },
  { id: 'gemini', label: 'Google Gemini', baseUrl: '', defaultModel: 'gemini-2.5-flash', slot: 'geminiKey', keyHint: 'aistudio.google.com/apikey' },
  { id: 'anthropic', label: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-5', keyHint: 'console.anthropic.com/settings/keys' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-4o-mini', keyHint: 'openrouter.ai/keys' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', keyHint: 'console.groq.com/keys' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', keyHint: 'platform.deepseek.com/api_keys' },
  { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', defaultModel: 'mistral-small-latest', keyHint: 'console.mistral.ai/api-keys' },
  { id: 'together', label: 'Together AI', baseUrl: 'https://api.together.xyz/v1', defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', keyHint: 'api.together.ai/settings/api-keys' },
  { id: 'xai', label: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1', defaultModel: 'grok-3-mini', keyHint: 'console.x.ai' },
  { id: 'custom', label: 'Custom (OpenAI-compatible address)', baseUrl: '', defaultModel: '', keyHint: 'Any server that speaks the OpenAI chat API: LM Studio, vLLM, LiteLLM, a company gateway...' },
];

export const providerById = (id: string) => PROVIDERS.find((p) => p.id === id);

/**
 * Providers a pasted key could belong to, most likely first. A prefix is only a hint: the key is then tried against
 * each candidate's server (verifyConnection), and the first one that accepts it wins. An empty list means "ask the person".
 */
export function candidatesFor(rawKey: string): string[] {
  const key = (rawKey || '').trim();
  if (!key) return [];
  if (key.startsWith('sk-ant-')) return ['anthropic'];
  if (key.startsWith('sk-or-')) return ['openrouter'];
  if (key.startsWith('gsk_')) return ['groq'];
  if (key.startsWith('xai-')) return ['xai'];
  if (key.startsWith('AIza')) return ['gemini'];
  if (/^sk-(proj|svcacct|admin)-/.test(key)) return ['openai'];
  if (/^sk-[a-f0-9]{32}$/i.test(key)) return ['deepseek', 'openai'];
  if (key.startsWith('sk-')) return ['openai', 'deepseek'];
  if (/^[a-f0-9]{64}$/i.test(key)) return ['together'];
  if (/^[A-Za-z0-9]{32}$/.test(key)) return ['mistral'];
  return [];
}

/** Why an address cannot be used for a custom connection, or null when it is fine (and the cleaned address). */
export async function checkBaseUrl(raw: string): Promise<{ problem: string | null; url?: string }> {
  let u: URL;
  try { u = new URL(String(raw || '').trim()); } catch { return { problem: 'The address must look like https://api.example.com/v1' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { problem: 'The address must start with http:// or https://' };
  if (u.username || u.password) return { problem: 'The address must not contain a user name or password.' };
  if (u.search || u.hash) return { problem: 'The address must not contain a ? or # part.' };
  // On a shared server a custom address would let a person make the server call its own network (PEB-24):
  // only public https addresses are allowed there. On the desktop app the person and the server share one computer, so any address is fine.
  if (hosted()) {
    if (u.protocol !== 'https:') return { problem: 'This server only accepts https:// addresses.' };
    try { await assertPublicHost(u.hostname); } catch { return { problem: 'This server does not allow that address.' }; }
  }
  return { problem: null, url: u.toString().replace(/\/+$/, '') };
}

export interface VerifyResult {
  ok: boolean;
  provider: string;
  label: string;
  baseUrl: string;
  models: string[];
  /** 'key': the provider rejected the key; 'unreachable': no answer; 'address': address refused; 'other': anything else */
  failure?: 'key' | 'unreachable' | 'address' | 'other';
  error?: string;
}

const NOT_CHAT = /embed|whisper|tts|moderation|dall-e|image|audio|transcribe|rerank|guard|speech/i;

/** The model to suggest: the provider's usual one if it is on the list, else the first that looks like a chat model. */
export function suggestModel(provider: string, models: string[]): string {
  const want = providerById(provider)?.defaultModel || '';
  if (want && models.includes(want)) return want;
  return models.find((m) => !NOT_CHAT.test(m)) || want || models[0] || '';
}

function modelIds(body: any): string[] {
  const list = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
  return list.map((m: any) => String(m?.id ?? m?.name ?? '').replace(/^models\//, '')).filter(Boolean);
}

/**
 * Asks the provider for its model list with this key: proves the key works and gives the person something to pick from.
 * `baseUrl` is only used for "custom"; every named provider uses its own fixed address.
 */
export async function verifyConnection(providerId: string, key: string, baseUrl?: string): Promise<VerifyResult> {
  const info = providerById(providerId);
  const fail = (failure: VerifyResult['failure'], error: string, url = ''): VerifyResult => ({ ok: false, provider: providerId, label: info?.label || providerId, baseUrl: url, models: [], failure, error });
  if (!info) return fail('other', 'Unknown provider.');
  const apiKey = (key || '').trim();

  if (providerId === 'gemini') {
    if (!apiKey) return fail('key', 'Paste a key first.');
    try {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100', { headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(8000) });
      if (res.status === 400 || res.status === 401 || res.status === 403) return fail('key', 'Google did not accept that key.');
      if (!res.ok) return fail('other', `Google answered with HTTP ${res.status}.`);
      const models = modelIds(await res.json()).filter((m) => /^gemini-/.test(m) && !NOT_CHAT.test(m));
      return { ok: true, provider: 'gemini', label: info.label, baseUrl: '', models };
    } catch { return fail('unreachable', 'Could not reach Google.'); }
  }

  let base = info.baseUrl;
  if (providerId === 'custom') {
    const c = await checkBaseUrl(baseUrl || '');
    if (c.problem || !c.url) return fail('address', c.problem || 'Bad address.');
    base = c.url;
  }
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (providerId === 'anthropic') { headers['x-api-key'] = apiKey; headers['anthropic-version'] = '2023-06-01'; }
  try {
    // Redirects are not followed: an address that answers with one could be pointing somewhere the server must not go.
    const res = await fetch(`${base}/models`, { headers, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    if (res.status === 401 || res.status === 403) return fail('key', `${info.label} did not accept that key.`, base);
    if (res.status >= 300 && res.status < 400) return fail('address', 'That address redirects somewhere else. Use the final address.', base);
    if (!res.ok) return fail('other', `${info.label} answered with HTTP ${res.status}.`, base);
    return { ok: true, provider: providerId, label: info.label, baseUrl: base, models: modelIds(await res.json()) };
  } catch {
    return fail('unreachable', providerId === 'custom' ? `Could not reach ${base}.` : `Could not reach ${info.label}.`, base);
  }
}

/** Looks at a pasted key: tries each likely provider and answers with the first that accepts it. */
export async function detectConnection(key: string, forced?: { provider?: string; baseUrl?: string }): Promise<{ ok: boolean; result?: VerifyResult; tried: VerifyResult[]; needsProvider?: boolean; error?: string }> {
  const list = forced?.provider ? [forced.provider] : candidatesFor(key);
  if (!list.length) return { ok: false, tried: [], needsProvider: true, error: 'Peblo could not tell which company this key is from. Pick the provider below, or use a custom address.' };
  const tried: VerifyResult[] = [];
  for (const id of list) {
    const r = await verifyConnection(id, key, forced?.baseUrl);
    if (r.ok) return { ok: true, result: r, tried: [...tried, r] };
    tried.push(r);
  }
  const last = tried[tried.length - 1];
  const everyKeyProblem = tried.every((t) => t.failure === 'key');
  return { ok: false, tried, error: everyKeyProblem && tried.length > 1 ? `None of ${tried.map((t) => t.label).join(' or ')} accepted that key.` : last?.error };
}

/** Drops saved connections whose custom address is no longer allowed (hosted servers only). Named providers have fixed, safe addresses. */
export async function usableConnections<T extends { provider: string; baseUrl: string }>(list: T[]): Promise<T[]> {
  const out: T[] = [];
  for (const c of list) {
    if (c.provider !== 'custom') { out.push(c); continue; }
    if (!(await checkBaseUrl(c.baseUrl)).problem) out.push(c);
  }
  return out;
}
