import crypto from 'crypto';

/*
 * Encryption at rest for the text people write (note bodies, versions, comments, AI results...).
 *
 *   enc:v1:<keyId>:<base64(iv | tag | ciphertext)>        text columns
 *   "PEBENC1\0" + keyId(8 ascii) + iv | tag | ciphertext   binary columns (Yjs documents)
 *
 * AES-256-GCM, a fresh random 12-byte IV every time. The AAD names table + column + row id, so a value cannot be
 * copied into another row or column (it would fail to authenticate). The key is PEBLO_DATA_KEY (base64, 32 bytes);
 * PEBLO_DATA_KEY_OLD (comma separated) lists retired keys that can still be read. keyId = first 8 hex of
 * sha256 over the key, so the right key is found from the header and the key itself is never stored or logged.
 *
 * Rules:
 *  - No PEBLO_DATA_KEY: writing stores plain text (desktop app, local development). Reading plain text always works.
 *  - Fail closed: a value that IS encrypted but cannot be read (no key, wrong key, damaged, moved) throws a
 *    DataCryptoError (statusCode 500, generic text for the client, detail in the log). Nothing is ever replaced by
 *    garbage or empty text.
 *  - "Locked": at boot (initDataCrypto) the server checks the stored data against the configured key. If data is
 *    encrypted and the key is missing or does not open it, every write of encrypted columns is refused, so a mistyped
 *    key can never mix new-key or plain values into an encrypted database.
 *  - The empty string is stored as it is (it carries nothing).
 * This key is separate from the one in secrets.ts (provider API keys).
 */
export const PREFIX = 'enc:v1:';
const MAGIC = Buffer.from('PEBENC1\0', 'latin1');
const AAD_PREFIX = 'peblo-data-v1|';
const KEY_ID_LEN = 8;

export class DataCryptoError extends Error {
  /** The error handler shows 5xx messages that are not flagged `public` as a generic text, and logs this one. */
  statusCode = 500;
  constructor(message: string, public code: 'KEY_MISSING' | 'KEY_UNKNOWN' | 'BAD_VALUE' | 'LOCKED' | 'KEY_INVALID') {
    super(message);
    this.name = 'DataCryptoError';
  }
}

type Key = { id: string; key: Buffer };
type KeyState = { primary: Key | null; all: Map<string, Key>; problem: string | null; sig: string };
let keys: KeyState | null = null;
let lockedReason: string | null = null;

const idOf = (key: Buffer) => crypto.createHash('sha256').update('peblo-data-key-id\0').update(key).digest('hex').slice(0, KEY_ID_LEN);

