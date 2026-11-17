// Runs one request per item with at most `concurrency` at a time. A 429 (too many requests) is retried once after a short wait.
// Never throws: resolves to { done: [ids that worked], failed: [{ id, title, error }] } so the caller can say "N of M done".
//
// R37: before that, the same `fn` is "dry run" once per item against a recording stand-in of the API client (synchronously, so no
// other request of the app can be caught). When every item turns out to be the same notes action (archive, trash, restore, pin,
// unpin, move to a folder, add a tag) the whole list goes to the server in ONE request, POST /notes/bulk (500 ids per request).
// If the server does not have that route (an older server answers 404) or anything else goes wrong with it, the per-note path
// below runs as before. Callers pass the same `fn` either way, so they need no change.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const statusOf = (e) => e?.response?.status ?? e?.status;

export function reasonOf(e) {
  const d = e?.response?.data;
  const msg = (d && (d.error || d.message)) || e?.message || 'Unknown error';
  const st = statusOf(e);
  return st && !String(msg).includes(String(st)) ? `${msg} (${st})` : String(msg);
}

function waitFor(e, fallback) {
  const ra = Number(e?.response?.headers?.['retry-after']);
  return Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 5000) : fallback;
}

export const BULK_MAX = 500;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const only = (o, keys) => isObj(o) && Object.keys(o).length === keys.length && keys.every((k) => k in o);

/**
 * Calls fn(item) with api.patch/delete/post replaced by recorders, and puts the real methods back before returning.
 * Returns the one recorded call, or null when fn made none, several, or threw.
 */
export function recordCall(api, fn, item) {
  const calls = [];
  const saved = { patch: api.patch, delete: api.delete, post: api.post };
  const rec = (method) => (url, a, b) => { calls.push({ method, url, data: method === 'delete' ? undefined : a, cfg: method === 'delete' ? a : b }); return Promise.resolve({ data: {} }); };
  let threw = false;
  try {
    api.patch = rec('patch'); api.delete = rec('delete'); api.post = rec('post');
    const ret = fn(item);
    if (ret && typeof ret.then === 'function') ret.then(() => {}, () => {});
  } catch { threw = true; } finally { Object.assign(api, saved); }
  return !threw && calls.length === 1 ? calls[0] : null;
}

/** What one recorded call means as a bulk action for note `id`, or null when it is not one. */
export function actionOf(call, id) {
  if (!call || call.cfg !== undefined) return null; // a custom config (space override, ?permanent=1) stays per note
  const enc = encodeURIComponent(id);
  const base = new RegExp(`^/?notes/(${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|${enc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`);
  const m = base.exec(call.url || '');
  if (!m) return null;
  const rest = call.url.slice(m[0].length);
  if (call.method === 'delete' && rest === '') return { action: 'trash' };
  if (call.method === 'post' && rest === '/restore' && call.data === undefined) return { action: 'restore' };
  if (call.method !== 'patch' || rest !== '') return null;
  const d = call.data;
  if (only(d, ['isArchived']) && typeof d.isArchived === 'boolean') return { action: d.isArchived ? 'archive' : 'unarchive' };
  if (only(d, ['meta']) && only(d.meta, ['pinned']) && typeof d.meta.pinned === 'boolean') return { action: d.meta.pinned ? 'pin' : 'unpin' };
  if (only(d, ['meta']) && only(d.meta, ['folder']) && typeof d.meta.folder === 'string') return { action: 'move', folder: d.meta.folder };
  // "add a tag": the note's tags with the new one at the end (the server adds it, keeping the others)
  if (only(d, ['tags']) && Array.isArray(d.tags) && d.tags.length && typeof d.tags[d.tags.length - 1] === 'string') return { action: 'tag', tag: d.tags[d.tags.length - 1] };
  return null;
}

