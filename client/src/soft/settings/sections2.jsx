import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Plug, Download, Upload, Trash2, Link2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { transferAPI, tokensAPI } from '../../api';
import api from '../../api/client';
import { authHeaders, signOutIfRejected } from '../../api/token';
import { usePublicUrl } from '../../api/publicUrl';
import AccessTokens from '../../components/AccessTokens';
import DataTools from '../../components/DataTools';
import SoftConnections from '../SoftConnections';
import { Card, Row, Switch, Seg, CopyButton, Confirm, useSave } from './ui';

const FEATURES = [
  { id: 'ask', name: 'Ask your notes', desc: 'Chat answers in the AI Hub and inside a note.' },
  { id: 'improve', name: 'Improve writing', desc: 'Rewrite, shorten, fix grammar on text you pick.' },
  { id: 'summaries', name: 'Summaries and action items', desc: 'The summary and to-do list Peblo makes from a note.' },
];

export function AISection() {
  const { settings } = useAuth();
  const save = useSave();
  const off = settings?.aiOff === true;
  const localOnly = settings?.defaultAiModel === 'ollama';
  const pins = settings?.aiFeatures || {};
  return (
    <>
      <Card title="AI on or off">
        <Row label="Turn off all AI" hint="Nothing is sent to any model, anywhere in Peblo.">
          <Switch label="Turn off all AI" checked={off} onChange={(v) => save({ aiOff: v })} />
        </Row>
      </Card>
      <Card title="Where each feature runs" hint={localOnly ? 'Your main choice below is "Only on this computer", so cloud is switched off for everything.' : 'Pin a feature to your computer for privacy, or to the cloud for speed. Automatic follows your main choice below.'}>
        <ul className="s-set-feats">
          {FEATURES.map((f) => (
            <li key={f.id}>
              <div><b>{f.name}</b><small>{f.desc}</small></div>
              <Seg label={`${f.name}: where it runs`} disabled={off} value={pins[f.id] || 'auto'}
                onChange={(v) => save({ aiFeatures: { ...pins, [f.id]: v } })}
                options={[
                  { id: 'auto', label: 'Automatic' },
                  { id: 'local', label: 'This computer', title: 'Never leaves your computer' },
                  { id: 'cloud', label: 'Cloud', disabled: localOnly, title: localOnly ? 'Blocked by "Only on this computer"' : 'Uses your OpenAI or Gemini key' },
                ]} />
            </li>
          ))}
        </ul>
      </Card>
      <SoftConnections embedded />
    </>
  );
}

