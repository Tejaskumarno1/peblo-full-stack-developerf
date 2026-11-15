// Runs one request per item with at most `concurrency` at a time. A 429 (too many requests) is retried once after a short wait.
// Never throws: resolves to { done: [ids that worked], failed: [{ id, title, error }] } so the caller can say "N of M done".
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

/**
 * @param {Array<{id:string,title?:string}>} items
 * @param {(item:object)=>Promise<any>} fn
 * @param {{concurrency?:number, retryWait?:number}} [opts]
 */
export async function bulkRun(items, fn, { concurrency = 5, retryWait = 800 } = {}) {
  const done = [];
  const failed = [];
  const list = Array.from(items || []);
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
