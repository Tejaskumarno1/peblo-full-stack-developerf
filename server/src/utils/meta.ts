// The `meta` JSON on tasks and notes. Only known keys of the right type and size are kept, so nothing unbounded is stored.
// A key sent as null / '' / false / [] is removed. Keys that are not sent keep their value.

export const LABELS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] as const;
const ASTATUS = ['not-started', 'in-progress', 'submitted'];

/** Postgres text and JSON columns reject NUL (\u0000, error 22P05 / 22021) and a lone UTF-16 surrogate cannot be encoded as UTF-8: drop both. */
export const scrub = (s: string): string => s.replace(/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
/** Scrubs the free-text fields of a request body in place. */
export function scrubBody(body: any, keys: string[]): void {
  if (!body || typeof body !== 'object') return;
  for (const k of keys) if (typeof body[k] === 'string') body[k] = scrub(body[k]);
}

type Meta = Record<string, any>;
const isObj = (v: unknown): v is Meta => typeof v === 'object' && v !== null && !Array.isArray(v);
const int = (v: unknown, min: number, max: number): number | undefined => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? scrub(v).trim().slice(0, max) || undefined : undefined);

function apply(current: Meta, input: Meta, rules: Record<string, (v: any) => any>): Meta {
  const out: Meta = isObj(current) ? { ...current } : {};
  for (const [key, check] of Object.entries(rules)) {
    if (!(key in input)) continue;
    const v = input[key];
    if (v === null || v === '' || v === false || (Array.isArray(v) && v.length === 0)) { delete out[key]; continue; }
    const ok = check(v);
    if (ok === undefined) continue; // an invalid value is ignored, the old one stays
    out[key] = ok;
  }
  return out;
}

export function cleanTodoMeta(input: unknown, current: unknown = {}): Meta {
  if (!isObj(input)) return isObj(current) ? current : {};
  return apply(current as Meta, input, {
    details: (v) => str(v, 4000),
    subtasks: (v) => {
      if (!Array.isArray(v)) return undefined;
      const list = v.slice(0, 30).map((s, i) => (isObj(s) && str(s.text, 200) ? { id: str(s.id, 40) || `s${i}-${Date.now().toString(36)}`, text: str(s.text, 200), done: s.done === true } : null)).filter(Boolean);
      return list.length ? list : undefined;
    },
    estimateMin: (v) => int(v, 1, 1440),
    spentMin: (v) => int(v, 0, 100000),
    // minutes worked per day, {"2026-11-05": 45}, so the time can be shown as "3 h over 4 days"
    timeLog: (v) => {
      if (!isObj(v)) return undefined;
      const out: Record<string, number> = {};
      for (const [k, n] of Object.entries(v).slice(0, 400)) { const m = int(n, 1, 1440); if (/^\d{4}-\d{2}-\d{2}$/.test(k) && m !== undefined) out[k] = m; }
      return Object.keys(out).length ? out : undefined;
    },
    label: (v) => ((LABELS as readonly string[]).includes(v) ? v : undefined),
    // board column: "doing" and "review"; a task with neither is To do, a completed one is Done
    status: (v) => (typeof v === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(v) && v !== 'todo' && v !== 'done' ? v : undefined),
    // who sees a team task: nothing = the whole team, "me" = only the creator and the assignees, "people" = those plus the chosen viewers
    visibility: (v) => (v === 'me' || v === 'people' ? v : undefined),
    viewers: (v) => (Array.isArray(v) ? [...new Set(v.map((x) => str(x, 64)).filter(Boolean))].slice(0, 50) : undefined),
    assignees: (v) => (Array.isArray(v) ? [...new Set(v.map((x) => str(x, 64)).filter(Boolean))].slice(0, 10) : undefined),
    watchers: (v) => (Array.isArray(v) ? [...new Set(v.map((x) => str(x, 64)).filter(Boolean))].slice(0, 50) : undefined),
    dependsOn: (v) => (Array.isArray(v) ? [...new Set(v.map((x) => str(x, 64)).filter(Boolean))].slice(0, 10) : undefined),
    remindMin: (v) => int(v, 0, 43200),
    // every reminder lead time in minutes (an event can ring more than once), and the trip time that makes "time to leave" ring
    reminders: (v) => (Array.isArray(v) ? [...new Set(v.map((x) => int(x, 0, 43200)).filter((x): x is number => x !== undefined))].sort((a, b) => a - b).slice(0, 6) : undefined),
    travelMin: (v) => int(v, 1, 600),
    repeatFromDone: (v) => (v === true ? true : undefined),
    source: (v) => {
      if (!isObj(v)) return undefined;
      const quote = str(v.quote, 400);
      if (!quote) return undefined;
      const noteId = str(v.noteId, 64);
      const line = int(v.line, 1, 100000);
      return { quote, ...(noteId ? { noteId } : {}), ...(line ? { line } : {}) };
    },
      link: (v) => { const s = str(v, 300); return s && /^https?:\/\/\S+$/i.test(s) ? s : undefined; },
      linkedTasks: (v) => {
        if (!Array.isArray(v)) return undefined;
        const list = v.map((x) => (x && typeof x === 'object' ? { id: str((x as any).id, 64), text: str((x as any).text, 120) } : null)).filter((x): x is { id: string; text: string } => !!x && !!x.id && !!x.text).slice(0, 8);
        return list.length ? list : undefined;
      },
    attendees: (v) => {
      if (!Array.isArray(v)) return undefined;
      const names = [...new Set(v.map((x) => str(x, 40)).filter(Boolean))].slice(0, 12);
      return names.length ? names : undefined;
    },
    snoozeUntil: (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined),
    assignment: (v) => (v === true ? true : undefined),
    astatus: (v) => (ASTATUS.includes(v) ? v : undefined),
    order: (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined),
    list: (v) => str(v, 60),
    planned: (v) => (v === true ? true : undefined),
    moves: (v) => int(v, 0, 99),
    proposal: (v) => { if (!isObj(v)) return undefined; const by = str(v.by, 60); if (!by) return undefined; const from = str(v.from, 120); return { by, ...(from ? { from } : {}) }; },
  });
}

export function cleanNoteMeta(input: unknown, current: unknown = {}): Meta {
  if (!isObj(input)) return isObj(current) ? current : {};
  return apply(current as Meta, input, {
    emoji: (v) => (typeof v === 'string' && v.trim() ? Array.from(scrub(v).trim()).slice(0, 4).join('') : undefined),
    favourite: (v) => (v === true ? true : undefined),
    pinned: (v) => (v === true ? true : undefined),
    locked: (v) => (v === true ? true : undefined),
    folder: (v) => str(v, 60),
  });
}
