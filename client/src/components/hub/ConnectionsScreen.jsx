import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Monitor, MessageCircleQuestion, Cloud, Check } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { aiAPI, hubAPI } from '../../api';

const CHOICES = [
  { id: 'ollama', title: 'Only on this computer', desc: 'Nothing leaves your laptop. Works offline. Needs the free Ollama app.', icon: Monitor, tone: 'a' },
  { id: 'ask', title: 'Ask me first', desc: 'Uses your computer when it can. Asks before anything goes to the cloud.', icon: MessageCircleQuestion, tone: 'b' },
  { id: 'auto', title: 'Best available', desc: 'Uses your OpenAI or Gemini key when one is set. Fastest answers.', icon: Cloud, tone: 'c' },
];

function KeyInput({ p, id, label, value, placeholder, onSave }) {
  const [draft, setDraft] = useState(value || '');
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(value || ''), [value]);
  const dirty = draft.trim() !== (value || '');
  return (
    <div className={`${p}-field`}>
      <label htmlFor={id}>{label}</label>
      <div className="row">
        <input id={id} type="password" value={draft} placeholder={placeholder} onChange={(e) => { setDraft(e.target.value); setSaved(false); }} autoComplete="off" spellCheck={false} />
        {dirty && <button type="button" className={`${p}-btn small`} onClick={() => { onSave(draft.trim()); setSaved(true); }}>Save</button>}
        {saved && !dirty && <span className={`${p}-ok`}><Check size={14} strokeWidth={2.6} /> Saved</span>}
      </div>
    </div>
  );
}

/**
 * "Your AI" shared by River and Orbit: where AI runs, Local AI (Ollama) and cloud keys.
 * Same settings as the other styles; class names start with the style's prefix.
 */
export default function ConnectionsScreen({ p, extra }) {
  const { settings, updateSettings } = useAuth();
  const queryClient = useQueryClient();
  const { data: models, refetch } = useQuery({ queryKey: ['hub-models'], queryFn: () => hubAPI.models().then((r) => r.data) });
  const [check, setCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const [url, setUrl] = useState(settings?.ollamaUrl || 'http://127.0.0.1:11434');
  const c = (n) => `${p}-${n}`;

  const routing = models?.routing || settings?.defaultAiModel || 'auto';
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
  const status = !enabled ? { text: 'Off', cls: 'off' } : ok ? { text: 'Connected', cls: 'ok' } : { text: 'Not running', cls: 'bad' };

  return (
    <div className={c('conn')}>
      <div className={c('conn-title')}>
        <h1>How Peblo uses AI</h1>
        <p>Pick one. You can change it any time, and every answer shows what it read.</p>
      </div>

      <fieldset className={c('choices')}>
        <legend className={c('sr')}>When Peblo needs AI</legend>
        {CHOICES.map(({ id, title, desc, icon: Icon, tone }) => (
          <label key={id} className={`${c('choice')} ${tone}${routing === id ? ' on' : ''}`}>
            <input type="radio" name={`${p}-route`} checked={routing === id} onChange={() => apply({ defaultAiModel: id })} />
            <span className="ic"><Icon size={24} strokeWidth={2} /></span>
            <span className="t">{title}</span>
            <span className="d">{desc}</span>
            {routing === id && <span className="badge">Chosen</span>}
          </label>
        ))}
      </fieldset>

      <div className={c('conn-cards')}>
        <section className={c('card')} aria-labelledby={`${p}-ollama`}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <h2 id={`${p}-ollama`} className={c('card-title')}>Local AI · Ollama</h2>
            <span className={`${c('status')} ${status.cls}`}>{status.text}</span>
          </div>
          {!enabled ? (
            <>
              <p className={c('quiet')}>Run AI on this computer: private, and it works offline. Install the free Ollama app, then turn this on.</p>
              <button type="button" className={c('btn')} style={{ alignSelf: 'flex-start' }} onClick={() => apply({ ollamaEnabled: true, ollamaUrl: url })}>Turn on Local AI</button>
            </>
          ) : (
            <>
              <span className={c('quiet')}>{ok ? `Runs on this computer. ${installed.length} model${installed.length === 1 ? '' : 's'} installed.` : (check?.error || local?.error || 'Start the Ollama app, then test the connection.')}</span>
              {installed.slice(0, 5).map((m) => {
                const embed = /embed/i.test(m);
                return (
                  <div key={m} className={c('model-row')}>
                    <span className="t">{m.replace(/:latest$/, '')}</span>
                    {isSame(m, chatModel) ? <span className={c('mini')}>Chat</span>
                      : isSame(m, embedModel) ? <span className={c('mini')}>Search</span>
                        : <button type="button" className={c('link-btn')} onClick={() => apply(embed ? { ollamaEmbedModel: m.replace(/:latest$/, '') } : { ollamaModel: m.replace(/:latest$/, '') })}>{embed ? 'Use for search' : 'Use for chat'}</button>}
                  </div>
                );
              })}
              {ok && installed.length === 0 && <p className={c('quiet')}>No models yet. In a terminal run: ollama pull llama3.2</p>}
              <div className={c('field')}>
                <label htmlFor={`${p}-ollama-url`}>Ollama address</label>
                <div className="row">
                  <input id={`${p}-ollama-url`} value={url} onChange={(e) => { setUrl(e.target.value); setCheck(null); }} />
                  <button type="button" className={`${c('btn')} ghost small`} onClick={test} disabled={checking}>{checking ? 'Testing…' : 'Test connection'}</button>
                </div>
              </div>
              <button type="button" className={c('link-btn')} style={{ alignSelf: 'flex-start' }} onClick={() => apply({ ollamaEnabled: false })}>Turn off Local AI</button>
            </>
          )}
        </section>

        <section className={c('card')} aria-labelledby={`${p}-keys`}>
          <h2 id={`${p}-keys`} className={c('card-title')}>Cloud keys</h2>
          <span className={c('quiet')}>Saved encrypted in your account. {routing === 'ollama' ? 'Not used while "Only on this computer" is picked.' : 'Used only as your choice above allows.'}</span>
          <KeyInput p={p} id={`${p}-openai`} label="OpenAI key" placeholder="sk-…" value={settings?.openAiKey} onSave={(v) => apply({ openAiKey: v })} />
          <KeyInput p={p} id={`${p}-gemini`} label="Gemini key" placeholder="AIza…" value={settings?.geminiKey} onSave={(v) => apply({ geminiKey: v })} />
          <span className={c('quiet')} style={{ fontSize: 13 }}>Notes tagged #private are never sent to any AI.</span>
        </section>
      </div>
      {extra}
    </div>
  );
}
