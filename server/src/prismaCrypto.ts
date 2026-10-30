import { randomUUID } from 'crypto';
import { aadOf, decryptText, encryptText } from './dataCrypto.js';

/*
 * A Prisma client extension that encrypts the columns listed in ENC on the way in and decrypts them on the way out, so
 * controllers keep reading and writing plain text. Relations are followed (include/select, nested creates), so
 * `note.backups[].content` or `todo.note.content` come back decrypted too.
 *
 *  - Writes: create / createMany / update / updateMany / upsert (and nested creates). A row's id is part of the AAD, so
 *    creates get their id here (the same uuid Prisma would have made) and updates look the id up when `where` is not by id.
 *  - Reads: every find*, and the rows returned by writes. When a query selects an encrypted column without `id`, `id` is
 *    added to the query and removed again from the result.
 *  - A filter or sort on an encrypted column cannot work on ciphertext: it throws (the code must search in JS instead).
 *  - Raw SQL ($queryRaw...) bypasses this; those paths call dataCrypto helpers themselves.
 */
type Enc = { table: string; fields: string[] };
export const ENC: Record<string, Enc> = {
  Note: { table: 'notes', fields: ['content'] },
  NoteBackup: { table: 'note_backups', fields: ['content'] },
  AiGeneration: { table: 'ai_generations', fields: ['result'] },
  NoteEmbedding: { table: 'note_embeddings', fields: ['vector'] },
  QuizRun: { table: 'quiz_runs', fields: ['questions', 'answers'] },
};

// Relation fields between the models (only what is needed to find encrypted rows inside a result).
const REL: Record<string, Record<string, string>> = {
  User: { notes: 'Note', aiGenerations: 'AiGeneration', quizRuns: 'QuizRun', todos: 'Todo' },
  Note: { user: 'User', tags: 'NoteTag', aiGenerations: 'AiGeneration', backups: 'NoteBackup', linkedTodos: 'Todo', embedding: 'NoteEmbedding' },
  Tag: { notes: 'NoteTag' },
  NoteTag: { note: 'Note', tag: 'Tag' },
  AiGeneration: { note: 'Note', user: 'User' },
  NoteBackup: { note: 'Note' },
  NoteEmbedding: { note: 'Note' },
  QuizRun: { user: 'User' },
  Todo: { note: 'Note', user: 'User', series: 'TodoSeries' },
  TodoSeries: { todos: 'Todo', user: 'User' },
};

const READ_OPS = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany']);
const ROW_WRITE_OPS = new Set(['create', 'update', 'upsert', 'delete', 'createManyAndReturn']);
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !Buffer.isBuffer(v);

// ---------- filters on encrypted columns ----------
function assertNoEncFilter(model: string, where: any, what = 'where') {
  if (!isObj(where)) return;
  const enc = ENC[model];
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if (enc && enc.fields.includes(k)) throw new Error(`internal: ${model}.${k} is encrypted and cannot be used in ${what}`);
    if (k === 'AND' || k === 'OR' || k === 'NOT') { for (const w of Array.isArray(v) ? v : [v]) assertNoEncFilter(model, w, what); continue; }
    const target = REL[model]?.[k];
    if (target && isObj(v)) {
      const ops = ['some', 'every', 'none', 'is', 'isNot'].filter((op) => v[op] !== undefined);
      if (ops.length) for (const op of ops) assertNoEncFilter(target, v[op], what);
      else assertNoEncFilter(target, v, what);
    }
  }
}
function assertNoEncOrder(model: string, orderBy: any) {
  const enc = ENC[model];
  if (!enc || !orderBy) return;
  for (const o of Array.isArray(orderBy) ? orderBy : [orderBy]) for (const k of Object.keys(o || {})) if (enc.fields.includes(k)) throw new Error(`internal: ${model}.${k} is encrypted and cannot be sorted on`);
}

// ---------- reads ----------
type Plan = { addId: boolean; rel: Record<string, Plan> };

