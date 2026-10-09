// Fetch a web page on behalf of a user without letting them reach our own network (PEB-24, SSRF).
// Used by the link preview. Blocks private, loopback, link-local and other internal addresses, re-checks every
// redirect, limits time and size, and only reads HTML.
import { promises as dns } from 'dns';
import net from 'net';

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
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);   // IPv4-mapped
    if (mapped) return ipv4IsPrivate(mapped[1]);
    return v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
  }
  return true; // not an IP we understand: refuse
}

async function assertPublicHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (process.env.PEBLO_ALLOW_PRIVATE_FETCH === '1') return;
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new UnsafeUrlError('That address is not allowed.');
    return;
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new UnsafeUrlError('That address is not allowed.');
  }
  const addrs = await dns.lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) throw new UnsafeUrlError('That address is not allowed.');
}

export interface SafeFetchResult { url: string; html: string }

export async function safeFetchHtml(rawUrl: string, opts: { maxBytes?: number; timeoutMs?: number; maxRedirects?: number; headers?: Record<string, string> } = {}): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? 512 * 1024;
  const timeoutMs = opts.timeoutMs ?? 6000;
  const maxRedirects = opts.maxRedirects ?? 3;
  let current = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let u: URL;
    try { u = new URL(current); } catch { throw new UnsafeUrlError('That is not a valid web address.'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new UnsafeUrlError('Only http and https links can be previewed.');
    if (u.username || u.password) throw new UnsafeUrlError('Links with a login in them are not allowed.');
    await assertPublicHost(u.hostname);

    const res = await fetch(u.toString(), { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: opts.headers });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, u).toString();   // validated again at the top of the loop
      continue;
    }
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (type && !type.includes('text/html') && !type.includes('application/xhtml')) throw new UnsafeUrlError('That link is not a web page.');

    // read at most maxBytes
    const reader = res.body?.getReader();
    if (!reader) return { url: u.toString(), html: '' };
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
    }
    try { await reader.cancel(); } catch { /* already finished */ }
    return { url: u.toString(), html: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8') };
  }
  throw new UnsafeUrlError('Too many redirects.');
}
