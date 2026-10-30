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
    label: (v) => ((LABELS as readonly string[]).includes(v) ? v : undefined),
    status: (v) => (v === 'doing' ? 'doing' : undefined),
    dependsOn: (v) => (Array.isArray(v) ? [...new Set(v.map((x) => str(x, 64)).filter(Boolean))].slice(0, 10) : undefined),
    remindMin: (v) => int(v, 0, 43200),
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
