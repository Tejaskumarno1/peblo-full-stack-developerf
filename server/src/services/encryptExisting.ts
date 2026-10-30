import { rawPrisma } from '../db.js';
import { aadOf, decryptBytes, decryptText, encryptBytes, encryptText, isCipherBytes, isCiphertext, isEnabled, keyIdOf, keyIdOfBytes, lockReason, primaryKeyId, reloadKeys } from '../dataCrypto.js';

/*
 * Converts text that was stored before encryption existed (and text under a retired key) to the current key.
 *   - startup: PEBLO_DATA_KEY set and PEBLO_ENCRYPT_EXISTING=1 (called from index.ts, runs in the background)
 *   - by hand: node scripts/encrypt-existing.mjs [--dry-run]
 * Safe to run any number of times and while the server is serving requests:
 *   - only rows that are not yet under the current key are touched; a run can be stopped and started again
 *   - each batch is one transaction holding a Postgres advisory lock (a second instance sees it taken and stops)
 *   - every update is conditional on the stored value still being the one that was read (a note edited meanwhile is left
 *     to the next pass), updated_at is not touched, and each new value is decrypted again and compared before the commit
 *   - it logs only counts, never any content
 */
const LOCK_ID = 7264002;
type Col = { name: string; bytes?: boolean };
type Target = { table: string; pk: string; cols: Col[] };
export const TARGETS: Target[] = [
  { table: 'notes', pk: 'id', cols: [{ name: 'content' }] },
  { table: 'note_backups', pk: 'id', cols: [{ name: 'content' }] },
  { table: 'ai_generations', pk: 'id', cols: [{ name: 'result' }] },
  { table: 'note_embeddings', pk: 'id', cols: [{ name: 'vector' }] },
  { table: 'quiz_runs', pk: 'id', cols: [{ name: 'questions' }, { name: 'answers' }] },
  { table: 'note_comments', pk: 'id', cols: [{ name: 'body' }, { name: 'quote' }, { name: 'replacement' }] },
  { table: 'user_notifications', pk: 'id', cols: [{ name: 'body' }] },
  { table: 'media', pk: 'id', cols: [{ name: 'description' }] },
  { table: 'mcp_activity', pk: 'id', cols: [{ name: 'summary' }] },
  { table: 'note_ydocs', pk: 'note_id', cols: [{ name: 'md_hash' }, { name: 'state', bytes: true }] },
];

export type TableReport = { table: string; present: boolean; needing: number; plaintext: number; converted: number; rekeyed: number; unreadable: number; raced: number };
export type Report = { dryRun: boolean; busy: boolean; tables: TableReport[]; passes: number };

const hex = (s: string) => Buffer.from(s, 'ascii').toString('hex');
const MAGIC_HEX = Buffer.from('PEBENC1\0', 'latin1').toString('hex');

/** SQL condition: this column holds something that is not yet under the current key. */
function needsCond(c: Col, keyId: string): string {
  if (c.bytes) return `(${c.name} IS NOT NULL AND length(${c.name}) > 0 AND encode(substring(${c.name} from 1 for 16), 'hex') <> '${MAGIC_HEX}${hex(keyId)}')`;
  return `(${c.name} IS NOT NULL AND ${c.name} <> '' AND ${c.name} NOT LIKE 'enc:v1:${keyId}:%')`;
}
const plainCond = (c: Col) => (c.bytes ? `(${c.name} IS NOT NULL AND length(${c.name}) > 0 AND encode(substring(${c.name} from 1 for 8), 'hex') <> '${MAGIC_HEX}')` : `(${c.name} IS NOT NULL AND ${c.name} <> '' AND ${c.name} NOT LIKE 'enc:v1:%')`);

async function exists(table: string): Promise<boolean> {
  const r: any[] = await rawPrisma.$queryRawUnsafe(`SELECT to_regclass($1) IS NOT NULL AS ok`, table);
  return !!r[0]?.ok;
}