function parseKey(text: string): Key | null {
  const t = text.trim();
  if (!t) return null;
  const buf = Buffer.from(t.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (buf.length !== 32) return null;
  return { id: idOf(buf), key: buf };
}

/** (Re)reads PEBLO_DATA_KEY and PEBLO_DATA_KEY_OLD. Called at boot and by tests. */
export function reloadKeys(): KeyState {
  const cur = process.env.PEBLO_DATA_KEY || '';
  const old = process.env.PEBLO_DATA_KEY_OLD || '';
  const st: KeyState = { primary: null, all: new Map(), problem: null, sig: cur + '\n' + old };
  if (cur.trim()) {
    const k = parseKey(cur);
    if (!k) st.problem = 'PEBLO_DATA_KEY is set but is not a base64 string of exactly 32 bytes';
    else { st.primary = k; st.all.set(k.id, k); }
  }
  for (const part of old.split(',')) {
    if (!part.trim()) continue;
    const k = parseKey(part);
    if (!k) { st.problem = st.problem || 'PEBLO_DATA_KEY_OLD holds a value that is not a base64 string of exactly 32 bytes'; continue; }
    st.all.set(k.id, k);
  }
  keys = st;
  return st;
}
const state = (): KeyState => keys ?? reloadKeys();

/** Generates a new random key in the right format (for the owner to store). */
export const generateKey = () => crypto.randomBytes(32).toString('base64');

export const aadOf = (table: string, column: string, rowId: string) => `${table}.${column}.${rowId}`;
const aadBuf = (aad: string) => Buffer.from(AAD_PREFIX + aad, 'utf8');

export function isEnabled(): boolean { return !!state().primary; }
export function primaryKeyId(): string | null { return state().primary?.id ?? null; }
export function lockReason(): string | null { return lockedReason; }
/** Stops all writes of encrypted columns (see the header). Reads keep working. */
export function lock(reason: string) { lockedReason = reason; console.error(`[crypto] LOCKED: ${reason}. Writes of encrypted columns are refused until this is fixed.`); }
export function unlock() { lockedReason = null; }

/** True for a stored text value written by encryptText. */
export function isCiphertext(v: unknown): v is string {
  return typeof v === 'string' && v.length > PREFIX.length + KEY_ID_LEN + 1 && v.startsWith(PREFIX) && v.charCodeAt(PREFIX.length + KEY_ID_LEN) === 58 /* : */ && /^[0-9a-f]{8}$/.test(v.slice(PREFIX.length, PREFIX.length + KEY_ID_LEN));
}
export function keyIdOf(v: string): string { return v.slice(PREFIX.length, PREFIX.length + KEY_ID_LEN); }

function writable(): Key | null {
  const st = state();
  if (st.problem && !st.primary) throw new DataCryptoError(`not writing: ${st.problem}`, 'KEY_INVALID');
  if (lockedReason) throw new DataCryptoError(`not writing: ${lockedReason}`, 'LOCKED');
  return st.primary;
}

export function encryptText(plain: string, aad: string): string {
  if (plain === '' || plain == null) return plain;
  const k = writable();
  if (!k) return plain;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k.key, iv);
  c.setAAD(aadBuf(aad));
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return PREFIX + k.id + ':' + Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}

export function decryptText(stored: string, aad: string): string {
  if (!isCiphertext(stored)) return stored; // plain text from before encryption (or no encryption at all)
  const st = state();
  const id = keyIdOf(stored);
  const k = st.all.get(id);
  if (!k) {
    // Text that merely starts like a value of ours (a note about this feature) but is not base64 cannot be ours.
    if (/[^A-Za-z0-9+/=]/.test(stored.slice(PREFIX.length + KEY_ID_LEN + 1, PREFIX.length + KEY_ID_LEN + 200))) return stored;
    throw new DataCryptoError(st.primary || st.problem ? `a stored value (${aad.split('.').slice(0, 2).join('.')}) was encrypted with key ${id}, which is not configured` : `a stored value (${aad.split('.').slice(0, 2).join('.')}) is encrypted but PEBLO_DATA_KEY is not set`, st.primary || st.problem ? 'KEY_UNKNOWN' : 'KEY_MISSING');
  }
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length + KEY_ID_LEN + 1), 'base64');
    if (raw.length < 28) throw new Error('short');
    const d = crypto.createDecipheriv('aes-256-gcm', k.key, raw.subarray(0, 12));
    d.setAAD(aadBuf(aad));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch {
    if (/[^A-Za-z0-9+/=]/.test(stored.slice(PREFIX.length + KEY_ID_LEN + 1))) return stored; // not ours after all
    throw new DataCryptoError(`a stored value (${aad.split('.').slice(0, 2).join('.')}) could not be decrypted: damaged, or moved to another row or column`, 'BAD_VALUE');
  }
}

