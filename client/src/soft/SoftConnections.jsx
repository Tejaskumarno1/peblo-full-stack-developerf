import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor, MessageCircleQuestion, Cloud, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { aiAPI, hubAPI } from '../api';
import { normalizeRouting } from '../utils/aiRouting';
import { unreadableKeyMessage } from '../utils/keyStatus';

const CHOICES = [
  { id: 'ollama', title: 'Only on this computer', desc: 'Nothing leaves your laptop. Works offline. Needs the free Ollama app.', tone: 'mint', icon: Monitor },
  { id: 'ask', title: 'Ask me first', desc: 'Uses your computer when it can. Asks before anything goes to the cloud.', tone: 'butter', icon: MessageCircleQuestion },
  { id: 'auto', title: 'Best available', desc: 'Uses your OpenAI or Gemini key when one is set. Fastest answers.', tone: 'sky', icon: Cloud },
];

function KeyInput({ id, label, value, placeholder, onSave }) {
  const [draft, setDraft] = useState(value || '');
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(value || ''), [value]);
  const dirty = draft.trim() !== (value || '');
  return (
    <div className="s-key">
      <label htmlFor={id} className="s-key-label">{label}</label>
      <div className="s-key-row">
        <input id={id} type="password" value={draft} placeholder={placeholder} onChange={(e) => { setDraft(e.target.value); setSaved(false); }} autoComplete="off" spellCheck={false} />
        {dirty && <button type="button" className="s-key-save" onClick={() => { onSave(draft.trim()); setSaved(true); }}>Save</button>}
        {saved && !dirty && <span className="s-key-ok"><Check size={14} strokeWidth={2.6} /> Saved</span>}
      </div>
    </div>
  );
}