async function pass(t: Target, keyId: string, batch: number, rep: TableReport): Promise<void> {
  let cursor: string | null = null;
  const cond = t.cols.map((c) => needsCond(c, keyId)).join(' OR ');
  const colList = t.cols.map((c) => c.name).join(', ');
  for (;;) {
    const rows: any[] = await rawPrisma.$queryRawUnsafe(`SELECT ${t.pk} AS pk, ${colList} FROM ${t.table} WHERE (${cond})${cursor ? ` AND ${t.pk} > $1` : ''} ORDER BY ${t.pk} LIMIT ${batch}`, ...(cursor ? [cursor] : []));
    if (!rows.length) return;
    cursor = rows[rows.length - 1].pk;
    // work out the new values first (no transaction open yet)
    const plan: { pk: string; sets: { col: Col; oldV: any; newV: any; plain: string | Buffer }[]; fromPlain: boolean }[] = [];
    for (const row of rows) {
      const sets: { col: Col; oldV: any; newV: any; plain: string | Buffer }[] = [];
      let fromPlain = false; let bad = false;
      for (const col of t.cols) {
        const v = row[col.name];
        if (v == null || v.length === 0) continue;
        const aad = aadOf(t.table, col.name, String(row.pk));
        try {
          if (col.bytes) {
            const b = Buffer.from(v);
            if (isCipherBytes(b) && keyIdOfBytes(b) === keyId) continue;
            const plain = decryptBytes(b, aad); // plain bytes pass through; a retired key is used to open its own values
            const newV = encryptBytes(plain, aad);
            if (!decryptBytes(newV, aad).equals(plain)) throw new Error('verify');
            sets.push({ col, oldV: b, newV, plain });
            if (!isCipherBytes(b)) fromPlain = true;
          } else {
            const s = String(v);
            if (isCiphertext(s) && keyIdOf(s) === keyId) continue;
            const plain = decryptText(s, aad);
            const newV = encryptText(plain, aad);
            if (decryptText(newV, aad) !== plain) throw new Error('verify');
            sets.push({ col, oldV: s, newV, plain });
            if (!isCiphertext(s)) fromPlain = true;
          }
        } catch { bad = true; }
      }
      if (bad) { rep.unreadable++; continue; }
      if (sets.length) plan.push({ pk: String(row.pk), sets, fromPlain });
    }
    if (!plan.length) continue;
    const outcome: 'ok' | 'busy' = await rawPrisma.$transaction(async (tx: any) => {
      const got: any[] = await tx.$queryRawUnsafe(`SELECT pg_try_advisory_xact_lock(${LOCK_ID}) AS ok`);
      if (!got[0]?.ok) return 'busy' as const;
      const done = { converted: 0, rekeyed: 0, raced: 0 };
      for (const p of plan) {
        const params: any[] = [p.pk];
        const setSql = p.sets.map((s, i) => { params.push(s.newV); return `${s.col.name} = $${i + 2}`; });
        const whereSql = p.sets.map((s, i) => { params.push(s.oldV); return `${s.col.name} = $${p.sets.length + i + 2}`; });
        const back: any[] = await tx.$queryRawUnsafe(`UPDATE ${t.table} SET ${setSql.join(', ')} WHERE ${t.pk} = $1 AND ${whereSql.join(' AND ')} RETURNING ${p.sets.map((s) => s.col.name).join(', ')}`, ...params);
        if (!back.length) { done.raced++; continue; }
        // read back what the database now holds and compare it with the original before anything is committed
        for (const s of p.sets) {
          const stored = back[0][s.col.name];
          const aad = aadOf(t.table, s.col.name, p.pk);
          const ok = s.col.bytes ? decryptBytes(Buffer.from(stored), aad).equals(s.plain as Buffer) : decryptText(String(stored), aad) === s.plain;
          if (!ok) throw new Error(`verification failed in ${t.table}`);
        }
        if (p.fromPlain) done.converted++; else done.rekeyed++;
      }
      rep.converted += done.converted; rep.rekeyed += done.rekeyed; rep.raced += done.raced;
      return 'ok' as const;
    }, { timeout: 120_000, maxWait: 30_000 });
    if (outcome === 'busy') throw Object.assign(new Error('busy'), { busy: true });
  }
}

