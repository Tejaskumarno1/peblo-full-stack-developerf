import { accessFor } from './shareAccess.js';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'http';
import type { Duplex } from 'stream';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import prisma from '../db.js';
import { aadOf, decryptBytes, decryptText, encryptBytes, encryptText, DataCryptoError } from '../dataCrypto.js';
import { consumeTicket } from './accountSafety.js';

/*
 * Live co-editing. Every open note is a "room": one Yjs document on the server that all the people editing it talk to
 * over a WebSocket (/collab). Yjs merges what each person types, so nobody's words are lost and nobody sees a conflict.
 *
 * Who may join: the owner (their sign-in token) or anyone holding a share link that allows editing (a view-only link
 * joins read-only: they receive changes, their changes are ignored). Access is re-checked every few seconds, so
 * turning a link off or removing a person drops them from the room.
 *
 * What is stored: the note's Markdown text stays the source of truth for search, export, the API and the AI tools.
 * An editor tells the server the fingerprint of every Markdown text it saves ("md" message). If the note's text changes
 * and the fingerprint was not announced by an editor, someone changed it another way: the room is reset from the new text.
 * The merged document itself is kept in note_ydocs (so a restart loses nothing).
 */

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const MSG_QUERY_AWARENESS = 3;
const MSG_SEED = 10; // server -> client: "you may fill this empty document from this text"
const MSG_MD = 11; //   client -> server: "I saved the Markdown text with this fingerprint"

export const CLOSE_RESET = 4002; // the note was changed another way: reload it
export const CLOSE_GONE = 4003; // note deleted or no longer yours / shared
export const CLOSE_DENIED = 4401;

const DEBUG = !!process.env.COLLAB_DEBUG;
const MAX_PAYLOAD = 24 * 1024 * 1024;
const MAX_CONNS_PER_ROOM = 40;
const PERSIST_DELAY_MS = 1500;
const TICK_MS = 4000;
const validShare = /^[A-Za-z0-9_-]{20,40}$/;
const validSession = /^[A-Za-z0-9_-]{16,80}$/;