/** Soft Studio · Your AI (mockup: SoftConnections). Same settings as Connections, friendlier layout. */
export default function SoftConnections() {
  const { settings, updateSettings } = useAuth();
  const queryClient = useQueryClient();
  const { data: models, refetch } = useQuery({ queryKey: ['hub-models'], queryFn: () => hubAPI.models().then((r) => r.data) });
  const [check, setCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const [url, setUrl] = useState(settings?.ollamaUrl || 'http://127.0.0.1:11434');

  const routing = normalizeRouting(models?.routing || settings?.defaultAiModel);
  const local = models?.local;
  const enabled = settings?.ollamaEnabled === true;
  const installed = check?.ok ? check.models : local?.models || [];
  const chatModel = settings?.ollamaModel || 'llama3.2';
  const embedModel = settings?.ollamaEmbedModel || 'nomic-embed-text';
  const isSame = (m, want) => m === want || m === `${want}:latest`;

  const apply = async (patch) => {
    await updateSettings(patch);
    setTimeout(() => queryClient.invalidateQueries({ queryKey: ['hub-models'] }), 400);
  };
  const test = async () => {
    setChecking(true);
    try {
      const { data } = await aiAPI.ollamaCheck(url);
      setCheck(data);
      if (url !== (settings?.ollamaUrl || 'http://127.0.0.1:11434')) apply({ ollamaUrl: url });
      refetch();
    } catch {
      setCheck({ ok: false, models: [], error: 'Could not check Ollama.' });
    } finally {
      setChecking(false);
    }
  };

  const ok = check ? check.ok : local?.ok;
  const status = !enabled ? { text: 'Off', bg: 'var(--s-chip-solid)' }
    : ok ? { text: 'Connected', bg: 'var(--s-mint)', dot: true }
      : { text: 'Not running', bg: 'var(--s-peach)' };

  return (
    <div className="soft-page s-conn">
      <div className="s-page-title" style={{ flexShrink: 0 }}>
        <h1 className="s-h1">How Peblo uses AI</h1>
        <span className="s-sub">Pick one. You can change it any time, and every answer shows what it read.</span>
      </div>

      <fieldset className="s-choices">
        <legend className="s-sr">When Peblo needs AI</legend>
        {CHOICES.map(({ id, title, desc, tone, icon: Icon }) => (
          <label key={id} className={`s-choice${routing === id ? ' on' : ''}`} style={{ background: `var(--s-${tone})` }}>
            <input type="radio" name="s-route" checked={routing === id} onChange={() => apply({ defaultAiModel: id })} />
            <span className="s-choice-icon"><Icon size={28} strokeWidth={2} /></span>
            <span className="s-choice-title">{title}</span>
            <span className="s-choice-desc">{desc}</span>
          </label>
        ))}
      </fieldset>

      <div className="s-conn-cards">
        <section className="s-conn-card" aria-labelledby="s-ollama">
          <div className="s-tile-head" style={{ paddingBottom: 0 }}>
            <h2 id="s-ollama" className="s-conn-h2">Local AI · Ollama</h2>
            <span className="s-status" style={{ background: status.bg }}>{status.dot && <span className="dot" />}{status.text}</span>
          </div>
          {!enabled ? (
            <>
              <p className="s-empty small">Run AI on this computer: private, and it works offline. Install the free Ollama app, then turn this on.</p>
              <span className="grow" />
              <button type="button" className="s-accent-btn" style={{ alignSelf: 'flex-start', height: 42 }} onClick={() => apply({ ollamaEnabled: true, ollamaUrl: url })}>Turn on Local AI</button>
            </>
          ) : (
            <>
              <span className="s-empty small">{ok ? `Runs on this computer. ${installed.length} model${installed.length === 1 ? '' : 's'} installed.` : (check?.error || local?.error || 'Start the Ollama app, then test the connection.')}</span>
              <div className="s-models">
                {installed.slice(0, 4).map((m) => {
                  const embed = /embed/i.test(m);
                  return (
                    <div key={m} className="s-model-row">
                      <span className="t">{m.replace(/:latest$/, '')}</span>
                      {isSame(m, chatModel) ? <span className="s-mini" style={{ background: 'var(--s-peach)', color: 'var(--s-fg)' }}>Chat</span>
                        : isSame(m, embedModel) ? <span className="s-mini" style={{ background: 'var(--s-sky)', color: 'var(--s-fg)' }}>Search</span>
                          : <button type="button" className="s-link-btn" onClick={() => apply(embed ? { ollamaEmbedModel: m.replace(/:latest$/, '') } : { ollamaModel: m.replace(/:latest$/, '') })}>{embed ? 'Use for search' : 'Use for chat'}</button>}
                    </div>
                  );
                })}
                {ok && installed.length === 0 && <p className="s-empty small">No models yet. In a terminal run: ollama pull llama3.2</p>}
              </div>
              <span className="grow" />
              <div className="s-key-row">
                <label htmlFor="s-ollama-url" className="s-sr">Ollama address</label>
                <input id="s-ollama-url" value={url} onChange={(e) => { setUrl(e.target.value); setCheck(null); }} />
                <button type="button" className="s-outline" style={{ height: 40, padding: '0 18px', fontWeight: 700, whiteSpace: 'nowrap' }} onClick={test} disabled={checking}>{checking ? 'Testing…' : 'Test connection'}</button>
              </div>
              <button type="button" className="s-link-btn" style={{ alignSelf: 'flex-start', color: 'var(--s-fg3)' }} onClick={() => apply({ ollamaEnabled: false })}>Turn off Local AI</button>
            </>
          )}
        </section>

        <section className="s-conn-card" aria-labelledby="s-keys">
          <h2 id="s-keys" className="s-conn-h2">Cloud keys</h2>
          <span className="s-empty small">Saved encrypted in your account. {routing === 'ollama' ? 'Not used while "Only on this computer" is picked.' : 'Used only as your choice above allows.'}</span>
          {unreadableKeyMessage(settings) && <p role="alert" className="s-empty small" style={{ color: '#ef4444', fontWeight: 500 }}>{unreadableKeyMessage(settings)}</p>}
<KeyInput id="s-openai" label="OpenAI key" placeholder="sk-…" value={settings?.openAiKey} onSave={(v) => apply({ openAiKey: v })} />
          <KeyInput id="s-gemini" label="Gemini key" placeholder="AIza…" value={settings?.geminiKey} onSave={(v) => apply({ geminiKey: v })} />
        </section>

        <section className="s-conn-card" style={{ background: 'var(--s-lilac)' }} aria-labelledby="s-next">
          <span className="s-count" style={{ alignSelf: 'flex-start', fontSize: 12.5, fontWeight: 800 }}>Coming next</span>
          <h2 id="s-next" className="s-conn-h2" style={{ lineHeight: 1.2 }}>Use your notes from Claude Desktop, Cursor and VS Code</h2>
          <div className="s-promises">
            <span>Read-only unless you allow more</span>
            <span>You approve every new task</span>
            <span>#private notes stay hidden</span>
          </div>
        </section>
      </div>
    </div>
  );
}
