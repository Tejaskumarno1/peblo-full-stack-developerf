// Table settings that Markdown cannot hold (column widths, cell colours and alignment, merged cells, header flags, row heights,
// stripes, borders, frozen header). Notes are stored as Markdown, so they ride in a hidden comment line right after the table,
// the way a picture's size rides in "#pw=" in its address:
//
//   | a | b |
//   | --- | --- |
//   | 1 | 2 |
//
//   <!--pb-table {"i":0,"cw":[194,0],"z":1}-->
//
// "i" is the table's place among all the tables of the note (first table is 0). Anything an old reader does not know is ignored.

const MARK_LINE = /^[ \t]*<!--pb-table (\{.*\})-->[ \t]*$/;
const NAME = /^[a-z]{3,12}$/;
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : 0; };
const uid = () => (globalThis.crypto?.randomUUID?.() || `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

export const isTable = (b) => !!b && b.type === 'table' && !!b.content && b.content.type === 'tableContent';
export const toCell = (c) => (c && !Array.isArray(c) && c.type === 'tableCell' ? { ...c, props: { ...(c.props || {}) } } : { type: 'tableCell', props: {}, content: c });
export const emptyCell = () => ({ type: 'tableCell', props: {}, content: [] });
export const cellText = (cell) => {
  const c = cell && !Array.isArray(cell) && cell.type === 'tableCell' ? cell.content : cell;
  const t = (x) => (Array.isArray(x) ? x.map((y) => (y.type === 'link' ? t(y.content) : y.text || '')).join('') : typeof x === 'string' ? x : '');
  return t(c);
};

// ---- the grid: every cell with its true row and column, whatever it is merged with
export function layout(rows) {
  const occ = []; const list = [];
  rows.forEach((row, r) => {
    occ[r] = occ[r] || []; let c = 0;
    row.cells.forEach((cell) => {
      while (occ[r][c]) c++;
      const cs = cell.props?.colspan || 1; const rs = cell.props?.rowspan || 1;
      list.push({ r, c, cs, rs, cell });
      for (let i = 0; i < rs; i++) { occ[r + i] = occ[r + i] || []; for (let j = 0; j < cs; j++) occ[r + i][c + j] = true; }
      c += cs;
    });
  });
  let C = 0; list.forEach((x) => { C = Math.max(C, x.c + x.cs); });
  return { list, R: rows.length, C };
}
export const hasSpans = (list) => list.some((x) => x.cs > 1 || x.rs > 1);
export function build(list, R) {
  const rows = Array.from({ length: R }, () => ({ cells: [] }));
  [...list].sort((a, b) => a.r - b.r || a.c - b.c).forEach((x) => {
    const props = { ...(x.cell.props || {}) };
    if (x.cs > 1) props.colspan = x.cs; else delete props.colspan;
    if (x.rs > 1) props.rowspan = x.rs; else delete props.rowspan;
    rows[x.r].cells.push({ ...x.cell, type: 'tableCell', props });
  });
  return rows;
}
const rowsOf = (block) => block.content.rows.map((r) => ({ ...r, cells: r.cells.map(toCell) }));

// ---- writing a note out
// Markdown tables are a plain grid: a merged cell is written as the cell plus empty ones, and the marker says how to merge them again.
export function exportRows(block) {
  const { list, R, C } = layout(rowsOf(block));
  const grid = Array.from({ length: R }, () => Array.from({ length: C }, emptyCell));
  list.forEach((x) => { const props = { ...(x.cell.props || {}) }; delete props.colspan; delete props.rowspan; grid[x.r][x.c] = { ...x.cell, props }; });
  return grid.map((cells) => ({ cells }));
}
export function tableMarker(block, meta) {
  const ct = block.content; const { list, C } = layout(rowsOf(block));
  const m = {};
  const cw = Array.from({ length: C }, (_, i) => Math.round(ct.columnWidths?.[i] || 0));
  if (cw.some(Boolean)) m.cw = cw;
  const hr = ct.headerRows || 0; const hc = ct.headerCols || 0;
  if (hr !== 1) m.hr = hr;
  if (hc) m.hc = hc;
  const cells = [];
  list.forEach((x) => {
    const p = x.cell.props || {}; const o = {};
    if (p.backgroundColor && p.backgroundColor !== 'default') o.bg = p.backgroundColor;
    if (p.textColor && p.textColor !== 'default') o.tc = p.textColor;
    if (p.textAlignment === 'center' || p.textAlignment === 'right') o.ta = p.textAlignment;
    if (x.cs > 1) o.cs = x.cs;
    if (x.rs > 1) o.rs = x.rs;
    if (Object.keys(o).length) cells.push([x.r, x.c, o]);
  });
  if (cells.length) m.c = cells;
  if (meta) {
    if (meta.z) m.z = 1;
    if (meta.b === 'grid' || meta.b === 'none' || meta.b === 'rows') m.b = meta.b;
    if (meta.va === 'middle' || meta.va === 'bottom') m.va = meta.va;
    if (meta.fh) m.fh = 1;
    if (Array.isArray(meta.rh) && meta.rh.some((v) => v > 0)) m.rh = meta.rh.map((v) => Math.round(v || 0));
  }
  return Object.keys(m).length ? m : null;
}
// Collects one entry per table, in document order, while a note is turned into storage blocks (see toStorage in BlockEditor).
export function newMarks() { return { n: 0, marks: [] }; }
export function noteTable(ctx, block, store) {
  const i = ctx.n++;
  const m = tableMarker(block, store?.get(block.id));
  if (m) ctx.marks.push({ i, ...m });
}
export function insertMarkers(md, ctx) {
  if (!ctx || !ctx.marks.length) return md;
  const lines = md.split('\n'); const ends = []; let fence = null;
  for (let k = 0; k < lines.length; k++) {
    const f = /^\s*(```+|~~~+)/.exec(lines[k]);
    if (f) { fence = fence ? (lines[k].trim().startsWith(fence) ? null : fence) : f[1]; continue; }
    if (fence) continue;
    if (/^\s*\|/.test(lines[k]) && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[k + 1] || '')) {
      let e = k + 1; while (e + 1 < lines.length && /^\s*\|/.test(lines[e + 1])) e++;
      ends.push(e); k = e;
    }
  }
  if (ends.length !== ctx.n) return md; // could not tell which table is which: write no marker rather than a wrong one
  [...ctx.marks].reverse().forEach((m) => {
    const { i, ...rest } = m;
    const at = ends[i] + 1;
    const next = lines[at];
    lines.splice(at, 0, '', `<!--pb-table ${JSON.stringify({ i, ...rest }).replace(/-->/g, '--\\u003e')}-->`, ...(next !== undefined && next.trim() !== '' ? [''] : []));
  });
  return lines.join('\n');
}