/** Makes sure every selected row carries its id when an encrypted column is selected. Returns the changed args and what to undo. */
function augment(model: string, args: any): { args: any; plan: Plan } {
  const plan: Plan = { addId: false, rel: {} };
  if (!isObj(args)) return { args, plan };
  const out = { ...args };
  const enc = ENC[model];
  const level = (key: 'select' | 'include') => {
    const sel = { ...out[key] };
    if (key === 'select' && enc && enc.fields.some((f) => sel[f]) && !sel.id) { sel.id = true; plan.addId = true; }
    for (const [k, v] of Object.entries(sel)) {
      const target = REL[model]?.[k];
      if (target && isObj(v)) { const sub = augment(target, v); sel[k] = sub.args; plan.rel[k] = sub.plan; }
    }
    out[key] = sel;
  };
  if (isObj(out.select)) level('select');
  else if (isObj(out.include)) level('include');
  return { args: out, plan };
}

function decryptRow(model: string, row: any, plan?: Plan) {
  if (!isObj(row)) return;
  const enc = ENC[model];
  if (enc) {
    for (const f of enc.fields) {
      const v = row[f];
      if (typeof v === 'string' && v !== '') {
        if (typeof row.id !== 'string') throw new Error(`internal: ${model} row has no id to decrypt ${f}`);
        row[f] = decryptText(v, aadOf(enc.table, f, row.id));
      }
    }
  }
  const rels = REL[model];
  if (rels) {
    for (const [k, target] of Object.entries(rels)) {
      const v = row[k];
      if (v == null || typeof v !== 'object') continue;
      const sub = plan?.rel[k];
      if (Array.isArray(v)) for (const r of v) decryptRow(target, r, sub);
      else decryptRow(target, v, sub);
    }
  }
  if (plan?.addId) delete row.id;
}
const decryptResult = (model: string, res: any, plan: Plan) => {
  if (Array.isArray(res)) for (const r of res) decryptRow(model, r, plan);
  else decryptRow(model, res, plan);
  return res;
};

// ---------- writes ----------
const touchesEnc = (model: string, data: any): boolean => {
  if (!isObj(data)) return false;
  const enc = ENC[model];
  if (enc && enc.fields.some((f) => data[f] !== undefined)) return true;
  const rels = REL[model] || {};
  return Object.keys(data).some((k) => rels[k] && data[k] !== undefined && data[k] !== null && typeof data[k] === 'object');
};

const ownTouch = (model: string, data: any) => !!ENC[model] && isObj(data) && ENC[model].fields.some((f) => data[f] !== undefined);

function encValue(table: string, field: string, id: string, v: any) {
  if (typeof v === 'string') return encryptText(v, aadOf(table, field, id));
  if (isObj(v) && typeof v.set === 'string') return { ...v, set: encryptText(v.set, aadOf(table, field, id)) };
  if (v === null || v === undefined) return v;
  throw new Error(`internal: unsupported write operator on encrypted column ${table}.${field}`);
}

/** Encrypts the encrypted columns of one row's data. `id` is the row's id (create: given or made here). */
function encData(model: string, data: any, id: string | null, creating: boolean): any {
  if (!isObj(data)) return data;
  const out = { ...data };
  const enc = ENC[model];
  if (enc) {
    if (creating && typeof out.id !== 'string') out.id = randomUUID();
    const rid = creating ? (out.id as string) : id;
    if (enc.fields.some((f) => out[f] !== undefined) && !rid) throw new Error(`internal: no row id to encrypt ${model}`);
    for (const f of enc.fields) if (out[f] !== undefined) out[f] = encValue(enc.table, f, rid as string, out[f]);
  }
  for (const [k, target] of Object.entries(REL[model] || {})) {
    if (isObj(out[k])) out[k] = encNested(target, out[k]);
  }
  return out;
}
function encCreateList(target: string, v: any) {
  return Array.isArray(v) ? v.map((d) => encData(target, d, null, true)) : encData(target, v, null, true);
}
function encNested(target: string, op: Record<string, any>): any {
  const out = { ...op };
  if (out.create !== undefined) out.create = encCreateList(target, out.create);
  if (out.createMany && isObj(out.createMany)) out.createMany = { ...out.createMany, data: encCreateList(target, out.createMany.data) };
  if (out.connectOrCreate !== undefined) {
    const f = (c: any) => ({ ...c, create: encData(target, c.create, null, true) });
    out.connectOrCreate = Array.isArray(out.connectOrCreate) ? out.connectOrCreate.map(f) : f(out.connectOrCreate);
  }
  for (const bad of ['update', 'upsert', 'updateMany']) {
    if (out[bad] === undefined) continue;
    for (const item of Array.isArray(out[bad]) ? out[bad] : [out[bad]]) {
      const d = isObj(item) ? (item.data ?? item.update ?? item.create ?? item) : item;
      if (ENC[target] && isObj(d) && ENC[target].fields.some((f) => d[f] !== undefined)) throw new Error(`internal: nested ${bad} of encrypted model ${target} is not supported`);
    }
  }
  return out;
}

