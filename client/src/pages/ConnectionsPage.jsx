import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Cpu, Lock, Plug, Link2, Check, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { aiAPI, hubAPI } from '../api';
import '../styles/connections.css';

const ROUTES = [
  { id: 'ollama', title: 'Local only', desc: 'Never uses the cloud' },
  { id: 'ask', title: 'Ask first', desc: 'Cloud only after you say yes' },
  { id: 'auto', title: 'Best available', desc: 'Uses a cloud key when set' },
];

function KeyField({ id, label, hint, value, onSave, placeholder }) {
  const [draft, setDraft] = useState(value || '');
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(value || ''), [value]);
  const dirty = draft !== (value || '');
  return (
    <div className="cx-key">
      <label htmlFor={id} className="cx-key-label">{label}</label>
      <div className="cx-key-row">
        <input id={id} className="pb-input" type={show ? 'text' : 'password'} value={draft} placeholder={placeholder} onChange={(e) => { setDraft(e.target.value); setSaved(false); }} autoComplete="off" spellCheck={false} />
        <button type="button" className="pb-icon-btn bordered" aria-label={show ? 'Hide key' : 'Show key'} onClick={() => setShow((v) => !v)}>{show ? <EyeOff size={14} /> : <Eye size={14} />}</button>
        <button type="button" className="pb-btn sm" disabled={!dirty} onClick={() => { onSave(draft.trim()); setSaved(true); }}>{saved && !dirty ? <><Check size={13} /> Saved</> : 'Save'}</button>
      </div>
      <span className="pb-muted cx-hint">{hint}</span>
    </div>
  );
}

