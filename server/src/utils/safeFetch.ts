// Fetch a web page on behalf of a user without letting them reach our own network (PEB-24, SSRF).
// Used by the link preview. Blocks private, loopback, link-local and other internal addresses, re-checks every
// redirect, limits time and size, and only reads HTML.
import { promises as dns, type LookupAddress } from 'dns';
import net from 'net';
import http from 'http';
import https from 'https';
import { Readable } from 'stream';

export class UnsafeUrlError extends Error {
  constructor(message: string) { super(message); this.name = 'UnsafeUrlError'; }
}

function ipv4IsPrivate(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||   // carrier-grade NAT
    (a === 169 && b === 254) ||             // link-local, cloud metadata (169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224                                 // multicast and reserved
  );
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return ipv4IsPrivate(ip);
  if (net.isIPv6(ip)) {
    let v = ip.toLowerCase();
    // new URL() writes an IPv4-mapped address in hex ("[::ffff:7f00:1]" for 127.0.0.1), so URL hostnames never match the dotted form.
    // Normalise first, so both spellings are judged by their IPv4 part.
    try { v = new URL(`http://[${v}]/`).hostname.replace(/^\[|\]$/g, ''); } catch { return true; }
    if (v === '::' || v === '::1') return true;
    const dotted = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);   // IPv4-mapped, dotted
    if (dotted) return ipv4IsPrivate(dotted[1]);
    const hex = v.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);   // IPv4-mapped, hex
    if (hex) { const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16); return ipv4IsPrivate(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`); }
    if (v.startsWith('64:ff9b:') || v.startsWith('2002:')) return true;   // NAT64 and 6to4 can carry any IPv4 address inside
    return v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('fec') || v.startsWith('fed') || v.startsWith('fee') || v.startsWith('fef') || v.startsWith('ff');
  }
  return true; // not an IP we understand: refuse
}

/**
 * Resolves a host once and checks every address. Returns the validated addresses, which the caller must connect to
 * (see pinnedLookup) so a second DNS answer cannot swap in an internal address (DNS rebinding).
 * Returns null only when private fetches are explicitly allowed (PEBLO_ALLOW_PRIVATE_FETCH=1): then nothing is pinned.
 */
export async function resolvePublicHost(hostname: string): Promise<LookupAddress[] | null> {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (process.env.PEBLO_ALLOW_PRIVATE_FETCH === '1') return null;
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new UnsafeUrlError('That address is not allowed.');
    return [{ address: host, family: net.isIPv4(host) ? 4 : 6 }];
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new UnsafeUrlError('That address is not allowed.');
  }
  const addrs = await dns.lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) throw new UnsafeUrlError('That address is not allowed.');
  return addrs;
}

export async function assertPublicHost(hostname: string) {
  await resolvePublicHost(hostname);
}

/** A net/http "lookup" that only ever answers with the already validated addresses. The URL's host name is untouched, so Host and TLS SNI stay the original name. */
function pinnedLookup(addrs: LookupAddress[]): net.LookupFunction {
  return (_hostname, options, callback) => {
    const f: unknown = options && (options as { family?: unknown }).family;
    const want = f === 4 || f === 'IPv4' ? 4 : f === 6 || f === 'IPv6' ? 6 : 0;
    const list = want ? addrs.filter((a) => a.family === want) : addrs;
    if (list.length === 0) {
      const err: NodeJS.ErrnoException = new Error('No usable address.'); err.code = 'ENOTFOUND';
      callback(err, '', 0);
      return;
    }
    if (options && (options as { all?: boolean }).all) callback(null, list.map((a) => ({ address: a.address, family: a.family })) as never);
    else callback(null, list[0].address, list[0].family);
  };
}

/** One request, no redirects, connecting only to the validated addresses. Returns a standard Response. */
function pinnedRequest(u: URL, method: string, headers: Headers, body: Buffer | undefined, signal: AbortSignal | null | undefined, addrs: LookupAddress[]): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const h: Record<string, string> = {};
    headers.forEach((v, k) => { h[k] = v; });
    if (!h['accept-encoding']) h['accept-encoding'] = 'identity';   // no automatic decompression on this path
    if (body && !h['content-length']) h['content-length'] = String(body.length);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method, headers: h, lookup: pinnedLookup(addrs), signal: signal ?? undefined }, (res) => {
      const out = new Headers();
      for (const [k, v] of Object.entries(res.headers)) {
        if (Array.isArray(v)) v.forEach((x) => out.append(k, x)); else if (v !== undefined) out.set(k, v);
      }
      const status = res.statusCode ?? 502;
      const init = { status, statusText: res.statusMessage || '', headers: out };
      if (method === 'HEAD' || status === 101 || status === 204 || status === 205 || status === 304) { res.resume(); resolve(new Response(null, init)); return; }
      resolve(new Response(Readable.toWeb(res) as unknown as ReadableStream, init));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

async function dropBody(res: Response) { try { await res.body?.cancel(); } catch { /* already closed */ } }

function toBody(b: unknown): Buffer | undefined {
  if (b === undefined || b === null) return undefined;
  if (typeof b === 'string') return Buffer.from(b);
  if (b instanceof URLSearchParams) return Buffer.from(b.toString());
  if (b instanceof ArrayBuffer) return Buffer.from(b);
  if (ArrayBuffer.isView(b)) return Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  throw new UnsafeUrlError('This kind of request body is not supported.');
}

/**
 * fetch() for addresses a person controls. Every hop (the first request and each redirect, up to maxRedirects) is validated,
 * then connected to by the validated IP, so DNS cannot change between the check and the connection (rebinding).
 * Redirect response bodies are cancelled. maxRedirects: 0 returns a redirect response as is instead of following it.
 * Also returns the final URL, which a Response made by hand cannot carry.
 */
export async function safeFetchFollow(rawUrl: string | URL, init: RequestInit = {}, opts: { maxRedirects?: number } = {}): Promise<{ response: Response; url: string }> {
  const maxRedirects = opts.maxRedirects ?? 3;
  let method = (init.method || 'GET').toUpperCase();
  let body = toBody(init.body);
  const headers = new Headers(init.headers);
  let u: URL;
  try { u = new URL(String(rawUrl)); } catch { throw new UnsafeUrlError('That is not a valid web address.'); }

  for (let hop = 0; ; hop++) {
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new UnsafeUrlError('Only http and https links can be used.');
    if (u.username || u.password) throw new UnsafeUrlError('Links with a login in them are not allowed.');
    const addrs = await resolvePublicHost(u.hostname);
    const res = addrs
      ? await pinnedRequest(u, method, headers, body, init.signal, addrs)
      : await fetch(u, { method, headers, body: body as unknown as BodyInit | undefined, signal: init.signal, redirect: 'manual' });

    const loc = res.headers.get('location');
    if (!REDIRECTS.has(res.status) || !loc) return { response: res, url: u.toString() };
    if (maxRedirects === 0) return { response: res, url: u.toString() };
    await dropBody(res);
    if (hop >= maxRedirects) throw new UnsafeUrlError('Too many redirects.');
    let next: URL;
    try { next = new URL(loc, u); } catch { throw new UnsafeUrlError('That link redirects to a bad address.'); }
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
      if (method !== 'HEAD') method = 'GET';
      body = undefined;
      headers.delete('content-type'); headers.delete('content-length');
    }
    if (next.origin !== u.origin) { headers.delete('authorization'); headers.delete('x-api-key'); headers.delete('cookie'); }
    u = next;   // validated again at the top of the loop
  }
}

/** Drop-in fetch (e.g. for the OpenAI client's `fetch` option) with the checks of safeFetchFollow. */
export const safeFetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  if (typeof input === 'object' && 'url' in input) {
    return (await safeFetchFollow(input.url, { method: input.method, headers: input.headers, ...init })).response;
  }
  return (await safeFetchFollow(input, init)).response;
}) as typeof fetch;

export interface SafeFetchResult { url: string; html: string }

export async function safeFetchHtml(rawUrl: string, opts: { maxBytes?: number; timeoutMs?: number; maxRedirects?: number; headers?: Record<string, string> } = {}): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? 512 * 1024;
  const timeoutMs = opts.timeoutMs ?? 6000;
  const { response: res, url } = await safeFetchFollow(rawUrl, { signal: AbortSignal.timeout(timeoutMs), headers: opts.headers }, { maxRedirects: opts.maxRedirects ?? 3 });
  if (REDIRECTS.has(res.status)) { await dropBody(res); throw new UnsafeUrlError('Too many redirects.'); }
  const type = (res.headers.get('content-type') || '').toLowerCase();
  if (type && !type.includes('text/html') && !type.includes('application/xhtml')) { await dropBody(res); throw new UnsafeUrlError('That link is not a web page.'); }

  // read at most maxBytes
  const reader = res.body?.getReader();
  if (!reader) return { url, html: '' };
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }
  try { await reader.cancel(); } catch { /* already finished */ }
  return { url, html: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8') };
}
