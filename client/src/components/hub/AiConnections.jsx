import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { aiConnectionsAPI } from '../../api';
import { connectionModelsQuery } from './ConnectionModelOptions';
import './aiConnections.css';

const errText = (e, fallback) => e?.response?.data?.error || fallback;

/** The models this connection's key can use, as a list to pick from (the provider is asked, so new models show up). */
function ModelSelect({ c, onPick }) {
  const { data } = useQuery(connectionModelsQuery(c.id));
  const models = data?.models?.length ? data.models : [c.model];
  return (
    <select className="ac-model" aria-label={`Model for ${c.label}`} value={c.model} onChange={(e) => onPick(c.id, { model: e.target.value })}>
      {models.map((m) => <option key={m} value={m}>{m}</option>)}
    </select>
  );
}

/** One saved connection: which company, which model, on/off, its place in the order, remove. */
function Row({ c, first, last, onChange, onMove, onRemove, busy }) {
  const [sure, setSure] = useState(false);
  const [test, setTest] = useState(null); // null | 'busy' | { ok, text }
  // Asks the company for this key's models right now: if that works, the key works.
  const runTest = async () => {
    setTest('busy');
    try {
      const { data } = await aiConnectionsAPI.models(c.id);
      setTest(data.error ? { ok: false, text: data.error } : { ok: true, text: `Working. ${data.models?.length || 0} model${data.models?.length === 1 ? '' : 's'} available.` });
    } catch (e) { setTest({ ok: false, text: errText(e, 'Could not test it. Check your connection.') }); }
  };
  return (
    <li className={`ac-row${c.enabled ? '' : ' off'}`}>
      <div className="ac-row-main">
        <b>{c.label}</b>
        <span className="ac-sub">{c.provider === 'custom' ? c.baseUrl : 'Key saved'}{c.unreadable ? ' · the saved key cannot be read here: add it again' : ''}</span>
      </div>
      <ModelSelect c={c} onPick={onChange} />
      <button type="button" className="ac-btn" onClick={runTest} disabled={test === 'busy'} aria-label={`Test ${c.label}`}>{test === 'busy' ? 'Testing…' : 'Test'}</button>
      {test && test !== 'busy' && <span className={`ac-test ${test.ok ? 'ok' : 'bad'}`} role={test.ok ? 'status' : 'alert'}>{test.text}</span>}
      <label className="ac-switch"><input type="checkbox" checked={c.enabled} disabled={busy} onChange={(e) => onChange(c.id, { enabled: e.target.checked })} /> On</label>
      <span className="ac-move">
        <button type="button" aria-label={`Move ${c.label} up`} disabled={first || busy} onClick={() => onMove(c.id, -1)}><ChevronUp size={15} /></button>
        <button type="button" aria-label={`Move ${c.label} down`} disabled={last || busy} onClick={() => onMove(c.id, 1)}><ChevronDown size={15} /></button>
      </span>
      {sure
        ? <button type="button" className="ac-btn danger" onClick={() => onRemove(c.id)} onBlur={() => setSure(false)} autoFocus>Remove it?</button>
        : <button type="button" className="ac-icon" aria-label={`Remove ${c.label}`} onClick={() => setSure(true)}><Trash2 size={15} /></button>}
    </li>
  );
}

/**
 * Everything about cloud AI in one place: paste a key, Peblo finds the company and lists the models that key can use,
 * you pick one and add it. Your connections are listed below, each with a model list of its own.
 * theme: 'soft' | 'river' | 'orbit' (which style's colours to borrow).
 */