export default function ConnectionsPage() {
  const { settings, updateSettings } = useAuth();
  const queryClient = useQueryClient();
  const { data: models, refetch, isFetching } = useQuery({ queryKey: ['hub-models'], queryFn: () => hubAPI.models().then((r) => r.data) });

  const [url, setUrl] = useState(settings?.ollamaUrl || 'http://127.0.0.1:11434');
  const [check, setCheck] = useState(null);
  const [checking, setChecking] = useState(false);

  const routing = models?.routing || settings?.defaultAiModel || 'auto';
  const local = models?.local;
  const enabled = settings?.ollamaEnabled === true;

  const apply = async (patch) => {
    await updateSettings(patch);
    // updateSettings saves in the background; give it a moment, then refresh model status everywhere
    setTimeout(() => queryClient.invalidateQueries({ queryKey: ['hub-models'] }), 400);
  };

  const testConnection = async () => {
    setChecking(true);
    try {
      const { data } = await aiAPI.ollamaCheck(url);
      setCheck(data);
    } catch {
      setCheck({ ok: false, models: [], error: 'Could not check Ollama.' });
    } finally {
      setChecking(false);
    }
  };

  const installed = check?.ok ? check.models : local?.models || [];
  const chatModels = installed.filter((m) => !/embed/i.test(m));
  const embedModels = installed.filter((m) => /embed/i.test(m));

  return (
    <div className="pb-scroll cx">
      <header className="pb-topbar">
        <Link to="/ai" className="crumb">AI Hub</Link>
        <span className="crumb">/</span>
        <span className="title">Connections</span>
        <span className="grow" />
        {routing === 'ollama' ? (
          <span className="pb-badge local" style={{ height: 26, padding: '0 12px' }}><Lock size={12} /> Local only: notes never leave this device</span>
        ) : routing === 'ask' ? (
          <span className="pb-badge warn" style={{ height: 26, padding: '0 12px' }}>Cloud only after you say yes</span>
        ) : (
          <span className="pb-badge cloud" style={{ height: 26, padding: '0 12px' }}>Cloud keys are used when set</span>
        )}
      </header>

      <div className="cx-body">
        <div>
          <h1 className="pb-display cx-title">Connections</h1>
          <p className="pb-muted" style={{ margin: '6px 0 0', fontSize: 14 }}>Choose which AI models Peblo uses, and how your notes are shared with them.</p>
        </div>

        <div className="cx-grid">
          <section className="cx-section">
            <div className="cx-section-head">
              <Cpu size={18} color="var(--pb-accent)" />
              <h2>Models</h2>
              <button type="button" className="pb-btn sm" onClick={() => refetch()} disabled={isFetching}><RefreshCw size={13} /> Refresh</button>
            </div>

            <div className="cx-block">
              <span className="cx-block-label">When Peblo needs AI</span>
              <div className="cx-routes" role="radiogroup" aria-label="When Peblo needs AI">
                {ROUTES.map((r) => (
                  <button key={r.id} type="button" role="radio" aria-checked={routing === r.id} className={`cx-route${routing === r.id ? ' on' : ''}`} onClick={() => apply({ defaultAiModel: r.id })}>
                    <span className="t">{r.title}</span>
                    <span className="d">{r.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="cx-provider">
              <div className="cx-provider-head">
                <span className={`pb-dot ${enabled && local?.ok ? 'local' : enabled ? 'warn' : 'off'}`} />
                <span className="name">Local AI · Ollama</span>
                <span className="pb-muted mono">{url.replace(/^https?:\/\//, '')}</span>
                <button type="button" role="switch" aria-checked={enabled} aria-label="Local AI" className={`cx-switch${enabled ? ' on' : ''}`} onClick={() => apply({ ollamaEnabled: !enabled, ollamaUrl: url })}><span /></button>
              </div>
              {enabled ? (
                <div className="cx-provider-body">
                  <div className="cx-key-row">
                    <label htmlFor="ollama-url" className="sr-only">Ollama address</label>
                    <input id="ollama-url" className="pb-input" value={url} onChange={(e) => { setUrl(e.target.value); setCheck(null); }} />
                    <button type="button" className="pb-btn sm" onClick={testConnection} disabled={checking}>{checking ? 'Checking…' : 'Test connection'}</button>
                    {url !== (settings?.ollamaUrl || 'http://127.0.0.1:11434') && <button type="button" className="pb-btn primary sm" onClick={() => apply({ ollamaUrl: url })}>Save</button>}
                  </div>
                  {(check || local) && (
                    <p className={`cx-status ${(check ? check.ok : local.ok) ? 'ok' : 'bad'}`}>
                      {(check ? check.ok : local.ok)
                        ? (installed.length ? `Connected · ${installed.length} model${installed.length === 1 ? '' : 's'} installed` : 'Connected, but no models yet. Run: ollama pull llama3.2')
                        : (check?.error || local?.error || 'Ollama is not running. Start the Ollama app, then Test connection.')}
                    </p>
                  )}
                  {installed.length > 0 && (
                    <div className="cx-models">
                      {installed.map((m) => {
                        const isChat = (settings?.ollamaModel || 'llama3.2') === m || (settings?.ollamaModel || 'llama3.2') + ':latest' === m;
                        const isEmbed = (settings?.ollamaEmbedModel || 'nomic-embed-text') === m || (settings?.ollamaEmbedModel || 'nomic-embed-text') + ':latest' === m;
                        const embed = /embed/i.test(m);
                        return (
                          <div key={m} className="cx-model">
                            <span className="t">{m}</span>
                            <span className="pb-muted d">{embed ? 'Search embeddings' : 'Chat'}</span>
                            {isChat && <span className="pb-badge accent">Default chat</span>}
                            {isEmbed && <span className="pb-badge local">Search</span>}
                            {!isChat && !embed && <button type="button" className="pb-link" onClick={() => apply({ ollamaModel: m.replace(/:latest$/, '') })}>Use for chat</button>}
                            {!isEmbed && embed && <button type="button" className="pb-link" onClick={() => apply({ ollamaEmbedModel: m.replace(/:latest$/, '') })}>Use for search</button>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {chatModels.length === 0 && embedModels.length === 0 && (
                    <p className="pb-muted cx-hint">New to Ollama? Install it from ollama.com, then run <code>ollama pull llama3.2</code> in a terminal. A 3B model runs well on 8 GB RAM.</p>
                  )}
                </div>
              ) : (
                <p className="pb-muted cx-hint" style={{ padding: '0 14px 12px' }}>Run AI models on this computer: private, and works offline. Needs the free Ollama app.</p>
              )}
            </div>

            <div className="cx-provider">
              <div className="cx-provider-head">
                <span className={`pb-dot ${settings?.openAiKey || settings?.geminiKey ? 'cloud' : 'off'}`} />
                <span className="name">Cloud keys</span>
                <span className="pb-badge cloud">Cloud</span>
              </div>
              <div className="cx-provider-body">
                <KeyField id="openai-key" label="OpenAI API key" placeholder="sk-…" value={settings?.openAiKey} hint="Uses GPT-4o mini. Your question and matching notes are sent to OpenAI." onSave={(v) => apply({ openAiKey: v })} />
                <KeyField id="gemini-key" label="Google Gemini API key" placeholder="AIza…" value={settings?.geminiKey} hint="Uses Gemini 2.5 Flash. Free keys at aistudio.google.com." onSave={(v) => apply({ geminiKey: v })} />
                {routing === 'ollama' && (settings?.openAiKey || settings?.geminiKey) && <p className="pb-muted cx-hint">Keys are saved but not used while "Local only" is on.</p>}
              </div>
            </div>
          </section>

          <div className="cx-col">
            <section className="cx-section">
              <div className="cx-section-head">
                <Plug size={18} color="var(--pb-accent)" />
                <h2>Peblo MCP Server <span className="pb-badge" style={{ marginLeft: 6 }}>Coming next</span></h2>
              </div>
              <p className="cx-p">Let AI apps like Claude Desktop, Cursor and VS Code read your notes and tasks, and add tasks with your approval. Read-only by default, with a log of every request.</p>
              <div className="cx-soon">
                <div className="cx-soon-row"><span className="pb-dot off" /> <span className="grow">Claude Desktop</span><span className="pb-muted">One-click install</span></div>
                <div className="cx-soon-row"><span className="pb-dot off" /> <span className="grow">Cursor · VS Code</span><span className="pb-muted">Copy a config snippet</span></div>
                <pre className="cx-code">{'{ "mcpServers": { "peblo": { "command": "peblo-mcp" } } }'}</pre>
              </div>
              <span className="pb-muted cx-hint">Planned for Peblo 1.2. See docs/03-mcp.md.</span>
            </section>

            <section className="cx-section">
              <div className="cx-section-head">
                <Link2 size={18} color="var(--pb-accent)" />
                <h2>Peblo Connect <span className="pb-badge" style={{ marginLeft: 6 }}>Later</span></h2>
              </div>
              <p className="cx-p">Let Peblo's AI use tools from other apps, like GitHub issues, Google Calendar or a folder on your computer. Each tool asks before it does anything.</p>
              <span className="pb-muted cx-hint">Planned for Peblo 1.4.</span>
            </section>

            <section className="cx-section">
              <div className="cx-section-head">
                <Lock size={18} color="var(--pb-local)" />
                <h2>What stays private</h2>
              </div>
              <ul className="cx-list">
                <li>Notes tagged <strong>#private</strong> are never sent to any model.</li>
                <li>With Local AI, nothing leaves this computer.</li>
                <li>Every AI Hub answer lists the notes it used, under Sources.</li>
                <li>Chats are saved on this device only.</li>
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