// ---- reading a note in
export function splitMarkers(md) {
  const marks = new Map();
  if (typeof md !== 'string' || !md.includes('<!--pb-table ')) return { text: md, marks };
  const out = [];
  for (const line of md.split('\n')) {
    const m = MARK_LINE.exec(line);
    if (m) { try { const o = JSON.parse(m[1]); if (o && typeof o === 'object' && Number.isInteger(o.i) && o.i >= 0) { marks.set(o.i, o); continue; } } catch { /* not ours: keep the line */ } }
    out.push(line);
  }
  return { text: out.join('\n'), marks };
}
const goodName = (v) => (typeof v === 'string' && NAME.test(v) ? v : null);
export function metaOf(mk) {
  const o = {};
  if (mk.z) o.z = 1;
  if (['grid', 'rows', 'none'].includes(mk.b)) o.b = mk.b;
  if (mk.va === 'middle' || mk.va === 'bottom') o.va = mk.va;
  if (mk.fh) o.fh = 1;
  if (Array.isArray(mk.rh)) { const rh = mk.rh.slice(0, 500).map((v) => num(v, 0, 3000)); if (rh.some(Boolean)) o.rh = rh; }
  return Object.keys(o).length ? o : null;
}
export function applyMarker(block, mk) {
  const ct = block.content; const rows = rowsOf(block); const covered = new Set();
  for (const e of Array.isArray(mk.c) ? mk.c : []) {
    const [r, c, o] = Array.isArray(e) ? e : [];
    const cell = rows[r]?.cells[c];
    if (!cell || !o || typeof o !== 'object') continue;
    const bg = goodName(o.bg); const tc = goodName(o.tc);
    if (bg) cell.props.backgroundColor = bg;
    if (tc) cell.props.textColor = tc;
    if (o.ta === 'center' || o.ta === 'right') cell.props.textAlignment = o.ta;
    const cs = num(o.cs, 2, 60); const rs = num(o.rs, 2, 600);
    if (cs) cell.props.colspan = cs;
    if (rs) cell.props.rowspan = rs;
    for (let i = 0; i < (rs || 1); i++) for (let j = 0; j < (cs || 1); j++) if (i || j) covered.add(`${r + i},${c + j}`);
  }
  const next = rows.map((row, r) => ({ ...row, cells: row.cells.filter((_, c) => !covered.has(`${r},${c}`)) }));
  const C = Math.max(0, ...rows.map((r) => r.cells.length));
  const content = { ...ct, rows: next };
  if (Array.isArray(mk.cw)) content.columnWidths = Array.from({ length: C }, (_, i) => num(mk.cw[i], 20, 4000) || undefined);
  if ('hr' in mk) content.headerRows = num(mk.hr, 0, 50) || undefined;
  if ('hc' in mk) content.headerCols = num(mk.hc, 0, 50) || undefined;
  return { block: { ...block, content }, meta: metaOf(mk) };
}
// Puts each table's saved settings back on the blocks read from the Markdown (and into the store for the settings blocks do not hold).
export function applyMarks(blocks, marks, store) {
  if (!marks || !marks.size) return blocks;
  let n = 0;
  const walk = (bs) => bs.map((b) => {
    let out = b;
    if (b.type === 'table') {
      const i = n++; const mk = marks.get(i);
      if (mk && isTable(b)) {
        const id = b.id || uid();
        const r = applyMarker({ ...b, id }, mk);
        out = { ...r.block, id };
        if (r.meta && store) store.set(id, r.meta);
      }
    }
    return out.children?.length ? { ...out, children: walk(out.children) } : out;
  });
  return walk(blocks);
}