/** A short fingerprint of a text (cyrb53 + length). The browser uses the same function. */
export function fingerprint(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}.${text.length.toString(36)}`;
}

type Conn = {
  ws: WebSocket;
  readOnly: boolean;
  userId: string | null;
  share: string | null;
  session: string | null;
  awarenessIds: Set<number>;
  alive: boolean;
};

class Room {
  doc = new Y.Doc();
  awareness = new awarenessProtocol.Awareness(this.doc);
  conns = new Map<WebSocket, Conn>();
  known = new Set<string>();
  mdHash = '';
  seedHolder: WebSocket | null = null;
  ready: Promise<void>;
  persistTimer: NodeJS.Timeout | null = null;
  tickTimer: NodeJS.Timeout;
  dirty = false;
  closed = false;
  suspect: string | null = null;

  constructor(public id: string) {
    this.awareness.setLocalState(null);
    this.ready = this.load();
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.writeUpdate(enc, update);
      this.broadcast(encoding.toUint8Array(enc), origin as WebSocket | null);
      this.dirty = true;
      this.schedulePersist();
    });
    this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const from = origin as WebSocket | null;
      const conn = from ? this.conns.get(from) : undefined;
      if (conn) {
        added.forEach((c) => conn.awarenessIds.add(c));
        removed.forEach((c) => conn.awarenessIds.delete(c));
      }
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_AWARENESS);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...added, ...updated, ...removed]));
      this.broadcast(encoding.toUint8Array(enc), null);
    });
    this.tickTimer = setInterval(() => { void this.tick(); }, TICK_MS);
    this.tickTimer.unref?.();
  }

  private async load() {
    const note = await prisma.note.findUnique({ where: { id: this.id }, select: { content: true } });
    this.mdHash = fingerprint(note?.content ?? '');
    this.known.add(this.mdHash);
    const rows = await prisma.$queryRawUnsafe<{ state: Uint8Array; md_hash: string | null }[]>('SELECT state, md_hash FROM note_ydocs WHERE note_id = $1', this.id);
    const row = rows[0];
    if (!row) return;
    // Stored encrypted. A missing or wrong key must not delete anything: let the error reach the caller (the room does not open).
    // A value that is merely damaged is a cache that can be rebuilt from the note text, like any other stale state.
    let savedHash: string | null = null; let bytes: Uint8Array | null = null;
    try {
      savedHash = row.md_hash == null ? null : decryptText(row.md_hash, aadOf('note_ydocs', 'md_hash', this.id));
      bytes = decryptBytes(row.state, aadOf('note_ydocs', 'state', this.id));
    } catch (e) {
      if (!(e instanceof DataCryptoError) || e.code !== 'BAD_VALUE') throw e;
    }
    if (bytes && savedHash === this.mdHash) {
      try { Y.applyUpdate(this.doc, new Uint8Array(bytes)); } catch { await this.forget(); }
    } else {
      await this.forget(); // the text was changed another way since this state was saved
    }
  }

  private async forget() {
    await prisma.$executeRawUnsafe('DELETE FROM note_ydocs WHERE note_id = $1', this.id).catch(() => {});
  }

  broadcast(buf: Uint8Array, except: WebSocket | null) {
    for (const c of this.conns.values()) if (c.ws !== except) send(c.ws, buf);
  }

  schedulePersist() {
    if (this.persistTimer || this.closed) return;
    this.persistTimer = setTimeout(() => { this.persistTimer = null; void this.persist(); }, PERSIST_DELAY_MS);
  }

  async persist() {
    if (!this.dirty) return;
    this.dirty = false;
    const state = Buffer.from(Y.encodeStateAsUpdate(this.doc));
    try {
      // the document holds the whole note text: it is stored encrypted like the note itself
      await prisma.$executeRawUnsafe(
        'INSERT INTO note_ydocs (note_id, state, md_hash, updated_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (note_id) DO UPDATE SET state = EXCLUDED.state, md_hash = EXCLUDED.md_hash, updated_at = NOW()',
        this.id, encryptBytes(state, aadOf('note_ydocs', 'state', this.id)), encryptText(this.mdHash, aadOf('note_ydocs', 'md_hash', this.id)),
      );
    } catch (e) {
      this.dirty = true;
      console.error('[collab] could not save a document:', (e as Error).message);
    }
  }

  /** The editor says it saved the Markdown text with this fingerprint. */
  announce(hash: string) {
    if (hash.length > 40) return;
    if (DEBUG) console.log('[collab] announce', this.id.slice(0, 6), hash);
    this.known.add(hash);
    if (this.known.size > 200) this.known.delete(this.known.values().next().value as string);
    this.mdHash = hash;
    this.dirty = true;
    this.schedulePersist();
  }

  isSeeded() { return this.doc.getMap('meta').get('seeded') === true; }

  /** Offer the first writer an empty document to fill. Only one person at a time, and never twice. */
  async offerSeed() {
    if (this.isSeeded() || this.seedHolder) return;
    const next = [...this.conns.values()].find((c) => !c.readOnly && c.ws.readyState === WebSocket.OPEN);
    if (!next) return;
    this.seedHolder = next.ws;
    let note: { content: string } | null;
    try {
      note = await prisma.note.findUnique({ where: { id: this.id }, select: { content: true } });
    } catch (e) {
      this.seedHolder = null; // a database hiccup must not crash the server or block seeding for good
      console.error('[collab] could not offer the saved text:', (e as Error).message);
      return;
    }
    if (!note || this.closed) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SEED);
    encoding.writeVarString(enc, note.content);
    send(next.ws, encoding.toUint8Array(enc));
  }

  async add(conn: Conn) {
    const ws = conn.ws;
    // The browser speaks the moment the socket opens, before the room has loaded: keep what it says until the room is ready.
    const early: Uint8Array[] = [];
    let earlyBytes = 0;
    let open = false;
    ws.on('message', (data: Buffer) => {
      const msg = new Uint8Array(data);
      if (!open) {
        // the room is still loading: do not let a client queue up an unlimited amount in the meantime
        earlyBytes += msg.length;
        if (earlyBytes > MAX_PAYLOAD) { try { ws.close(1009, 'too big'); } catch { /* gone */ } return; }
        early.push(msg);
        return;
      }
      try { this.onMessage(conn, msg); } catch (e) { console.error('[collab] bad message:', (e as Error).message); }
    });
    ws.on('close', () => this.remove(conn));
    ws.on('error', () => { try { ws.close(); } catch { /* gone */ } });
    try {
      await this.ready;
    } catch (e) {
      // the note could not be loaded (database trouble): drop this person and the broken room instead of crashing or leaving it stuck
      console.error('[collab] could not open a room:', (e as Error).message);
      try { ws.close(1011, 'unavailable'); } catch { /* gone */ }
      this.dispose();
      return;
    }
    if (this.closed) { ws.close(CLOSE_RESET, 'reset'); return; }
    // they left while the room was loading: do not keep a dead connection in the room (it would never be removed)
    if (ws.readyState !== WebSocket.OPEN) { if (!this.conns.size) void this.idleClose(); return; }
    this.conns.set(ws, conn);
    ws.on('pong', () => { conn.alive = true; });
    // say hello the way y-websocket does: our state vector, then everyone's cursors
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc, this.doc);
    send(ws, encoding.toUint8Array(enc));
    const states = this.awareness.getStates();
    if (states.size) {
      const a = encoding.createEncoder();
      encoding.writeVarUint(a, MSG_AWARENESS);
      encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]));
      send(ws, encoding.toUint8Array(a));
    }
    open = true;
    for (const msg of early) { try { this.onMessage(conn, msg); } catch (e) { console.error('[collab] bad message:', (e as Error).message); } }
    void this.offerSeed();
  }

  onMessage(conn: Conn, msg: Uint8Array) {
    const dec = decoding.createDecoder(msg);
    const type = decoding.readVarUint(dec);
    if (type === MSG_SYNC) {
      const sub = decoding.peekVarUint(dec);
      if (conn.readOnly && sub !== syncProtocol.messageYjsSyncStep1) return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      syncProtocol.readSyncMessage(dec, enc, this.doc, conn.ws);
      if (encoding.length(enc) > 1) send(conn.ws, encoding.toUint8Array(enc));
    } else if (type === MSG_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(dec), conn.ws);
    } else if (type === MSG_QUERY_AWARENESS) {
      const states = this.awareness.getStates();
      if (!states.size) return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_AWARENESS);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]));
      send(conn.ws, encoding.toUint8Array(enc));
    } else if (type === MSG_MD) {
      if (!conn.readOnly) this.announce(decoding.readVarString(dec));
    }
  }

  remove(conn: Conn) {
    if (!this.conns.delete(conn.ws)) return;
    awarenessProtocol.removeAwarenessStates(this.awareness, [...conn.awarenessIds], null);
    if (this.seedHolder === conn.ws) { this.seedHolder = null; void this.offerSeed(); }
    if (!this.conns.size) void this.idleClose();
  }

  /** Everyone left: save, and free the memory a little later (a quick return reuses the room). */
  async idleClose() {
    await this.persist();
    setTimeout(() => { if (!this.conns.size) this.dispose(); }, 30_000).unref?.();
  }

  dispose() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.tickTimer);
    if (this.persistTimer) clearTimeout(this.persistTimer);
    void this.persist();
    rooms.delete(this.id);
    this.awareness.destroy();
    this.doc.destroy();
  }

  closeAll(code: number, reason: string) {
    for (const c of [...this.conns.values()]) { try { c.ws.close(code, reason); } catch { /* gone */ } }
  }

  /** Every few seconds: is the saved text still the one the editors announced, and may everyone here still be here? */
  async tick() {
    if (this.closed || !this.conns.size) return;
    for (const c of this.conns.values()) {
      if (!c.alive) { try { c.ws.terminate(); } catch { /* gone */ } continue; }
      c.alive = false;
      try { c.ws.ping(); } catch { /* gone */ }
    }
    try {
      const note = await prisma.note.findUnique({ where: { id: this.id }, select: { content: true, isDeleted: true, userId: true, shareToken: true, shareEdit: true, shareExpiresAt: true } });
      if (!note || note.isDeleted) { this.closeAll(CLOSE_GONE, 'gone'); await this.forget(); this.dispose(); return; }
      const live = !note.shareExpiresAt || note.shareExpiresAt.getTime() > Date.now();
      const blocked = new Set((await prisma.$queryRawUnsafe<{ session_id: string }[]>('SELECT session_id FROM share_blocked WHERE kind = \'note\' AND share_token = $1', note.shareToken ?? '')).map((r) => r.session_id));
      for (const c of [...this.conns.values()]) {
        if (c.userId === note.userId) continue; // the owner
        const okShare = !!note.shareToken && c.share === note.shareToken && live && !(c.session && blocked.has(c.session));
        if (!okShare) { c.ws.close(CLOSE_GONE, 'access ended'); continue; }
        const acc = await accessFor('note', note.shareToken ?? '', c.session, !!note.shareEdit);
        if (!acc.allowed || (!c.readOnly && !acc.canEdit)) { c.ws.close(CLOSE_GONE, 'access ended'); }
      }
      const h = fingerprint(note.content);
      if (DEBUG) console.log('[collab] tick', this.id.slice(0, 6), 'db', h, 'room', this.mdHash, 'known', this.known.has(h), 'conns', this.conns.size);
      if (h === this.mdHash || this.known.has(h)) { this.suspect = null; if (h !== this.mdHash && this.known.has(h)) this.mdHash = h; return; }
      // The text is not one an editor announced. Wait for one more look (an editor announces just before it saves).
      if (this.suspect !== h) { this.suspect = h; return; }
      await this.forget();
      this.closeAll(CLOSE_RESET, 'reset');
      this.dispose();
    } catch (e) {
      console.error('[collab] check failed:', (e as Error).message);
    }
  }
}

const rooms = new Map<string, Room>();
function roomFor(id: string): Room {
  let r = rooms.get(id);
  if (!r) { r = new Room(id); rooms.set(id, r); }
  return r;
}

/** Notes that have a room open right now. */
export function liveRoomIds(): string[] { return [...rooms.keys()]; }

/** Who from outside (people on a share link) is in each of these notes right now. The owner's own tabs do not count. */
export function presenceOf(noteIds: string[]): Record<string, { name: string; color: string }[]> {
  const out: Record<string, { name: string; color: string }[]> = {};
  for (const id of noteIds) {
    const r = rooms.get(id);
    if (!r) continue;
    const states = r.awareness.getStates();
    const list: { name: string; color: string }[] = [];
    for (const c of r.conns.values()) {
      if (c.userId || c.ws.readyState !== WebSocket.OPEN) continue;
      for (const cid of c.awarenessIds) {
        const u = (states.get(cid) as { user?: { name?: string; color?: string } } | undefined)?.user;
        if (u) list.push({ name: String(u.name || 'Someone').slice(0, 40), color: String(u.color || '#888888').slice(0, 20) });
      }
    }
    if (list.length) out[id] = list;
  }
  return out;
}

function send(ws: WebSocket, buf: Uint8Array) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(buf, (err) => { if (err) { try { ws.close(); } catch { /* gone */ } } });
}

/** Who is knocking, and which note do they want? null = not allowed. */
async function authorize(url: URL): Promise<{ noteId: string; readOnly: boolean; userId: string | null; share: string | null; session: string | null } | null> {
  const share = url.searchParams.get('share');
  const session = url.searchParams.get('sid');
  const ticket = url.searchParams.get('ticket');
  const noteParam = url.searchParams.get('note');
  if (share) {
    if (!validShare.test(share)) return null;
    const note = await prisma.note.findFirst({ where: { shareToken: share, isDeleted: false, OR: [{ shareExpiresAt: null }, { shareExpiresAt: { gt: new Date() } }] }, select: { id: true, shareEdit: true } });
    if (!note) return null;
    let canEdit = !!note.shareEdit;
    if (session) {
      if (!validSession.test(session)) return null;
      const blocked = await prisma.$queryRawUnsafe<{ n: number }[]>('SELECT 1 AS n FROM share_blocked WHERE kind = \'note\' AND share_token = $1 AND session_id = $2', share, session);
      if (blocked.length) return null;
    }
    const acc = await accessFor('note', share, session, !!note.shareEdit);
    if (!acc.allowed) return null;
    canEdit = acc.canEdit;
    // a signed-in owner opening their own link still counts as the owner
    return { noteId: note.id, readOnly: !canEdit, userId: null, share, session };
  }
  // The owner proves who they are with a single-use ticket (POST /api/collab/ticket), never with the sign-in token in the address.
  if (!ticket || !noteParam || !/^[A-Za-z0-9-]{8,64}$/.test(noteParam)) return null;
  const userId = consumeTicket(ticket, noteParam);
  if (!userId) return null;
  const note = await prisma.note.findFirst({ where: { id: noteParam, userId, isDeleted: false }, select: { id: true } });
  if (!note) return null;
  return { noteId: note.id, readOnly: false, userId, share: null, session: null };
}

/**
 * The note's text was changed some way other than a live editor (an older window, the API, an AI tool, a restored version).
 * The room is dropped now and everyone in it reloads the new text, instead of waiting for the periodic check.
 */
export function invalidateNote(noteId: string, newContent?: string) {
  const r = rooms.get(noteId);
  if (!r) return;
  // A save of a text this room itself produced (an editor announced it) changes nothing under the room.
  if (typeof newContent === 'string') {
    const h = fingerprint(newContent);
    if (h === r.mdHash || r.known.has(h)) { r.mdHash = h; return; }
  }
  void (async () => {
    await r.ready.catch(() => {});
    await prisma.$executeRawUnsafe('DELETE FROM note_ydocs WHERE note_id = $1', noteId).catch(() => {});
    r.closeAll(CLOSE_RESET, 'reset');
    r.dispose();
  })();
}

let wss: WebSocketServer | null = null;

// Upgrade attempts per client address. Each attempt can cost DB queries (authorize), and /collab upgrades skip the Express API limiter.
const UPGRADE_WINDOW_MS = 60_000;
const UPGRADE_MAX_PER_WINDOW = 60;
const upgradeHits = new Map<string, number[]>();
const upgradeSweep = setInterval(() => {
  const cutoff = Date.now() - UPGRADE_WINDOW_MS;
  for (const [ip, times] of upgradeHits) {
    const fresh = times.filter((t) => t > cutoff);
    if (fresh.length) upgradeHits.set(ip, fresh); else upgradeHits.delete(ip);
  }
}, UPGRADE_WINDOW_MS);
upgradeSweep.unref();

/** True when this address is over its upgrade budget; otherwise counts the attempt. */
function upgradeLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (upgradeHits.get(ip) || []).filter((t) => t > now - UPGRADE_WINDOW_MS);
  if (recent.length >= UPGRADE_MAX_PER_WINDOW) { upgradeHits.set(ip, recent); return true; }
  recent.push(now);
  upgradeHits.set(ip, recent);
  return false;
}

/** Client address of a raw upgrade request, honouring the app's `trust proxy` setting the way req.ip does. */
export function clientIpFor(req: IncomingMessage, trust?: (addr: string, i: number) => boolean): string {
  const remote = req.socket?.remoteAddress || 'unknown';
  if (!trust) return remote;
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((a) => a.trim()).filter(Boolean).reverse();
  const chain = [remote, ...xff];
  let i = 0;
  while (i < chain.length - 1 && trust(chain[i], i)) i++;
  return chain[i];
}

/** Hooks the /collab WebSocket into the HTTP server. */
export function attachCollab(httpServer: Server, opts: { trustProxy?: (addr: string, i: number) => boolean } = {}) {
  wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let url: URL;
    try { url = new URL(req.url || '', 'http://x'); } catch { socket.destroy(); return; }
    if (url.pathname !== '/collab') {
      // Socket.IO (created with destroyUpgrade:false) handles /socket.io itself. Nothing else in this server listens for
      // upgrades (the Vite dev server is a separate process that proxies), so any other path would hang open: close it.
      if (!url.pathname.startsWith('/socket.io')) { socket.on('error', () => {}); socket.destroy(); }
      return;
    }
    if (upgradeLimited(clientIpFor(req, opts.trustProxy))) {
      socket.on('error', () => {});
      try { socket.write('HTTP/1.1 429 Too Many Requests\r\nRetry-After: 60\r\nConnection: close\r\n\r\n'); } catch { /* gone */ }
      socket.destroy();
      return;
    }
    // Node stops listening for socket errors once it hands the socket over; a reset while we check the sign-in would crash the server.
    socket.on('error', () => { try { socket.destroy(); } catch { /* gone */ } });
    void (async () => {
      try {
        const who = await authorize(url);
        if (!who) { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
        const room = roomFor(who.noteId);
        if (room.conns.size >= MAX_CONNS_PER_ROOM) { socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
        wss!.handleUpgrade(req, socket, head, (ws) => {
          void room.add({ ws, readOnly: who.readOnly, userId: who.userId, share: who.share, session: who.session, awarenessIds: new Set(), alive: true });
        });
      } catch (e) {
        console.error('[collab] upgrade failed:', (e as Error).message);
        try { socket.destroy(); } catch { /* gone */ }
      }
    })();
  });
}

/** For tests and shutdown. */
export async function closeCollab() {
  for (const r of [...rooms.values()]) { await r.persist(); r.closeAll(1001, 'bye'); r.dispose(); }
  wss?.close();
}
