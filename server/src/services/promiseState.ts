// Reading a note again finds promises again. Ones you already added as tasks or ignored must keep that state,
// otherwise they come back as "open" and adding them again makes duplicate tasks.
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const keyOf = (p: any) => norm(p?.text);

export function carryOverPromiseState(previous: any[], found: any[]) {
  const handled = new Map<string, any>();
  for (const old of previous || []) {
    if (old && old.status && old.status !== 'open') handled.set(keyOf(old), old);
  }
  return found.map((p) => {
    const was = handled.get(keyOf(p));
    return { ...p, status: was ? was.status : 'open', todoId: was ? was.todoId || null : null };
  });
}
