// Safe reading of spreadsheets (xlsx / xls / csv).
// The `xlsx` package (0.18.5, the last npm release) has two known advisories that cannot be fixed from npm:
// prototype pollution (GHSA-4r6h-8v6p-xvw6) and a regular-expression slowdown (GHSA-5pgg-2g8v-p4x9). A file in a shared note
// can come from someone else, so every read goes through here: size cap, row/sheet/column limits, a prototype check, and
// (in the browser) a Web Worker that is stopped if it takes too long, so a bad file can neither poison nor freeze the app.
// See docs/SECURITY-AUDIT.md.

export const XLSX_MAX_BYTES = 10 * 1024 * 1024; // upload limit is 25 MB; spreadsheets are only previewed, so cap lower
export const MAX_SHEETS = 50;
export const PARSE_ROWS = 2000; // rows read per sheet; the preview shows SHOW_ROWS of them
export const SHOW_ROWS = 200;
export const KEEP_COLS = 40;
export const WORKER_MS = 20000;

const fail = (code, message) => Object.assign(new Error(message), { code });

/** Remember the built-in prototypes now; the returned function undoes and reports any property a parse added to them. */
export function guardPrototypes() {
  const targets = [Object.prototype, Array.prototype];
  const before = targets.map((t) => new Set(Reflect.ownKeys(t)));
  return () => {
    let bad = false;
    targets.forEach((t, i) => {
      for (const k of Reflect.ownKeys(t)) {
        if (!before[i].has(k)) { bad = true; try { delete t[k]; } catch { /* frozen is fine */ } }
      }
    });
    if (bad) throw fail('unsafe', 'This spreadsheet tried to change built-in objects');
  };
}

/** The actual read. `X` is the xlsx module. Pure and synchronous, so it runs the same in the worker, the page and the tests. */
export function readSheetsWith(X, buf, { namesOnly = false } = {}) {
  if (!buf || buf.byteLength > XLSX_MAX_BYTES) throw fail('big', 'Too large to preview');
  const check = guardPrototypes();
  try {
    if (namesOnly) {
      const book = X.read(buf, { type: 'array', bookSheets: true });
      return { count: book.SheetNames.length };
    }
    const book = X.read(buf, { type: 'array', cellDates: true, sheetRows: PARSE_ROWS + 1 });
    const sheets = book.SheetNames.slice(0, MAX_SHEETS).map((name) => {
      const all = X.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: false, defval: '', blankrows: true });
      const more = all.length > PARSE_ROWS;
      const rows = all.slice(0, PARSE_ROWS).map((r) => r.slice(0, KEEP_COLS));
      const cols = Math.min(KEEP_COLS, Math.max(6, ...rows.slice(0, SHOW_ROWS).map((r) => r.length)));
      return { name: String(name), rows, cols, more };
    });
    return { sheets };
  } finally {
    check();
  }
}

function inWorker(buf, opts) {
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker(new URL('./sheetWorker.js', import.meta.url), { type: 'module' }); } catch { reject({ fallback: true }); return; }
    let timer = null;
    const done = (fn, v) => { clearTimeout(timer); w.terminate(); fn(v); };
    timer = setTimeout(() => done(reject, fail('slow', 'Took too long to read')), WORKER_MS);
    w.onmessage = (e) => (e.data && e.data.ok ? done(resolve, e.data.result) : done(reject, fail((e.data && e.data.code) || 'bad', (e.data && e.data.message) || 'Unreadable')));
    w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); done(reject, { fallback: true }); };
    w.postMessage({ buf, opts });
  });
}

/** Read a spreadsheet's bytes. Resolves { sheets } (or { count } with { namesOnly: true }); rejects with an Error that has a `code`. */
export async function readSheets(buf, opts = {}) {
  if (!buf || buf.byteLength > XLSX_MAX_BYTES) throw fail('big', 'Too large to preview');
  if (typeof Worker === 'function') {
    try { return await inWorker(buf, opts); } catch (e) { if (!(e && e.fallback)) throw e; }
  }
  const m = await import('xlsx'); // no worker here (old browser or tests): same read, same guards, on this thread
  return readSheetsWith(m.read ? m : m.default, buf, opts);
}