const hostOf = (u) => String(u || '').replace(/^https?:\/\//, '');

export function ConnectSection() {
  const base = usePublicUrl();
  const address = base ? `${base}/mcp` : '';
  const [tokens, setTokens] = useState(null);
  const load = useCallback(async () => {
    try { const { data } = await tokensAPI.list(); setTokens(data.tokens || []); } catch { setTokens([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const apps = (tokens || []).filter((t) => /^Connected:/i.test(t.name));
  const remove = async (t) => { try { await tokensAPI.remove(t.id); } catch { /* shown again by the reload */ } load(); };

  return (
    <>
      <Card title="Connect Claude and other AI apps" hint="Let an AI app read your notes and add tasks, with your say-so. You sign in on Peblo's own page, so no keys to copy.">
        <div className="s-set-addr">
          <span className="s-set-addr-label">Peblo address</span>
          <code aria-label="Peblo MCP address">{address || 'Loading…'}</code>
          <CopyButton text={address} />
        </div>
        <ol className="s-set-steps">
          <li><b>1.</b> In Claude, open Settings, then Connectors, then <i>Add custom connector</i>, and paste the address above.</li>
          <li><b>2.</b> Press <i>Connect</i>. Peblo opens, you sign in and press <i>Allow</i>.</li>
          <li><b>3.</b> Ask Claude about your notes. It can search, read, add notes and tasks. It cannot delete anything.</li>
        </ol>
      </Card>

      <Card title="Connected apps" hint="Apps you have allowed. Remove access any time and they stop working straight away.">
        {tokens === null && <p className="s-empty small">Checking…</p>}
        {tokens && apps.length === 0 && <p className="s-empty small">Nothing connected yet.</p>}
        <ul className="s-set-accts">
          {apps.map((t) => (
            <li key={t.id}>
              <span className="s-set-avatar sm" style={{ background: 'var(--s-sky)' }} aria-hidden="true"><Plug size={16} /></span>
              <span className="grow"><b>{t.name.replace(/^Connected:\s*/i, '')}</b><small>{t.lastUsedAt ? `Last used ${new Date(t.lastUsedAt).toLocaleDateString()}` : 'Not used yet'}{t.scope === 'read' ? ' · read only' : ''}</small></span>
              <Confirm label="Remove access" ask={`Remove ${t.name.replace(/^Connected:\s*/i, '')}?`} onYes={() => remove(t)} />
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Activity log" tone="lilac" hint="A list of everything connected apps read or changed is coming next." />

      <details className="s-set-adv">
        <summary>Advanced: access tokens for scripts and the local MCP server</summary>
        <AccessTokens />
      </details>
    </>
  );
}

export function SharedSection() {
  const base = usePublicUrl() || window.location.origin;
  const [links, setLinks] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    try { const { data } = await api.get('/share'); setLinks(data.links || []); setErr(''); } catch { setErr('Could not load your shared links.'); setLinks([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const mode = async (l, edit) => { try { await api.post(`/share/${l.kind}/${l.id}`, { edit }); } catch { setErr('Could not change that link.'); } load(); };
  const stop = async (l) => { try { await api.delete(`/share/${l.kind}/${l.id}`); } catch { setErr('Could not stop sharing.'); } load(); };
  return (
    <Card title="Shared links" hint="Everything you have shared with a link. Anyone with the link can open it without signing in.">
      {links === null && <p className="s-empty small">Checking…</p>}
      {links && links.length === 0 && <p className="s-empty small">You have not shared anything. Open a note or task and press Share.</p>}
      <ul className="s-set-accts">
        {links?.map((l) => (
          <li key={`${l.kind}-${l.id}`}>
            <span className="s-set-avatar sm" style={{ background: l.kind === 'note' ? 'var(--s-butter)' : 'var(--s-mint)' }} aria-hidden="true"><Link2 size={16} /></span>
            <span className="grow"><b>{l.title}</b><small>{l.kind === 'note' ? 'Note' : 'Task'} · {hostOf(base)}/s/{l.kind}/…{l.token.slice(-4)}</small></span>
            <Seg label={`${l.title}: what people can do`} value={l.edit ? 'edit' : 'view'} onChange={(v) => mode(l, v === 'edit')} options={[{ id: 'view', label: 'Can view' }, { id: 'edit', label: 'Can edit' }]} />
            <CopyButton text={`${base}/s/${l.kind}/${l.token}`} label="Copy link" />
            <Confirm label="Stop sharing" ask="Stop sharing?" onYes={() => stop(l)} />
          </li>
        ))}
      </ul>
      {err && <p role="alert" className="s-set-bad">{err}</p>}
    </Card>
  );
}

export function DataSection() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState(null);

  const exportAll = async () => {
    setExporting(true); setMsg(null);
    try {
      const res = signOutIfRejected(await fetch(`${import.meta.env.VITE_API_URL || '/api'}/export`, { headers: authHeaders() }));
      if (!res.ok) throw new Error('Export failed');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = 'peblo-notes.zip'; a.click();
      URL.revokeObjectURL(url);
    } catch { setMsg({ ok: false, text: 'Could not export your notes. Try again.' }); }
    finally { setExporting(false); }
  };
  const importFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setImporting(true); setMsg(null);
    try {
      const form = new FormData();
      files.forEach((f) => form.append('files', f));
      const { data } = await transferAPI.importFiles(form);
      setMsg({ ok: true, text: `Imported ${data.imported} note${data.imported === 1 ? '' : 's'}. They are tagged "imported".` });
      queryClient.invalidateQueries();
    } catch (err) {
      setMsg({ ok: false, text: err.response?.data?.error || 'Import failed. Use a Notion "Markdown & CSV" export or Markdown files.' });
    } finally { setImporting(false); }
  };

  return (
    <>
      <Card title="Back up and move" hint="Your notes are yours. Take them out as Markdown, or bring notes in from Notion.">
        <div className="s-set-actions">
          <button type="button" className="s-outline s-set-btn" onClick={exportAll} disabled={exporting}><Download size={15} /> {exporting ? 'Preparing…' : 'Export notes (.zip)'}</button>
          <label className="s-outline s-set-btn as-label"><Upload size={15} /> {importing ? 'Importing…' : 'Import notes'}
            <input type="file" multiple accept=".md,.markdown,.txt,.zip,.csv" hidden onChange={importFiles} disabled={importing} />
          </label>
        </div>
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 's-set-ok' : 's-set-bad'}>{msg.text}</p>}
      </Card>
      <Card title="Everything, including tasks" hint="One zip with all notes, tasks and settings. Also imports tasks from a CSV.">
        <DataTools />
      </Card>
      <Card title="Trash" hint="Deleted notes wait here until you remove them for good.">
        <div className="s-set-actions"><button type="button" className="s-outline s-set-btn" onClick={() => navigate('/notes?filter=trash')}><Trash2 size={15} /> Open trash</button></div>
      </Card>
    </>
  );
}

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '') ? 'Cmd' : 'Ctrl';
const KEYS = [
  { group: 'Everywhere', rows: [[`${MOD}+K`, 'Command palette: jump anywhere, find a note'], [`${MOD}+Shift+Space`, 'Quick capture, from any app (desktop)'], [`${MOD}+J`, 'Open the AI Hub'], ['?', 'Show help']] },
  { group: 'Notes', rows: [[`${MOD}+N`, 'New note'], [`${MOD}+S`, 'Save now'], [`${MOD}+/`, 'Search notes']] },
  { group: 'Quick capture', rows: [['Tab', 'Switch between note and task'], ['Esc', 'Close']] },
];

export function ShortcutsSection() {
  return (
    <>
      {KEYS.map((g) => (
        <Card key={g.group} title={g.group}>
          <ul className="s-set-keys">
            {g.rows.map(([k, d]) => <li key={k}><kbd>{k}</kbd><span>{d}</span></li>)}
          </ul>
        </Card>
      ))}
      <div className="s-set-actions"><button type="button" className="s-outline s-set-btn" onClick={() => window.dispatchEvent(new Event('peblo:help'))}>Open the full help</button></div>
    </>
  );
}

export function AboutSection() {
  const { user } = useAuth();
  const base = usePublicUrl();
  return (
    <Card title="About Peblo" hint="Notes, tasks and a calendar that your AI can work with.">
      <Row label="Signed in as"><span className="s-set-static">{user?.email}</span></Row>
      <Row label="Public address" hint="Share links and the AI-app connection use this."><span className="s-set-static">{base || '…'}</span></Row>
      <Row label="This app talks to"><span className="s-set-static">{window.location.origin}</span></Row>
      <Row label="Send feedback"><a className="s-link-btn" href="https://github.com/Tejaskumarno1/peblo-full-stack-developerf/issues/new" target="_blank" rel="noreferrer">Report a problem or idea</a></Row>
    </Card>
  );
}