const lower = (m: string) => m.charAt(0).toLowerCase() + m.slice(1);

/** Wraps the client. `base` is the plain client (used for lookups the hooks need). */
export function withDataEncryption<T extends { $extends: (x: any) => any }>(base: T): any {
  return base.$extends({
    name: 'peblo-data-encryption',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: { model: string; operation: string; args: any; query: (a: any) => Promise<any> }) {
          const isRead = READ_OPS.has(operation);
          const isRowWrite = ROW_WRITE_OPS.has(operation);
          const isWrite = isRowWrite || operation === 'createMany' || operation === 'update' || operation === 'updateMany';
          if (!isRead && !isWrite) {
            // count / aggregate / groupBy / deleteMany ...: nothing to decrypt, but filters on encrypted columns can not work
            if (args?.where) assertNoEncFilter(model, args.where);
            return query(args);
          }
          let a = args ?? {};
          if (a.where) assertNoEncFilter(model, a.where);
          if (a.orderBy) assertNoEncOrder(model, a.orderBy);
          if (a.cursor) assertNoEncFilter(model, a.cursor);

          // ---- writes ----
          if (operation === 'create' || operation === 'createManyAndReturn') {
            if (touchesEnc(model, a.data)) a = { ...a, data: operation === 'create' ? encData(model, a.data, null, true) : (Array.isArray(a.data) ? a.data.map((d: any) => encData(model, d, null, true)) : encData(model, a.data, null, true)) };
          } else if (operation === 'createMany') {
            if (Array.isArray(a.data) ? a.data.some((d: any) => touchesEnc(model, d)) : touchesEnc(model, a.data)) a = { ...a, data: Array.isArray(a.data) ? a.data.map((d: any) => encData(model, d, null, true)) : encData(model, a.data, null, true) };
          } else if (operation === 'update') {
            if (touchesEnc(model, a.data)) {
              const id = ownTouch(model, a.data) ? await rowIdFor(base, model, a.where) : null;
              a = { ...a, data: encData(model, a.data, id, false) };
            }
          } else if (operation === 'updateMany') {
            if (touchesEnc(model, a.data)) return updateMany(base, model, a, query);
          } else if (operation === 'upsert') {
            const encCreate = touchesEnc(model, a.create);
            const encUpdate = touchesEnc(model, a.update);
            if (encCreate || encUpdate) {
              const create = encData(model, a.create, null, true);
              let update = a.update;
              if (encUpdate) {
                const id = ownTouch(model, a.update) ? ((await rowIdFor(base, model, a.where, true)) ?? (create.id as string)) : null;
                update = encData(model, a.update, id, false);
              }
              a = { ...a, create, update };
            }
          }

          // ---- reads (and the rows returned by writes) ----
          if (!isRead && !isRowWrite) return query(a);
          const { args: withIds, plan } = augment(model, a);
          const res = await query(withIds);
          return decryptResult(model, res, plan);
        },
      },
    },
  });
}

async function rowIdFor(base: any, model: string, where: any, optional = false): Promise<string | null> {
  if (isObj(where) && typeof where.id === 'string') return where.id;
  const row = await base[lower(model)].findFirst({ where, select: { id: true } });
  if (!row) { if (optional) return null; throw Object.assign(new Error('Record to update not found.'), { code: 'P2025' }); }
  return row.id;
}

/** updateMany on an encrypted column: each row needs its own ciphertext (its id is in the AAD). */
async function updateMany(base: any, model: string, a: any, query: (a: any) => Promise<any>) {
  if (isObj(a.where) && typeof a.where.id === 'string') {
    return query({ ...a, data: encData(model, a.data, a.where.id, false) }); // by id: one row, the whole condition kept (e.g. "and updatedAt is still X")
  }
  const rows: { id: string }[] = await base[lower(model)].findMany({ where: a.where, select: { id: true } });
  let count = 0;
  for (const r of rows) {
    const done = await base[lower(model)].updateMany({ where: { AND: [a.where, { id: r.id }] }, data: encData(model, a.data, r.id, false) });
    count += done.count;
  }
  return { count };
}