/** Counts (dry run) or converts. Returns counts only. */
export async function convertExisting(opts: { dryRun?: boolean; batch?: number; log?: (m: string) => void } = {}): Promise<Report> {
  const log = opts.log ?? (() => {});
  const dryRun = !!opts.dryRun;
  const batch = Math.max(1, Math.min(500, opts.batch ?? 100));
  reloadKeys();
  const keyId = primaryKeyId();
  if (!keyId || !isEnabled()) throw new Error('PEBLO_DATA_KEY is not set (or not a base64 32-byte key): nothing to convert to');
  if (!dryRun && lockReason()) throw new Error(`refusing to convert: ${lockReason()}`);
  const report: Report = { dryRun, busy: false, tables: [], passes: 0 };
  const reps = new Map<string, TableReport>();
  for (const t of TARGETS) {
    const present = await exists(t.table);
    const rep: TableReport = { table: t.table, present, needing: 0, plaintext: 0, converted: 0, rekeyed: 0, unreadable: 0, raced: 0 };
    reps.set(t.table, rep); report.tables.push(rep);
    if (!present) continue;
    const n1: any[] = await rawPrisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM ${t.table} WHERE ${t.cols.map((c) => needsCond(c, keyId)).join(' OR ')}`);
    const n2: any[] = await rawPrisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM ${t.table} WHERE ${t.cols.map(plainCond).join(' OR ')}`);
    rep.needing = n1[0].n; rep.plaintext = n2[0].n;
  }
  if (dryRun) return report;
  for (let p = 1; p <= 3; p++) {
    report.passes = p;
    for (const t of TARGETS) {
      const rep = reps.get(t.table)!;
      if (!rep.present || (p === 1 ? rep.needing === 0 : rep.raced === 0)) continue;
      rep.raced = 0;
      try { await pass(t, keyId, batch, rep); } catch (e: any) {
        if (e?.busy) { report.busy = true; log('[encrypt] another instance holds the conversion lock; stopping here'); return report; }
        throw e;
      }
      log(`[encrypt] ${t.table}: ${rep.converted} converted, ${rep.rekeyed} re-keyed, ${rep.unreadable} unreadable, ${rep.raced} changed meanwhile`);
    }
    if (![...reps.values()].some((r) => r.raced > 0)) break;
  }
  return report;
}

/** index.ts calls this on boot; it does nothing unless PEBLO_ENCRYPT_EXISTING=1 and a key is set. */
export async function runStartupEncryption(): Promise<void> {
  if (process.env.PEBLO_ENCRYPT_EXISTING !== '1') return;
  if (!isEnabled()) { console.error('[encrypt] PEBLO_ENCRYPT_EXISTING=1 but PEBLO_DATA_KEY is not set: skipping'); return; }
  if (lockReason()) { console.error(`[encrypt] skipping: ${lockReason()}`); return; }
  try {
    console.log('[encrypt] converting existing rows to the current key (background)...');
    const r = await convertExisting({ log: (m) => console.log(m) });
    const total = r.tables.reduce((a, t) => a + t.converted + t.rekeyed, 0);
    const left = r.tables.reduce((a, t) => a + t.unreadable + t.raced, 0);
    console.log(`[encrypt] done: ${total} value(s) written, ${left} left (unreadable or changed meanwhile)${r.busy ? ', stopped early: another instance was converting' : ''}`);
  } catch (e) {
    console.error('[encrypt] conversion stopped:', (e as Error).message);
  }
}
