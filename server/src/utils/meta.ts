// The `meta` JSON on tasks and notes. Only known keys of the right type and size are kept, so nothing unbounded is stored.
// A key sent as null / '' / false / [] is removed. Keys that are not sent keep their value.

export const LABELS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] as const;
const ASTATUS = ['not-started', 'in-progress', 'submitted'];

type Meta = Record<string, any>;
const isObj = (v: unknown): v is Meta => typeof v === 'object' && v !== null && !Array.isArray(v);
const int = (v: unknown, min: number, max: number): number | undefined => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

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
    snoozeUntil: (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined),
    assignment: (v) => (v === true ? true : undefined),
    astatus: (v) => (ASTATUS.includes(v) ? v : undefined),
    order: (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined),
  });
}

export function cleanNoteMeta(input: unknown, current: unknown = {}): Meta {
  if (!isObj(input)) return isObj(current) ? current : {};
  return apply(current as Meta, input, {
    emoji: (v) => (typeof v === 'string' && v.trim() ? Array.from(v.trim()).slice(0, 4).join('') : undefined),
    favourite: (v) => (v === true ? true : undefined),
    pinned: (v) => (v === true ? true : undefined),
    locked: (v) => (v === true ? true : undefined),
    folder: (v) => str(v, 60),
  });
}
