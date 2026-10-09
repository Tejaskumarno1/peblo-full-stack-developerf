// One place for "where may my AI run?". Settings, Your AI (all styles), the sidebar and the
// console status bar all read these, so they can never disagree.
export const ROUTING_CHOICES = [
  { id: 'ollama', title: 'Only on this computer', desc: 'Nothing leaves your laptop. Works offline. Needs the free Ollama app.' },
  { id: 'ask', title: 'Ask me first', desc: 'Uses your computer when it can. Asks before anything goes to the cloud.' },
  { id: 'auto', title: 'Best available', desc: 'Uses your OpenAI or Gemini key when one is set. Fastest answers.' },
];

/** Older accounts may hold 'openai' or 'gemini' (a preferred cloud provider): show them as "Best available". */
export function normalizeRouting(value) {
  return value === 'ollama' || value === 'ask' ? value : 'auto';
}

/**
 * What the status line should say, from the /ai/hub/models answer.
 * kind: 'local' | 'cloud' | 'warn' (Ollama wanted but not running) | 'off'
 */
export function describeModel(models) {
  const local = models?.local;
  const cloudReady = (models?.cloud || []).filter((c) => c.configured);
  const routing = normalizeRouting(models?.routing);
  if (local?.enabled && local.ok) return { kind: 'local', name: local.chatModel };
  if (local?.enabled && !local.ok && (routing === 'ollama' || !cloudReady.length)) return { kind: 'warn', name: 'Ollama not running' };
  if (cloudReady.length && routing !== 'ollama') return { kind: 'cloud', name: cloudReady[0].model };
  return { kind: 'off', name: 'No AI set up' };
}