export default function AiConnections({ theme }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['ai-connections'], queryFn: () => aiConnectionsAPI.list().then((r) => r.data) });
  const [key, setKey] = useState('');
  const [provider, setProvider] = useState('');   // picked by hand, only when the key's company could not be told
  const [address, setAddress] = useState('');
  const [found, setFound] = useState(null);       // answer of "detect"
  const [model, setModel] = useState('');
  const [state, setState] = useState({ busy: false, checking: false, error: '', note: '' });
  const [pickProvider, setPickProvider] = useState(false);
  const checked = useRef('');                     // the key (and provider) already looked at, so it is not asked twice

  const connections = data?.connections || [];
  const providers = data?.providers || [];
  const isCustom = provider === 'custom';
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ['ai-connections'] }); queryClient.invalidateQueries({ queryKey: ['hub-models'] }); };
  const reset = () => { setKey(''); setProvider(''); setAddress(''); setFound(null); setModel(''); setPickProvider(false); checked.current = ''; };

  const check = async () => {
    const k = key.trim();
    checked.current = `${provider}|${k}`;
    setState({ busy: false, checking: true, error: '', note: '' }); setFound(null);
    try {
      const { data: r } = await aiConnectionsAPI.detect({ key: k, provider: provider || undefined, baseUrl: isCustom ? address : undefined });
      if (!r.ok) {
        if (r.needsProvider) setPickProvider(true);
        setState({ busy: false, checking: false, error: r.error || 'That key was not accepted.', note: '' });
        return;
      }
      setFound(r); setModel(r.suggestedModel || r.models?.[0] || '');
      setState({ busy: false, checking: false, error: '', note: '' });
    } catch (e) {
      setState({ busy: false, checking: false, error: errText(e, 'Could not check that key.'), note: '' });
    }
  };

  // A pasted key is looked at by itself: no button to press.
  useEffect(() => {
    const k = key.trim();
    if (isCustom || k.length < 20 || checked.current === `${provider}|${k}`) return undefined;
    const t = setTimeout(check, 500);
    return () => clearTimeout(t);
  }, [key, provider]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setState({ busy: true, checking: false, error: '', note: '' });
    try {
      await aiConnectionsAPI.add({ provider: found.provider, key: key.trim(), baseUrl: found.baseUrl || undefined, model });
      setState({ busy: false, checking: false, error: '', note: `${found.label} added.` });
      reset(); refresh();
    } catch (e) {
      setState({ busy: false, checking: false, error: errText(e, 'Could not save that.'), note: '' });
    }
  };

  const change = async (id, patch) => {
    try { await aiConnectionsAPI.update(id, patch); } catch (e) { setState((s) => ({ ...s, error: errText(e, 'Could not change that.') })); }
    refresh();
  };
  const move = async (id, delta) => {
    const ids = connections.map((c) => c.id);
    const i = ids.indexOf(id); const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await aiConnectionsAPI.order(ids); } catch (e) { setState((s) => ({ ...s, error: errText(e, 'Could not reorder.') })); }
    refresh();
  };
  const remove = async (id) => {
    try { await aiConnectionsAPI.remove(id); } catch (e) { setState((s) => ({ ...s, error: errText(e, 'Could not remove that.') })); }
    refresh();
  };

  const hint = providers.find((p) => p.id === provider)?.keyHint;

  return (
    <div className="ac" data-theme={theme}>
      <h3 className="ac-h">Add an AI</h3>
      <p className="ac-sub">Paste an API key from any company. Peblo finds out whose it is and lists the models it can use.</p>

      <form className="ac-form" onSubmit={(e) => { e.preventDefault(); check(); }}>
        <label className="ac-sr" htmlFor="ac-key">API key</label>
        <input id="ac-key" type="password" value={key} placeholder={isCustom ? 'API key (leave empty if the server needs none)' : 'Paste an API key…'} autoComplete="off" spellCheck={false}
          onChange={(e) => { setKey(e.target.value); setFound(null); setState({ busy: false, checking: false, error: '', note: '' }); }} />
        {isCustom && <button type="submit" className="ac-btn" disabled={state.checking || !address.trim()}>{state.checking ? 'Checking…' : 'Check'}</button>}
      </form>

      {(pickProvider || provider) && (
        <div className="ac-pick">
          <label htmlFor="ac-provider">Company</label>
          <select id="ac-provider" value={provider} onChange={(e) => { setProvider(e.target.value); setFound(null); setState({ busy: false, checking: false, error: '', note: '' }); }}>
            <option value="">Pick one…</option>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          {isCustom && <input aria-label="Server address" value={address} onChange={(e) => { setAddress(e.target.value); setFound(null); }} placeholder={data?.localAddressesAllowed ? 'http://127.0.0.1:1234/v1' : 'https://api.example.com/v1'} spellCheck={false} />}
          {hint && <span className="ac-sub">{isCustom ? hint : `Get a key at ${hint}`}{isCustom && !data?.localAddressesAllowed ? ' It must be a public https:// address.' : ''}</span>}
        </div>
      )}
      {!pickProvider && !provider && <button type="button" className="ac-link" onClick={() => setPickProvider(true)}>Not detected? Pick the company, or use your own server address</button>}

      {state.checking && <p role="status" className="ac-sub">Checking the key…</p>}
      {state.error && <p role="alert" className="ac-msg bad">{state.error}</p>}
      {state.note && <p role="status" className="ac-msg ok"><Check size={14} strokeWidth={2.6} /> {state.note}</p>}

      {found && (
        <div className="ac-found">
          <p className="ac-msg ok"><Check size={14} strokeWidth={2.6} /> <span><b>{found.label}</b> key{found.models.length ? ` · ${found.models.length} model${found.models.length === 1 ? '' : 's'} available` : ''}</span></p>
          <div className="ac-pick">
            <label htmlFor="ac-model">Model</label>
            {found.models.length
              ? <select id="ac-model" value={model} onChange={(e) => setModel(e.target.value)}>{found.models.map((m) => <option key={m} value={m}>{m}</option>)}</select>
              : <input id="ac-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Type the model name" spellCheck={false} />}
          </div>
          <button type="button" className="ac-btn" disabled={state.busy || !model.trim()} onClick={save}>{state.busy ? 'Adding…' : 'Add it'}</button>
        </div>
      )}

      {connections.length > 0 && (
        <>
          <h3 className="ac-h" style={{ marginTop: 16 }}>Your AI</h3>
          <p className="ac-sub">Peblo tries these from the top. You can also switch the model right in the chat.</p>
          <ul className="ac-list">
            {connections.map((c, i) => (
              <Row key={c.id} c={c} first={i === 0} last={i === connections.length - 1} busy={state.busy} onChange={change} onMove={move} onRemove={remove} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
