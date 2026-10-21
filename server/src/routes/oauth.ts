import { Router, type Request, type Response } from 'express';
import express from 'express';
import crypto from 'crypto';
import prisma from '../db.js';
import { authenticate, TOKEN_PREFIX, hashToken, verifyToken } from '../middleware/auth.js';
import { createPebloMcp } from '../mcp/tools.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

/*
 * "Connect" sign-in for MCP clients, the way Jira or Notion do it: the client is given only this server's address,
 * sends the person to a Peblo page to sign in and approve, and gets an access token back. OAuth 2.1 with PKCE (S256),
 * dynamic client registration (RFC 7591), and discovery documents (RFC 8414 / RFC 9728).
 * The access token is an ordinary Peblo access token (pbl_...): it shows in Settings and can be revoked there.
 */

export const origin = (req: Request) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
const b64 = (buf: Buffer) => buf.toString('base64url');
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest();
const CODE_MINUTES = 5;

/** http(s) on localhost, any https address, or an app's own scheme (claude://...). Never javascript:, data: and friends. */
function okRedirect(u: unknown): u is string {
  if (typeof u !== 'string' || u.length > 500) return false;
  let url: URL;
  try { url = new URL(u); } catch { return false; }
  if (url.hash) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return !['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:'].includes(url.protocol);
}

