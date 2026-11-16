// N5: "Include sub-folders" now defaults to ON. A saved Notes view that came from the old default (subs false and never
// switched by the person: no `subsSet` marker) becomes ON; a person who switched it themselves keeps their choice.
export function migrateView(v) {
  if (!v || typeof v !== 'object') return v;
  if (v.subs === undefined || (v.subs === false && !v.subsSet)) { const { subs: _drop, ...rest } = v; return rest; } // falls back to DEFAULT_VIEW.subs (true)
  return v;
}
