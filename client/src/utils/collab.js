import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { WebsocketProvider } from 'y-websocket';
import api from '../api/client';

/*
 * Live co-editing: one Yjs document per open note, kept in step with the server over a WebSocket (/collab).
 * Everyone's typing merges automatically, so there is no "keep both" prompt. The note's Markdown text is still saved
 * the usual way as a safety copy; the server is told the fingerprint of each saved text so it can tell our saves
 * from changes made some other way.
 */

const MSG_SEED = 10;
const MSG_MD = 11;
export const CLOSE_RESET = 4002;
export const CLOSE_GONE = 4003;

/** Same function as the server's: a short fingerprint of a text. */
export function fingerprint(text) {
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

const COLORS = ['#e11d48', '#2563eb', '#059669', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];
export function colorFor(key) {
  let h = 0;
  for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

/** The WebSocket address of this app's own server. */
function serverUrl() {
  const base = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/\/api\/?$/, '') : window.location.origin;
  return base.replace(/^http/, 'ws');
}

/**
 * The sign-in token must not travel in the WebSocket address (addresses end up in logs and history). Each connection first asks
 * the server for a 30-second, single-use ticket for this note and puts only that in the address. y-websocket builds a new
 * WebSocket for every (re)connect, so this stand-in does the asking each time and then behaves like the real socket.
 */
function ticketSocketFor(noteId) {
  return class TicketSocket {
    // y-websocket compares readyState with ws.OPEN etc. on the instance, as the browser's own WebSocket allows
    get CONNECTING() { return 0; }
    get OPEN() { return 1; }
    get CLOSING() { return 2; }
    get CLOSED() { return 3; }
    constructor(url) {
      this.url = url;
      this.binaryType = 'arraybuffer';
      this.onopen = this.onmessage = this.onclose = this.onerror = null;
      this._ws = null;
      this._closed = false;
      this._state = 0;
      api.post('/collab/ticket', { noteId }).then((r) => {
        if (this._closed) return;
        const ws = new WebSocket(`${url}${url.includes('?') ? '&' : '?'}ticket=${encodeURIComponent(r.data.ticket)}`);
        ws.binaryType = this.binaryType;
        ws.onopen = (e) => this.onopen?.(e);
        ws.onmessage = (e) => this.onmessage?.(e);
        ws.onerror = (e) => this.onerror?.(e);
        ws.onclose = (e) => { this._state = 3; this.onclose?.(e); };
        this._ws = ws;
      }).catch(() => {
        if (this._closed) return;
        this._state = 3;
        this.onerror?.(new Event('error'));
        this.onclose?.({ code: 1006, reason: 'ticket' });
      });
    }
    get readyState() { return this._ws ? this._ws.readyState : this._state; }
    get bufferedAmount() { return this._ws ? this._ws.bufferedAmount : 0; }
    send(data) { if (this._ws) this._ws.send(data); }
    close(code, reason) {
      this._closed = true;
      if (this._ws) { try { this._ws.close(code, reason); } catch { /* gone */ } }
      else { this._state = 3; setTimeout(() => this.onclose?.({ code: 1000, reason: '' }), 0); } // y-websocket relies on the close event to reset itself
    }
  };
}

/**
 * @param {{ noteId?: string, share?: string, sid?: string, name?: string, color?: string }} opts
 *   the owner passes noteId (their sign-in is used); a person on a share link passes share (and a session id)
 */
export function createCollab(opts) {
  const doc = new Y.Doc();
  const params = opts.share
    ? { share: opts.share, ...(opts.sid ? { sid: opts.sid } : {}) }
    : { note: opts.noteId };
  const provider = new WebsocketProvider(serverUrl(), 'collab', doc, { connect: false, params, disableBc: true, maxBackoffTime: 8000, ...(opts.share ? {} : { WebSocketPolyfill: ticketSocketFor(opts.noteId) }) });
  // the server's offer: "this document is empty, fill it from the saved text"
  provider.messageHandlers[MSG_SEED] = (_enc, dec, p) => { p.emit('seed', [decoding.readVarString(dec)]); };
  const name = (opts.name || 'Someone').slice(0, 40);
  provider.awareness.setLocalStateField('user', { name, color: /^#[0-9a-f]{6}$/i.test(opts.color || '') ? opts.color : colorFor(opts.share ? (opts.sid || name) : opts.noteId + name) });

  let destroyTimer = null;
  return {
    doc,
    provider,
    user: { name, color: /^#[0-9a-f]{6}$/i.test(opts.color || '') ? opts.color : colorFor(opts.share ? (opts.sid || name) : opts.noteId + name) },
    connect() { clearTimeout(destroyTimer); provider.connect(); },
    /** Tell the server which Markdown text this editor is about to save. */
    announce(markdown) {
      const ws = provider.ws;
      if (!ws || ws.readyState !== 1) return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_MD);
      encoding.writeVarString(enc, fingerprint(markdown));
      ws.send(encoding.toUint8Array(enc));
    },
    /** Leave. Destroys after a moment, so React's dev double-mount does not kill a session that is still wanted. */
    release() {
      provider.disconnect();
      clearTimeout(destroyTimer);
      destroyTimer = setTimeout(() => { try { provider.destroy(); doc.destroy(); } catch { /* already gone */ } }, 1500);
    },
  };
}
