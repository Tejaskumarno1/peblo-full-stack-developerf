import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { aiConnectionsAPI } from '../../api';
import './aiConnections.css';

const errText = (e, fallback) => e?.response?.data?.error || fallback;

/** One saved connection: on/off, which model, its place in the order, remove. */
function Row({ c, first, last, onChange, onMove, onRemove, busy }) {
  const [model, setModel] = useState(c.model);
  const [sure, setSure] = useState(false);
  const commit = () => { const m = model.trim(); if (m && m !== c.model) onChange(c.id, { model: m }); else setModel(c.model); };
  return (
    <li className={`ac-row${c.enabled ? '' : ' off'}`}>
      <div className="ac-row-main">
        <b>{c.label}</b>
        <span className="ac-sub">{c.provider === 'custom' ? c.baseUrl : c.provider}{c.unreadable ? ' · key cannot be read here, add it again' : ''}</span>
      </div>
      <input className="ac-model" aria-label={`Model for ${c.label}`} value={model} onChange={(e) => setModel(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} spellCheck={false} />
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
 * "Add any AI": paste a key, Peblo works out which company it is from and checks it, then you pick a model.
 * OpenAI and Gemini keys go to their own boxes above (through `apply`); everything else is saved as a connection here.
 * theme: 'soft' | 'river' | 'orbit' (which style's colours to borrow).
 */
export default function AiConnections({ theme, apply }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['ai-connections'], queryFn: () => aiConnectionsAPI.list().then((r) => r.data) });
  const [key, setKey] = useState('');
  const [provider, setProvider] = useState('');   // chosen by hand when the key's company could not be told
  const [address, setAddress] = useState('');
  const [found, setFound] = useState(null);       // answer of "detect"
  const [model, setModel] = useState('');
  const [label, setLabel] = useState('');
  const [state, setState] = useState({ busy: false, error: '', note: '' });
  const [pickProvider, setPickProvider] = useState(false);

  const connections = data?.connections || [];
  const providers = data?.providers || [];
  const isCustom = provider === 'custom';
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ['ai-connections'] }); queryClient.invalidateQueries({ queryKey: ['hub-models'] }); };
  const reset = () => { setKey(''); setProvider(''); setAddress(''); setFound(null); setModel(''); setLabel(''); setPickProvider(false); };

  const check = async () => {
    setState({ busy: true, error: '', note: '' }); setFound(null);
    try {
      const { data: r } = await aiConnectionsAPI.detect({ key, provider: provider || undefined, baseUrl: isCustom ? address : undefined });
      if (!r.ok) {
        if (r.needsProvider) setPickProvider(true);
        setState({ busy: false, error: r.error || 'That key was not accepted.', note: '' });
        return;
      }
      setFound(r); setModel(r.suggestedModel || ''); setLabel('');
      setState({ busy: false, error: '', note: '' });
    } catch (e) {
      setState({ busy: false, error: errText(e, 'Could not check that key.'), note: '' });
    }
  };

  const save = async () => {
    setState({ busy: true, error: '', note: '' });
    try {
      const info = providers.find((p) => p.id === found.provider);
      if (info?.slot) {
        // OpenAI and Gemini keep their own boxes (and model lists) above.
        await apply({ [info.slot]: key.trim() });
        setState({ busy: false, error: '', note: `${found.label} key saved in its box above.` });
      } else {
        await aiConnectionsAPI.add({ provider: found.provider, key: key.trim(), baseUrl: found.baseUrl || undefined, model, label: label.trim() || undefined });
        setState({ busy: false, error: '', note: `${label.trim() || found.label} added.` });
      }
      reset(); refresh();
    } catch (e) {
      setState({ busy: false, error: errText(e, 'Could not save that connection.'), note: '' });
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
  const canCheck = !state.busy && (isCustom ? !!address.trim() : !!key.trim());

  return (
    <div className="ac" data-theme={theme}>
      <h3 className="ac-h">Add any AI</h3>
      <p className="ac-sub">Paste a key from OpenAI, Gemini, Claude, Groq, OpenRouter, DeepSeek and others. Peblo works out whose it is and checks it before saving.</p>

      <form className="ac-form" onSubmit={(e) => { e.preventDefault(); if (canCheck) check(); }}>
        <label className="ac-sr" htmlFor="ac-key">API key</label>
        <input id="ac-key" type="password" value={key} placeholder={isCustom ? 'API key (leave empty if the server needs none)' : 'Paste an API key…'} autoComplete="off" spellCheck={false} onChange={(e) => { setKey(e.target.value); setFound(null); setState({ busy: false, error: '', note: '' }); }} />
        <button type="submit" className="ac-btn" disabled={!canCheck}>{state.busy && !found ? 'Checking…' : 'Check key'}</button>
      </form>

      {(pickProvider || provider) && (
        <div className="ac-pick">
          <label htmlFor="ac-provider">Provider</label>
          <select id="ac-provider" value={provider} onChange={(e) => { setProvider(e.target.value); setFound(null); setState({ busy: false, error: '', note: '' }); }}>
            <option value="">Pick one…</option>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          {isCustom && (
            <input aria-label="Server address" value={address} onChange={(e) => { setAddress(e.target.value); setFound(null); }} placeholder={data?.localAddressesAllowed ? 'http://127.0.0.1:1234/v1' : 'https://api.example.com/v1'} spellCheck={false} />
          )}
          {hint && !isCustom && <span className="ac-sub">Get a key at {hint}</span>}
          {isCustom && <span className="ac-sub">{hint}{data?.localAddressesAllowed ? '' : ' It must be a public https:// address.'}</span>}
        </div>
      )}
      {!pickProvider && !provider && <button type="button" className="ac-link" onClick={() => setPickProvider(true)}>Pick the provider myself or use a custom address</button>}

      {state.error && <p role="alert" className="ac-msg bad">{state.error}</p>}
      {state.note && <p role="status" className="ac-msg ok"><Check size={14} strokeWidth={2.6} /> {state.note}</p>}

      {found && (
        <div className="ac-found">
          <p className="ac-msg ok"><Check size={14} strokeWidth={2.6} /> That is a <b>{found.label}</b> key, and it works.</p>
          {!providers.find((p) => p.id === found.provider)?.slot && (
            <>
              <div className="ac-pick">
                <label htmlFor="ac-model">Model</label>
                <input id="ac-model" list="ac-models" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model name" spellCheck={false} />
                <datalist id="ac-models">{found.models.map((m) => <option key={m} value={m} />)}</datalist>
                <label htmlFor="ac-label">Name (optional)</label>
                <input id="ac-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={found.label} maxLength={60} />
              </div>
              {found.models.length === 0 && <span className="ac-sub">This server did not list its models, so type the model name.</span>}
            </>
          )}
          <button type="button" className="ac-btn" disabled={state.busy || (!providers.find((p) => p.id === found.provider)?.slot && !model.trim())} onClick={save}>{state.busy ? 'Saving…' : 'Add it'}</button>
        </div>
      )}

      {connections.length > 0 && (
        <>
          <h3 className="ac-h" style={{ marginTop: 16 }}>Your connections</h3>
          <p className="ac-sub">Peblo tries them from the top, after your OpenAI and Gemini keys. Connections on this computer (localhost) never count as cloud.</p>
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
