import React, { useEffect, useState } from 'react';
import { Plug, Trash2, Copy } from 'lucide-react';
import { tokensAPI } from '../api';

// PEB-95: personal access tokens for the Peblo MCP server (Claude Desktop, Cursor) and scripts.
export default function AccessTokens() {
  const [tokens, setTokens] = useState([]);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState(null); // the secret, shown once
  const [msg, setMsg] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    try { const { data } = await tokensAPI.list(); setTokens(data.tokens || []); } catch { /* the list stays empty */ }
  };
  useEffect(() => { load(); }, []);

  const make = async (e) => {
    e.preventDefault();
    setMsg(null); setCopied(false);
    try {
      const { data } = await tokensAPI.create(name.trim());
      setFresh(data.token); setName(''); load();
    } catch (err) { setMsg(err.response?.data?.error || 'Could not make the token.'); }
  };
  const revoke = async (t) => {
    if (!window.confirm(`Remove "${t.name}"? Anything using it stops working straight away.`)) return;
    try { await tokensAPI.remove(t.id); setFresh(null); load(); } catch (err) { setMsg(err.response?.data?.error || 'Could not remove it.'); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(fresh); setCopied(true); } catch { /* select the text by hand */ }
  };

  return (
    <>
      <h3 style={{ marginTop: '2rem', marginBottom: '0.75rem', fontSize: '1.05rem' }}>Access tokens</h3>
      <form onSubmit={make} className="settings-toggle-row" style={{ display: 'block' }} aria-label="Access tokens">
        <div className="settings-toggle-info" style={{ marginBottom: '0.75rem' }}>
          <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Plug size={16} /> Connect Claude, Cursor and other tools</h4>
          <p>
            A token lets another program read and write your notes and tasks, for example the Peblo MCP server
            (<code>npm run mcp</code>). It can never change your password or settings or delete anything through the MCP server.
            You see the token once, so copy it straight away.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input id="token-name" aria-label="Token name" className="settings-field-input" style={{ flex: '1 1 14rem' }} placeholder='Name, e.g. "Claude Desktop"' maxLength={60} value={name} onChange={(e) => setName(e.target.value)} required />
          <button type="submit" className="btn btn-primary">Make token</button>
        </div>
        {fresh && (
          <div role="status" style={{ marginTop: '0.75rem' }}>
            <p style={{ margin: '0 0 0.35rem', fontWeight: 500 }}>Copy it now. It will not be shown again.</p>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <code data-testid="new-token" style={{ flex: 1, padding: '0.5rem', overflowWrap: 'anywhere', userSelect: 'all' }}>{fresh}</code>
              <button type="button" className="btn btn-outline" onClick={copy}><Copy size={14} /> {copied ? 'Copied' : 'Copy'}</button>
            </div>
          </div>
        )}
        {msg && <p role="alert" style={{ margin: '0.5rem 0', color: '#ef4444' }}>{msg}</p>}
        {tokens.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: '0.75rem 0 0' }}>
            {tokens.map((t) => (
              <li key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.4rem 0' }}>
                <span style={{ flex: 1 }}>
                  <strong>{t.name}</strong> <code>{t.prefix}…</code>
                  <span style={{ opacity: 0.7 }}> · {t.lastUsedAt ? `used ${new Date(t.lastUsedAt).toLocaleDateString()}` : 'never used'}</span>
                </span>
                <button type="button" className="btn btn-outline" aria-label={`Remove ${t.name}`} onClick={() => revoke(t)}><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        )}
      </form>
    </>
  );
}
