// A small line-by-line comparison for "what changed since this version".

/** Pictures would flood the view, so they show as a short tag. */
export const plainForDiff = (md) => String(md || '')
  .replace(/<figure>[\s\S]*?<\/figure>/g, '[picture]')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '[picture]');

/** -> rows [{ l, r, kind }] where l is the older line, r the newer one, kind is same | change | del | add. */
export function diffRows(oldText, newText) {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const n = a.length;
  const m = b.length;
  // Too big to compare line by line cheaply: show it as one replaced block.
  if (n * m > 4_000_000) return [{ l: oldText, r: newText, kind: 'change' }];
  const t = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const rows = [];
  let i = 0;
  let j = 0;
  let dels = [];
  let adds = [];
  const flush = () => {
    const k = Math.max(dels.length, adds.length);
    for (let x = 0; x < k; x++) {
      const l = dels[x];
      const r = adds[x];
      rows.push({ l: l ?? null, r: r ?? null, kind: l != null && r != null ? 'change' : l != null ? 'del' : 'add' });
    }
    dels = []; adds = [];
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { flush(); rows.push({ l: a[i], r: b[j], kind: 'same' }); i++; j++; }
    else if (j < m && (i === n || t[i][j + 1] >= t[i + 1][j])) { adds.push(b[j]); j++; }
    else { dels.push(a[i]); i++; }
  }
  flush();
  return rows;
}

/** Hides long unchanged stretches: keeps `keep` lines around each change and replaces the rest with a gap marker. */
export function collapseRows(rows, keep = 2) {
  const out = [];
  let run = [];
  const flushRun = () => {
    if (run.length <= keep * 2 + 1) out.push(...run);
    else { out.push(...run.slice(0, keep)); out.push({ kind: 'gap', count: run.length - keep * 2 }); out.push(...run.slice(run.length - keep)); }
    run = [];
  };
  for (const r of rows) {
    if (r.kind === 'same') run.push(r);
    else {
      if (run.length) {
        // The first run keeps only its tail, so a long untouched start doesn't push the first change off screen.
        if (!out.length && run.length > keep) { out.push({ kind: 'gap', count: run.length - keep }); out.push(...run.slice(run.length - keep)); run = []; }
        else flushRun();
      }
      out.push(r);
    }
  }
  if (run.length) { if (run.length > keep) { out.push(...run.slice(0, keep)); out.push({ kind: 'gap', count: run.length - keep }); } else out.push(...run); }
  return out;
}