// ---- settings blocks do not hold, kept per table. In a live note they live in the shared document so everyone sees the same.
export function createMetaStore(ydoc) {
  const ymap = ydoc ? ydoc.getMap('pbTables') : null;
  const local = new Map(); const subs = new Set();
  const emit = (isLocal) => subs.forEach((f) => { try { f(isLocal); } catch { /* a listener failed */ } });
  if (ymap) ymap.observe((ev) => emit(!!ev.transaction.local));
  const get = (id) => (ymap ? ymap.get(id) : local.get(id)) || null;
  return {
    get,
    set(id, patch) {
      if (!id) return;
      const next = { ...(get(id) || {}), ...patch };
      Object.keys(next).forEach((k) => { if (next[k] === undefined || next[k] === 0 || next[k] === null || next[k] === false) delete next[k]; });
      const empty = !Object.keys(next).length;
      if (ymap) { if (empty) ymap.delete(id); else ymap.set(id, next); } else { if (empty) local.delete(id); else local.set(id, next); emit(true); }
    },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
  };
}

// ---- the same settings on a table that is only read (the shared page turns Markdown into HTML)
export const BG_HEX = { gray: '#E6E0D6', brown: '#EBD3BC', red: '#FBCFCA', orange: '#FFD9AE', yellow: '#FFEC99', green: '#BFEBCF', blue: '#C5DDFB', purple: '#DCD1FF', pink: '#F9D0E1' };
export const TX_HEX = { gray: '#6B6459', brown: '#9A5B2E', red: '#D13B2E', orange: '#E8740C', yellow: '#D4A000', green: '#1E8E4E', blue: '#2563EB', purple: '#7C3AED', pink: '#D6336C' };
export function applyMarksToHtml(root, marks) {
  if (!marks || !marks.size) return;
  [...root.querySelectorAll('table')].forEach((table, i) => {
    const mk = marks.get(i); if (!mk) return;
    const doc = table.ownerDocument; const rows = [...table.rows]; const drop = [];
    if (mk.hr === 0) rows[0] && [...rows[0].cells].forEach((th) => { if (th.tagName === 'TH') { const td = doc.createElement('td'); td.innerHTML = th.innerHTML; th.replaceWith(td); } });
    for (const e of Array.isArray(mk.c) ? mk.c : []) {
      const [r, c, o] = Array.isArray(e) ? e : [];
      const cell = rows[r]?.cells[c]; if (!cell || !o || typeof o !== 'object') continue;
      const bg = goodName(o.bg); const tc = goodName(o.tc);
      if (bg && BG_HEX[bg]) { cell.style.background = BG_HEX[bg]; cell.style.color = '#241f1a'; }
      if (tc && TX_HEX[tc]) cell.style.color = TX_HEX[tc];
      if (o.ta === 'center' || o.ta === 'right') cell.style.textAlign = o.ta;
      const cs = num(o.cs, 2, 60); const rs = num(o.rs, 2, 600);
      if (cs) cell.setAttribute('colspan', String(cs));
      if (rs) cell.setAttribute('rowspan', String(rs));
      for (let a = 0; a < (rs || 1); a++) for (let b = 0; b < (cs || 1); b++) if (a || b) { const t = rows[r + a]?.cells[c + b]; if (t) drop.push(t); }
    }
    drop.forEach((t) => t.remove());
    if (Array.isArray(mk.cw)) {
      const ws = mk.cw.map((v) => num(v, 20, 4000));
      if (ws.some(Boolean)) {
        const cg = doc.createElement('colgroup');
        ws.forEach((w) => { const col = doc.createElement('col'); if (w) col.style.width = `${w}px`; cg.appendChild(col); });
        table.prepend(cg);
        table.style.tableLayout = 'fixed';
        if (ws.every(Boolean)) table.style.width = `${ws.reduce((a, b) => a + b, 0)}px`; else table.style.minWidth = `${ws.reduce((a, b) => a + (b || 120), 0)}px`;
        table.style.maxWidth = 'none';
        const wrap = doc.createElement('div'); wrap.className = 'pb-twrap';
        table.replaceWith(wrap); wrap.appendChild(table);
      }
    }
    const meta = metaOf(mk) || {};
    if (meta.z) table.setAttribute('data-pb-z', '1');
    if (meta.b) table.setAttribute('data-pb-b', meta.b);
    if (meta.va) table.setAttribute('data-pb-va', meta.va);
    if (meta.fh) table.setAttribute('data-pb-fh', '1');
    if (mk.hc) table.setAttribute('data-pb-hc', '1');
    if (meta.rh) [...table.rows].forEach((tr, k) => { if (meta.rh[k] > 0) tr.style.height = `${meta.rh[k]}px`; });
  });
}

// ---- a pasted block of tab separated text (Excel, Google Sheets, a terminal) as a table
export function tsvToTable(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  if (lines.length < 2) return null;
  const grid = lines.map((l) => l.split('\t').map((c) => c.replace(/^"(.*)"$/s, '$1').trim()));
  const n = grid[0].length;
  if (n < 2 || grid.length > 500 || n > 60 || !grid.every((r) => r.length === n)) return null;
  return {
    type: 'table',
    content: { type: 'tableContent', headerRows: 1, rows: grid.map((r) => ({ cells: r.map((c) => ({ type: 'tableCell', props: {}, content: c ? [{ type: 'text', text: c, styles: {} }] : [] })) })) },
  };
}

export const csvOf = (block) => {
  const { list, R, C } = layout(rowsOf(block));
  const grid = Array.from({ length: R }, () => Array.from({ length: C }, () => ''));
  list.forEach((x) => { grid[x.r][x.c] = cellText(x.cell); });
  const q = (s) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return grid.map((r) => r.map(q).join(',')).join('\r\n');
};