// ---------- discovery documents (public) ----------
export const wellKnown = Router();
const resourceDoc = (req: Request) => ({
  resource: `${origin(req)}/mcp`,
  authorization_servers: [origin(req)],
  bearer_methods_supported: ['header'],
  scopes_supported: ['read', 'write'],
  resource_name: 'Peblo',
});
wellKnown.get('/.well-known/oauth-protected-resource', (req, res) => res.json(resourceDoc(req)));
wellKnown.get('/.well-known/oauth-protected-resource/mcp', (req, res) => res.json(resourceDoc(req)));
wellKnown.get(['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp'], (req, res) => {
  const o = origin(req);
  res.json({
    issuer: o,
    authorization_endpoint: `${o}/oauth/authorize`,
    token_endpoint: `${o}/oauth/token`,
    registration_endpoint: `${o}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['read', 'write'],
  });
});

// ---------- the three OAuth endpoints (public) ----------
export const oauthRoutes = Router();
oauthRoutes.use(express.urlencoded({ extended: false, limit: '20kb' }));
oauthRoutes.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

// POST /oauth/register: an app tells Peblo its name and where to send people back
oauthRoutes.post('/register', async (req, res, next) => {
  try {
    const { client_name, redirect_uris } = req.body || {};
    if (!Array.isArray(redirect_uris) || redirect_uris.length < 1 || redirect_uris.length > 10 || !redirect_uris.every(okRedirect)) {
      return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'Give one to ten valid redirect addresses.' });
    }
    const name = String(client_name || 'An app').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80) || 'An app';
    const id = b64(crypto.randomBytes(16));
    await prisma.oauthClient.create({ data: { id, name, redirectUris: redirect_uris } });
    res.status(201).json({
      client_id: id, client_name: name, redirect_uris, token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'], response_types: ['code'],
    });
  } catch (e) { next(e); }
});

// GET /oauth/authorize: check the request, then hand the person to Peblo's own sign-in and approve page
oauthRoutes.get('/authorize', async (req, res, next) => {
  try {
    const q = req.query as Record<string, string>;
    const bad = (msg: string) => res.status(400).type('text/plain').send(`Could not connect: ${msg}`);
    if (!q.client_id) return bad('missing client_id.');
    const client = await prisma.oauthClient.findUnique({ where: { id: String(q.client_id) } });
    const uris = (client?.redirectUris as string[] | undefined) || [];
    if (!client || !uris.includes(q.redirect_uri)) return bad('this app is not registered with that return address.');
    const back = (error: string) => {
      const u = new URL(q.redirect_uri); u.searchParams.set('error', error); if (q.state) u.searchParams.set('state', q.state);
      return res.redirect(302, u.toString());
    };
    if (q.response_type !== 'code') return back('unsupported_response_type');
    if (!q.code_challenge || q.code_challenge_method !== 'S256') return back('invalid_request');
    const keep = new URLSearchParams();
    for (const k of ['client_id', 'redirect_uri', 'code_challenge', 'state', 'scope']) if (q[k]) keep.set(k, String(q[k]));
    res.redirect(302, `/oauth/consent?${keep.toString()}`);
  } catch (e) { next(e); }
});

// POST /oauth/token: swap the one-time code (plus the PKCE secret) for an access token
oauthRoutes.post('/token', async (req, res, next) => {
  try {
    const b = req.body || {};
    const fail = (error: string, status = 400) => res.status(status).json({ error });
    if (b.grant_type !== 'authorization_code') return fail('unsupported_grant_type');
    const { code, redirect_uri, client_id, code_verifier } = b;
    if (![code, redirect_uri, client_id, code_verifier].every((x) => typeof x === 'string' && x)) return fail('invalid_request');
    if (code_verifier.length < 43 || code_verifier.length > 128) return fail('invalid_grant');
    const hash = hashToken(code);
    // one use only: the row is removed the moment it is read
    const row = await prisma.oauthCode.findUnique({ where: { codeHash: hash }, include: { client: true } });
    if (!row) return fail('invalid_grant');
    const gone = await prisma.oauthCode.deleteMany({ where: { codeHash: hash } });
    if (!gone.count) return fail('invalid_grant');
    if (row.expiresAt.getTime() < Date.now() || row.clientId !== client_id || row.redirectUri !== redirect_uri) return fail('invalid_grant');
    if (b64(sha256(code_verifier)) !== row.codeChallenge) return fail('invalid_grant');

    const name = `Connected: ${row.client.name}`.slice(0, 60);
    const token = TOKEN_PREFIX + crypto.randomBytes(24).toString('base64url');
    // connecting the same app again replaces its earlier access
    await prisma.apiToken.deleteMany({ where: { userId: row.userId, name } });
    await prisma.apiToken.create({ data: { userId: row.userId, name, scope: row.scope === 'read' ? 'read' : 'full', tokenHash: hashToken(token), prefix: token.slice(0, 10) } });
    prisma.oauthCode.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
    res.json({ access_token: token, token_type: 'Bearer', scope: row.scope });
  } catch (e) { next(e); }
});

// ---------- used by Peblo's own approve page (signed in) ----------
export const oauthApi = Router();
oauthApi.use(authenticate);
const mustBePerson = (req: Request, res: Response) => {
  if ((req.user as { viaToken?: boolean } | undefined)?.viaToken) { res.status(403).json({ error: 'Sign in to Peblo yourself to approve this.' }); return false; }
  return true;
};

// GET /api/oauth/info?client_id=&redirect_uri= -> what to show on the approve page
oauthApi.get('/info', async (req, res, next) => {
  try {
    if (!mustBePerson(req, res)) return;
    const client = await prisma.oauthClient.findUnique({ where: { id: String(req.query.client_id || '') } });
    const uris = (client?.redirectUris as string[] | undefined) || [];
    if (!client || !uris.includes(String(req.query.redirect_uri || ''))) return res.status(404).json({ error: 'This app is not registered.' });
    let host = '';
    try { const u = new URL(String(req.query.redirect_uri)); host = u.host || u.protocol; } catch { /* leave empty */ }
    res.json({ name: client.name, host, email: req.user!.email });
  } catch (e) { next(e); }
});

// POST /api/oauth/approve { client_id, redirect_uri, code_challenge, state, scope, deny? } -> { redirect }
oauthApi.post('/approve', async (req, res, next) => {
  try {
    if (!mustBePerson(req, res)) return;
    const b = req.body || {};
    const client = await prisma.oauthClient.findUnique({ where: { id: String(b.client_id || '') } });
    const uris = (client?.redirectUris as string[] | undefined) || [];
    if (!client || !uris.includes(b.redirect_uri)) return res.status(400).json({ error: 'This app is not registered.' });
    const u = new URL(b.redirect_uri);
    if (b.state) u.searchParams.set('state', String(b.state).slice(0, 500));
    if (b.deny) { u.searchParams.set('error', 'access_denied'); return res.json({ redirect: u.toString() }); }
    if (typeof b.code_challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(b.code_challenge)) return res.status(400).json({ error: 'Bad request.' });
    const code = b64(crypto.randomBytes(32));
    await prisma.oauthCode.create({
      data: {
        codeHash: hashToken(code), clientId: client.id, userId: req.user!.id, redirectUri: b.redirect_uri,
        codeChallenge: b.code_challenge, scope: b.scope === 'read' ? 'read' : 'write', expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000),
      },
    });
    u.searchParams.set('code', code);
    res.json({ redirect: u.toString() });
  } catch (e) { next(e); }
});

// ---------- the MCP endpoint itself ----------
export const mcpRoutes = Router();
mcpRoutes.all('/', async (req, res) => {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const user = token.startsWith(TOKEN_PREFIX) ? await verifyToken(token) : null;
  if (!user) {
    res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${origin(req)}/.well-known/oauth-protected-resource"`);
    return res.status(401).json({ error: 'unauthorized', error_description: 'Connect Peblo first.' });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Use POST.' }, id: null });
  }
  // stateless: a fresh server per request. Tools call this same server over the loopback with the caller's own token.
  const row = await prisma.apiToken.findFirst({ where: { tokenHash: hashToken(token) }, select: { name: true } }).catch(() => null);
  const app = (row?.name || 'An app').replace(/^Connected:\s*/i, '');
  const log = (tool: string, summary: string, ok: boolean) => {
    prisma.$executeRaw`INSERT INTO mcp_activity (user_id, app, tool, summary, ok) VALUES (${user.id}, ${app}, ${tool}, ${summary.slice(0, 160)}, ${ok})`
      .then(() => prisma.$executeRaw`DELETE FROM mcp_activity WHERE user_id = ${user.id} AND at < now() - interval '60 days'`).catch(() => {});
  };
  const server = createPebloMcp(`http://127.0.0.1:${req.socket.localPort}`, token, log);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
  }
});
