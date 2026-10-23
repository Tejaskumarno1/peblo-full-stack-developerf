// "Connect" sign-in for MCP clients: discovery, registration, approve page, token swap, then real MCP calls over /mcp.
import crypto from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { boot } from './lib.mjs';

const { base, api, page, check, finish } = await boot();
const b64 = (b) => Buffer.from(b).toString('base64url');
const REDIRECT = 'http://127.0.0.1:9/callback';
let mcp;
try {
  // 1. an app that has not connected yet is told where to sign in
  const un = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: '{}' });
  check('/mcp without a token answers 401', un.status === 401, String(un.status));
  check('401 points at the discovery document', /resource_metadata="[^"]+\.well-known\/oauth-protected-resource"/.test(un.headers.get('www-authenticate') || ''), un.headers.get('www-authenticate'));

  // 2. discovery
  const pr = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
  check('protected resource names the authorization server', pr.authorization_servers?.[0] === base && pr.resource === `${base}/mcp`, JSON.stringify(pr));
  const as = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
  check('server metadata lists S256 and registration', as.code_challenge_methods_supported?.includes('S256') && !!as.registration_endpoint && !!as.token_endpoint, JSON.stringify(as));

  // 3. the app registers itself (and bad redirects are refused)
  const bad = await fetch(as.registration_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'x', redirect_uris: ['javascript:alert(1)'] }) });
  check('registration refuses a javascript: redirect', bad.status === 400, String(bad.status));
  const reg = await (await fetch(as.registration_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT] }) })).json();
  check('registration returns a client_id', !!reg.client_id, JSON.stringify(reg));

  const pkce = () => { const v = b64(crypto.randomBytes(32)); return { v, c: b64(crypto.createHash('sha256').update(v).digest()) }; };

  // 4. the person approves on Peblo's page (already signed in here)
  const k = pkce();
  await page.route('http://127.0.0.1:9/**', (r) => r.fulfill({ status: 200, body: 'ok' }));
  const authUrl = `${as.authorization_endpoint}?response_type=code&client_id=${reg.client_id}&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${k.c}&code_challenge_method=S256&state=abc123&scope=write`;
  await page.goto(authUrl);
  await page.getByRole('heading', { name: /Let Claude use your Peblo/ }).waitFor({ timeout: 15000 });
  check('approve page names the app', true);
  await page.screenshot({ path: 'C:/Users/tejas/peblo-e2e/oauth-consent.png' });
  const back = page.waitForRequest((r) => r.url().startsWith(REDIRECT), { timeout: 10000 });
  await page.getByRole('button', { name: 'Allow' }).click();
  const cb = new URL((await back).url());
  check('state is returned unchanged', cb.searchParams.get('state') === 'abc123');
  const code = cb.searchParams.get('code');
  check('a code comes back', !!code);

  // 5. swap the code for an access token (wrong secret first, then the right one, then replay)
  const tok = (body) => fetch(as.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  const base4 = { grant_type: 'authorization_code', redirect_uri: REDIRECT, client_id: reg.client_id };
  const wrong = await tok({ ...base4, code, code_verifier: b64(crypto.randomBytes(32)) });
  check('wrong PKCE secret is refused', wrong.status === 400);
  // the failed try already used the code up, so approve again for the real swap
  const k2 = pkce();
  const ap = await api('POST', '/api/oauth/approve', { client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: k2.c, state: 's2', scope: 'write' });
  const code2 = new URL(ap.redirect).searchParams.get('code');
  const good = await (await tok({ ...base4, code: code2, code_verifier: k2.v })).json();
  check('right secret gives an access token', /^pbl_/.test(good.access_token || ''), JSON.stringify(good));
  const again = await tok({ ...base4, code: code2, code_verifier: k2.v });
  check('a code works only once', again.status === 400);

  // 6. real MCP calls over the hosted endpoint
  mcp = new Client({ name: 'e2e', version: '1' });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${good.access_token}` } } }));
  const tools = (await mcp.listTools()).tools.map((t) => t.name);
  check('hosted /mcp lists the tools', tools.includes('create_note') && tools.includes('search_notes'), tools.join(','));
  const made = await mcp.callTool({ name: 'create_note', arguments: { title: 'Via Connect', content: 'Made through OAuth' } });
  check('create_note through /mcp works', !made.isError, JSON.stringify(made.content));
  const list = (await api('GET', '/api/notes?search=Via%20Connect')).notes || [];
  check('the note is in the account', list.some((n) => n.title === 'Via Connect'));

  // 7. it shows in the token list and can be removed
  const toks = (await api('GET', '/api/tokens')).tokens;
  const mine = toks.find((t) => t.name === 'Connected: Claude');
  check('access shows up in the token list', !!mine, JSON.stringify(toks.map((t) => t.name)));
  await api('DELETE', `/api/tokens/${mine.id}`);
  const dead = await fetch(`${base}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${good.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: '{}' });
  check('removed access stops working', dead.status === 401, String(dead.status));

  // 8. read-only approval, and Cancel
  const k3 = pkce();
  const ro = await api('POST', '/api/oauth/approve', { client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: k3.c, scope: 'read' });
  const roTok = await (await tok({ ...base4, code: new URL(ro.redirect).searchParams.get('code'), code_verifier: k3.v })).json();
  const mcp2 = new Client({ name: 'e2e2', version: '1' });
  await mcp2.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${roTok.access_token}` } } }));
  const w = await mcp2.callTool({ name: 'create_note', arguments: { title: 'nope' } });
  check('read-only approval cannot write', !!w.isError, JSON.stringify(w.content));
  await mcp2.close();
  const den = await api('POST', '/api/oauth/approve', { client_id: reg.client_id, redirect_uri: REDIRECT, state: 'z', deny: true });
  check('Cancel returns access_denied', new URL(den.redirect).searchParams.get('error') === 'access_denied');

  // 9. an unregistered return address is never redirected to
  const evil = await fetch(`${as.authorization_endpoint}?response_type=code&client_id=${reg.client_id}&redirect_uri=${encodeURIComponent('https://evil.example/x')}&code_challenge=${k.c}&code_challenge_method=S256`, { redirect: 'manual' });
  check('unregistered redirect_uri gets an error page, not a redirect', evil.status === 400, String(evil.status));
} catch (e) {
  check('oauth test ran', false, String(e));
} finally {
  try { await mcp?.close(); } catch { /* ignore */ }
  await finish();
}