/** One bulk plan for the whole list, or null when the items do not all do the same notes action. */
export function planBulk(api, items, fn) {
  if (!api || !items.length) return null;
  let plan = null;
  for (const item of items) {
    if (typeof item?.id !== 'string') return null;
    const a = actionOf(recordCall(api, fn, item), item.id);
    if (!a) return null;
    if (!plan) plan = a;
    else if (a.action !== plan.action || a.folder !== plan.folder || a.tag !== plan.tag) return null;
  }
  return plan;
}

/** Sends the plan in chunks of BULK_MAX. Resolves to the bulkRun shape, or null when the server cannot do it (fall back). */
async function sendBulk(api, items, plan, retryWait) {
  const titles = new Map(items.map((it) => [it.id, it.title || 'Untitled']));
  const done = []; const failed = [];
  const ids = items.map((it) => it.id);
  for (let i = 0; i < ids.length; i += BULK_MAX) {
    const chunk = ids.slice(i, i + BULK_MAX);
    let res;
    for (let attempt = 0; ; attempt++) {
      try { res = await api.post('/notes/bulk', { ...plan, ids: chunk }); break; } catch (e) {
        if (statusOf(e) === 429 && attempt === 0) { await sleep(waitFor(e, retryWait)); continue; }
        if (i === 0) return null; // nothing was changed yet: the per-note path does it all (404 = an older server)
        for (const id of chunk) failed.push({ id, title: titles.get(id), error: reasonOf(e) });
        res = null; break;
      }
    }
    const body = res?.data;
    if (!res) continue;
    if (!body || !Array.isArray(body.done) || !Array.isArray(body.failed)) { if (i === 0) return null; continue; }
    const seen = new Set();
    for (const id of body.done) { if (titles.has(id)) { done.push(id); seen.add(id); } }
    for (const f of body.failed) { if (titles.has(f?.id)) { failed.push({ id: f.id, title: titles.get(f.id), error: f.error || f.code || 'Failed', code: f.code }); seen.add(f.id); } }
    for (const id of chunk) if (!seen.has(id)) failed.push({ id, title: titles.get(id), error: 'No answer for this note' });
  }
  return { done, failed };
}

let defaultApi = null;
/** The app's API client, loaded only in the browser build (tests pass `api` themselves or get the per-note path). */
async function appApi() {
  if (defaultApi !== null) return defaultApi || null;
  try {
    defaultApi = import.meta.env ? (await import('../api/client.js')).default : false;
  } catch { defaultApi = false; }
  return defaultApi || null;
}

/**
 * @param {Array<{id:string,title?:string}>} items
 * @param {(item:object)=>Promise<any>} fn
 * @param {{concurrency?:number, retryWait?:number, api?:object|false}} [opts] api: the axios-like client to use for the one-request path
 *   (default: the app's client in the browser; false turns the one-request path off)
 */
export async function bulkRun(items, fn, { concurrency = 5, retryWait = 800, api } = {}) {
  const list = Array.from(items || []);
  if (list.length && api !== false) {
    const client = api || (await appApi());
    const plan = client ? planBulk(client, list, fn) : null;
    if (plan) {
      const res = await sendBulk(client, list, plan, retryWait);
      if (res) return res;
    }
  }
  const done = [];
  const failed = [];
  let next = 0;
  const one = async (item) => {
    for (let attempt = 0; ; attempt++) {
      try { await fn(item); done.push(item.id); return; } catch (e) {
        if (statusOf(e) === 429 && attempt === 0) { await sleep(waitFor(e, retryWait)); continue; }
        failed.push({ id: item.id, title: item.title || 'Untitled', error: reasonOf(e) });
        return;
      }
    }
  };
  const worker = async () => { while (next < list.length) { const item = list[next++]; await one(item); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, list.length)) }, worker));
  return { done, failed };
}

/** "3 of 5 done, 2 failed" */
export const partialText = (res, total) => `${res.done.length} of ${total} done, ${res.failed.length} failed`;