// ---- binary values (Yjs documents) ----
export function isCipherBytes(b: Uint8Array | null | undefined): boolean {
  return !!b && b.length > MAGIC.length + KEY_ID_LEN + 28 && Buffer.from(b.buffer, b.byteOffset, MAGIC.length).equals(MAGIC);
}
export function encryptBytes(plain: Uint8Array, aad: string): Buffer {
  const k = writable();
  const buf = Buffer.from(plain.buffer, plain.byteOffset, plain.byteLength);
  if (!k) return buf;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k.key, iv);
  c.setAAD(aadBuf(aad));
  const data = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, Buffer.from(k.id, 'ascii'), iv, c.getAuthTag(), data]);
}
export function decryptBytes(stored: Uint8Array, aad: string): Buffer {
  const b = Buffer.from(stored.buffer, stored.byteOffset, stored.byteLength);
  if (!isCipherBytes(b)) return b;
  const st = state();
  const id = b.subarray(MAGIC.length, MAGIC.length + KEY_ID_LEN).toString('ascii');
  const k = st.all.get(id);
  const col = aad.split('.').slice(0, 2).join('.');
  if (!k) throw new DataCryptoError(st.primary || st.problem ? `a stored value (${col}) was encrypted with key ${id}, which is not configured` : `a stored value (${col}) is encrypted but PEBLO_DATA_KEY is not set`, st.primary || st.problem ? 'KEY_UNKNOWN' : 'KEY_MISSING');
  try {
    const o = MAGIC.length + KEY_ID_LEN;
    const d = crypto.createDecipheriv('aes-256-gcm', k.key, b.subarray(o, o + 12));
    d.setAAD(aadBuf(aad));
    d.setAuthTag(b.subarray(o + 12, o + 28));
    return Buffer.concat([d.update(b.subarray(o + 28)), d.final()]);
  } catch {
    throw new DataCryptoError(`a stored value (${col}) could not be decrypted: damaged, or moved to another row or column`, 'BAD_VALUE');
  }
}
export function keyIdOfBytes(b: Uint8Array): string { return Buffer.from(b.buffer, b.byteOffset, b.byteLength).subarray(MAGIC.length, MAGIC.length + KEY_ID_LEN).toString('ascii'); }

/** Stored value that should be (re)written: plain text while a key is configured, or text under a retired key. */
export function needsEncrypting(v: string | null | undefined): boolean {
  const k = state().primary;
  if (!k || !v) return false;
  return !isCiphertext(v) || keyIdOf(v) !== k.id;
}

// ---- helpers for raw SQL paths ----
export const encField = (table: string, column: string, rowId: string, value: string | null | undefined): string | null => (value == null ? null : encryptText(value, aadOf(table, column, rowId)));
export const decField = (table: string, column: string, rowId: string, value: string | null | undefined): string | null => (value == null ? null : decryptText(value, aadOf(table, column, rowId)));

/**
 * Boot check: compares the configured keys with what is stored. Locks writes when the data is encrypted and the key is
 * missing or wrong. Also warns loudly when a hosted server runs without a key. Never throws and never logs keys or content.
 */
export async function initDataCrypto(db: { $queryRawUnsafe: (sql: string, ...v: any[]) => Promise<any> }): Promise<void> {
  const st = reloadKeys();
  lockedReason = null;
  const hosted = /^(1|true|yes)$/i.test(process.env.PEBLO_HOSTED || '');
  if (st.problem) lock(st.problem);
  try {
    const sample: { id: string; v: string; t: string }[] = [
      ...(await db.$queryRawUnsafe(`SELECT id, content AS v, 'notes' AS t FROM notes WHERE content LIKE 'enc:v1:%' LIMIT 6`)),
      ...(await db.$queryRawUnsafe(`SELECT id, content AS v, 'note_backups' AS t FROM note_backups WHERE content LIKE 'enc:v1:%' LIMIT 3`)),
    ];
    if (sample.length) {
      let ok = 0; let tried = 0;
      for (const r of sample) {
        if (!isCiphertext(r.v)) continue;
        tried++;
        try { decryptText(r.v, aadOf(r.t, 'content', r.id)); ok++; } catch { /* counted */ }
      }
      if (tried && !ok && !lockedReason) {
        lock(st.primary || st.all.size ? 'stored notes are encrypted with a key that is not configured (PEBLO_DATA_KEY / PEBLO_DATA_KEY_OLD)' : 'stored notes are encrypted but PEBLO_DATA_KEY is not set');
      }
    }
  } catch (e) {
    console.error('[crypto] could not check the stored data against the key:', (e as Error).message);
  }
  if (!st.primary && hosted && !lockedReason) console.warn('[crypto] WARNING: PEBLO_HOSTED=1 but PEBLO_DATA_KEY is not set. User notes are being stored WITHOUT encryption at rest.');
  else if (st.primary) console.log(`[crypto] encryption at rest is ON (key ${st.primary.id}${st.all.size > 1 ? `, ${st.all.size - 1} retired key(s) readable` : ''})`);
}
