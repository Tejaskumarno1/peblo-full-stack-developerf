import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Plug, Download, Upload, Trash2, Link2, Check, X as XIcon } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { transferAPI, tokensAPI } from '../../api';
import api from '../../api/client';
import { authHeaders, signOutIfRejected } from '../../api/token';
import { usePublicUrl } from '../../api/publicUrl';
import AccessTokens from '../../components/AccessTokens';
import DataTools from '../../components/DataTools';
import { exportCalendar, importCalendar } from '../../river/calendarIO';
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

const TOOL_LABELS = {
  search_notes: 'Searched notes', get_note: 'Read a note', create_note: 'Added a note', append_to_note: 'Added to a note', update_note: 'Changed a note',
  list_tasks: 'Looked at tasks', create_task: 'Added a task', complete_task: 'Ticked a task', update_task: 'Changed a task', get_calendar: 'Looked at the calendar',
  list_tags: 'Listed tags', create_share_link: 'Made a share link', stop_sharing: 'Stopped sharing',
  archive_note: 'Archived a note', pin_note: 'Pinned a note', trash_note: 'Moved a note to the trash', restore_note: 'Restored a note', list_trash: 'Looked at the trash',
  get_backlinks: 'Looked at backlinks', list_note_history: 'Looked at note history', restore_note_version: 'Restored an older version', rename_tag: 'Renamed a tag',
};
const ago = (d) => {
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(d).toLocaleDateString();
};

/** Checks the three things a connecting app checks, and says plainly which one fails. */
function TestConnection({ base, address }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true); setRows([]);
    const out = [];
    const add = (name, ok, detail) => { out.push({ name, ok, detail }); setRows([...out]); };
    const get = async (url, init) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), 70000); try { return await fetch(url, { ...init, signal: c.signal }); } finally { clearTimeout(t); } };
    try {
      const r = await get(address, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'peblo-settings', version: '1' } } }) });
      add('The server answers at this address', r.status === 401, r.status === 401 ? 'It asks apps to sign in, which is right.' : `It answered ${r.status}. Expected 401 (sign in needed).`);
    } catch (e) { add('The server answers at this address', false, 'Could not reach it. If the app was asleep, wait a minute and try again.'); }
    try {
      const r = await get(`${base}/.well-known/oauth-protected-resource`);
      const j = r.ok ? await r.json() : null;
      add('It tells apps where to sign in', !!j && j.resource === address, j ? (j.resource === address ? 'Sign-in details found.' : `Points at ${j.resource}, not this address.`) : `Answered ${r.status}.`);
    } catch { add('It tells apps where to sign in', false, 'Could not read the sign-in details.'); }
    try {
      const r = await get(`${base}/.well-known/oauth-authorization-server`);
      const j = r.ok ? await r.json() : null;
      add('Apps can register themselves', !!j?.registration_endpoint && !!j?.token_endpoint, j ? 'Registration and token endpoints are available.' : `Answered ${r.status}.`);
    } catch { add('Apps can register themselves', false, 'Could not read the registration details.'); }
    setBusy(false);
  };
  const allOk = rows && rows.length === 3 && rows.every((r) => r.ok);
  return (
    <div className="s-set-test">
      <div className="s-set-actions">
        <button type="button" className="s-outline s-set-btn" onClick={run} disabled={busy || !base}>{busy ? 'Checking…' : 'Test the connection'}</button>
        {allOk && <small className="ok">All good. Add this address in your app.</small>}
      </div>
      {rows && rows.length > 0 && (
        <ul className="s-set-checks" aria-label="Connection test results">
          {rows.map((r) => (
            <li key={r.name} className={r.ok ? 'ok' : 'bad'}>
              {r.ok ? <Check size={15} strokeWidth={3} /> : <XIcon size={15} strokeWidth={3} />}
              <span><b>{r.name}</b><small>{r.detail}</small></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActivityLog() {
  const [rows, setRows] = useState(null);
  const load = useCallback(async () => {
    try { const { data } = await api.get('/tokens/activity'); setRows(data.activity || []); } catch { setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const clear = async () => { try { await api.delete('/tokens/activity'); } catch { /* the reload shows what is left */ } load(); };
  return (
    <Card title="Activity" hint="What connected apps have done in your Peblo, newest first. Kept for 60 days."
      aside={rows?.length ? <Confirm label="Clear" ask="Clear the log?" onYes={clear} /> : null}>
      {rows === null && <p className="s-empty small">Checking…</p>}
      {rows && rows.length === 0 && <p className="s-empty small">Nothing yet. When an app searches, reads or adds something, it shows up here.</p>}
      <ul className="s-set-log">
        {rows?.slice(0, 40).map((r) => (
          <li key={r.id} className={r.ok ? '' : 'bad'}>
            <span className="when">{ago(r.at)}</span>
            <span className="what"><b>{r.app}</b> {TOOL_LABELS[r.tool] || r.tool}{r.summary ? <i> · {r.summary}</i> : null}{r.ok ? '' : ' (it did not work)'}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

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
        <TestConnection base={base} address={address} />
        <p className="s-set-note">Copy the address exactly, with no full stop at the end. On Render's free plan the app sleeps when nobody uses it, so the first connection after a quiet spell can take about a minute.</p>
        <ol className="s-set-steps">
          <li><b>1.</b> In Claude, open Settings, then Connectors, then <i>Add custom connector</i>, and paste the address above.</li>
          <li><b>2.</b> Press <i>Connect</i>. Peblo opens, you sign in and press <i>Allow</i>.</li>
          <li><b>3.</b> Ask Claude about your notes. It can search, read, add notes and tasks. It cannot permanently delete anything.</li>
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

      <ActivityLog />

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

/** Take meetings and tasks with dates out as an .ics file (Google Calendar, Outlook, Apple), or bring an .ics in. Same in every style. */
function CalendarTransfer() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const out = async () => {
    setBusy(true); setMsg(null);
    try { const n = await exportCalendar(); setMsg({ ok: true, text: `Downloaded ${n} item${n === 1 ? '' : 's'} (.ics).` }); }
    catch { setMsg({ ok: false, text: 'Could not export the calendar.' }); }
    finally { setBusy(false); }
  };
  const inn = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true); setMsg(null);
    try {
      const r = await importCalendar(f);
      setMsg({ ok: true, text: `Added ${r.added} meeting${r.added === 1 ? '' : 's'}${r.skipped ? `, skipped ${r.skipped} that were already here or had no time` : ''}.` });
      qc.invalidateQueries({ queryKey: ['todos'] });
    } catch { setMsg({ ok: false, text: 'Could not read that file. Choose an .ics calendar file.' }); }
    finally { setBusy(false); }
  };
  return (
    <Card id="set-calendar-file" title="Calendar file (.ics)" hint="Move your meetings and dated tasks to or from Google Calendar, Outlook and Apple Calendar.">
      <div className="s-set-actions">
        <button type="button" className="s-outline s-set-btn" onClick={out} disabled={busy}><Download size={15} /> Export calendar</button>
        <label className="s-outline s-set-btn as-label"><Upload size={15} /> Import calendar
          <input type="file" accept=".ics,text/calendar" hidden onChange={inn} disabled={busy} />
        </label>
      </div>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 's-set-ok' : 's-set-bad'}>{msg.text}</p>}
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
      <CalendarTransfer />
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
