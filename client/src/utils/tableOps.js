// What the table controls do to a table. Everything takes the editor, the table block's id and plain numbers, so the toolbar,
// the context menu, the row and column grips and the hover "+" handles all share one set of rules.
import { TextSelection } from '@tiptap/pm/state';
import { TableMap, mergeCells, splitCell, addRowBefore, addRowAfter, addColumnBefore, addColumnAfter, deleteRow, deleteColumn } from 'prosemirror-tables';
import { layout, build, toCell, hasSpans, cellText, csvOf } from './tableMeta';

export const say = (message, state = 'done') => window.dispatchEvent(new CustomEvent('pb-upload', { detail: { state, message } }));

export function findTable(editor, id) {
  let hit = null;
  editor.prosemirrorState.doc.descendants((n, pos) => {
    if (hit) return false;
    if (n.type.name === 'blockContainer' && n.attrs.id === id && n.firstChild?.type.name === 'table') { hit = { pos: pos + 1, node: n.firstChild }; return false; }
    return true;
  });
  return hit;
}
// Where the cursor is: the table, the row and the cell (by position in its row), and how many cells are selected.
export function selInfo(editor) {
  try {
    const st = editor.prosemirrorState; const sel = st.selection; const $p = sel.$anchorCell || sel.$from;
    for (let d = $p.depth; d > 0; d--) {
      if ($p.node(d).type.name !== 'table') continue;
      let n = 1; if (sel.$anchorCell) { n = 0; sel.forEachCell(() => { n++; }); }
      return { id: $p.node(d - 1).attrs.id, pos: $p.before(d), r: $p.index(d), ci: $p.index(d + 1), n, multi: sel.$anchorCell ? sel : null };
    }
  } catch { /* no selection */ }
  return null;
}
export function selectedCells(editor, info) {
  if (!info.multi) return [[info.r, info.ci]];
  const out = []; const doc = editor.prosemirrorState.doc;
  info.multi.forEachCell((_n, pos) => { const $ = doc.resolve(pos); out.push([$.index($.depth - 1), $.index($.depth)]); });
  return out;
}
const rowsOf = (block) => block.content.rows.map((r) => ({ ...r, cells: r.cells.map(toCell) }));
const put = (editor, block, rows, extra = {}) => editor.updateBlock(block, { type: 'table', content: { ...block.content, ...extra, rows } });

// put the text cursor inside a cell: row r, the ci-th cell of that row
function cursorIn(state, tablePos, r, ci) {
  const table = state.doc.nodeAt(tablePos);
  let p = tablePos + 1;
  for (let i = 0; i < r; i++) p += table.child(i).nodeSize;
  const row = table.child(r); p += 1;
  for (let j = 0; j < ci; j++) p += row.child(j).nodeSize;
  return TextSelection.near(state.doc.resolve(p + 2));
}
// the cell that covers the grid square (r, c): its row and its place in that row
export function anchorAt(block, r, c) {
  const { list } = layout(rowsOf(block));
  const hit = list.find((x) => x.r <= r && r < x.r + x.rs && x.c <= c && c < x.c + x.cs);
  if (!hit) return null;
  const ci = list.filter((x) => x.r === hit.r).sort((a, b) => a.c - b.c).indexOf(hit);
  return { r: hit.r, ci, hit };
}
function run(editor, id, r, c, command) {
  const block = editor.getBlock(id); const t = findTable(editor, id); if (!block || !t) return false;
  const a = anchorAt(block, r, c); if (!a) return false;
  return editor.exec((state, dispatch) => {
    const st = state.apply(state.tr.setSelection(cursorIn(state, t.pos, a.r, a.ci)));
    return command(st, dispatch);
  });
}

// ---- row heights follow their rows
export function shiftHeights(store, id, op, at) {
  const m = store.get(id); if (!m || !Array.isArray(m.rh)) return;
  const rh = [...m.rh];
  if (op === 'insert') rh.splice(at, 0, 0); else if (op === 'delete') rh.splice(at, 1);
  store.set(id, { rh: rh.some((v) => v > 0) ? rh : undefined });
}

export function insertRow(editor, store, id, at) { // at = the line between rows: 0 is above the first row
  const block = editor.getBlock(id); if (!block) return;
  const { R } = layout(rowsOf(block));
  const ok = at <= 0 ? run(editor, id, 0, 0, addRowBefore) : run(editor, id, Math.min(at, R) - 1, 0, addRowAfter);
  if (ok) shiftHeights(store, id, 'insert', Math.max(0, Math.min(at, R)));
}
export function insertColumn(editor, id, at) {
  const block = editor.getBlock(id); if (!block) return;
  const { C } = layout(rowsOf(block));
  if (at <= 0) run(editor, id, 0, 0, addColumnBefore); else run(editor, id, 0, Math.min(at, C) - 1, addColumnAfter);
}
export function removeRow(editor, store, id, r) {
  const block = editor.getBlock(id); if (!block) return;
  if (layout(rowsOf(block)).R <= 1) { editor.removeBlocks([id]); return; }
  if (run(editor, id, r, 0, deleteRow)) shiftHeights(store, id, 'delete', r);
}
export function removeColumn(editor, id, c) {
  const block = editor.getBlock(id); if (!block) return;
  if (layout(rowsOf(block)).C <= 1) { editor.removeBlocks([id]); return; }
  run(editor, id, 0, c, deleteColumn);
}
export function merge(editor) { return editor.exec((st, d) => mergeCells(st, d)); }
export function split(editor) { return editor.exec((st, d) => splitCell(st, d)); }

const refuse = () => { say('Split the merged cells first', 'error'); return false; };
export function duplicateRow(editor, store, id, r) {
  const block = editor.getBlock(id); if (!block) return false;
  const rows = rowsOf(block); if (hasSpans(layout(rows).list)) return refuse();
  const copy = rows[r].cells.map((c) => ({ ...c, props: { ...c.props }, content: JSON.parse(JSON.stringify(c.content || [])) }));
  insertRow(editor, store, id, r + 1); // the editor adds the row; its cells are then filled with a copy of this one
  const b2 = editor.getBlock(id); if (!b2) return false;
  const r2 = rowsOf(b2); if (r2.length !== rows.length + 1) return false;
  r2[r + 1] = { ...r2[r + 1], cells: copy };
  put(editor, b2, r2); return true;
}
export function duplicateColumn(editor, id, c) {
  const block = editor.getBlock(id); if (!block) return false;
  const rows = rowsOf(block); if (hasSpans(layout(rows).list)) return refuse();
  const copy = rows.map((row) => { const src = row.cells[c]; return src ? { ...src, props: { ...src.props }, content: JSON.parse(JSON.stringify(src.content || [])) } : null; });
  insertColumn(editor, id, c + 1);
  const b2 = editor.getBlock(id); if (!b2) return false;
  const r2 = rowsOf(b2);
  r2.forEach((row, i) => { if (copy[i] && row.cells[c + 1]) row.cells[c + 1] = copy[i]; });
  put(editor, b2, r2); return true;
}
export function moveRow(editor, store, id, r, dir) {
  const block = editor.getBlock(id); if (!block) return false;
  const rows = rowsOf(block); const to = r + dir;
  if (to < 0 || to >= rows.length) return false;
  if (hasSpans(layout(rows).list)) return refuse();
  [rows[r], rows[to]] = [rows[to], rows[r]];
  const m = store.get(id); if (m?.rh) { const rh = [...m.rh]; while (rh.length < rows.length) rh.push(0); [rh[r], rh[to]] = [rh[to], rh[r]]; store.set(id, { rh }); }
  put(editor, block, rows); return true;
}
export function sortBy(editor, id, c, dir) { // dir 1 = A to Z, -1 = Z to A; header rows stay on top
  const block = editor.getBlock(id); if (!block) return false;
  const rows = rowsOf(block); if (hasSpans(layout(rows).list)) return refuse();
  const skip = block.content.headerRows || 0;
  const body = rows.slice(skip).map((row, i) => ({ row, i, t: cellText(row.cells[c]).trim() }));
  body.sort((a, b) => {
    if (!a.t && !b.t) return a.i - b.i;
    if (!a.t) return 1; if (!b.t) return -1; // empty cells always last
    return dir * a.t.localeCompare(b.t, undefined, { numeric: true, sensitivity: 'base' }) || a.i - b.i;
  });
  put(editor, block, [...rows.slice(0, skip), ...body.map((x) => x.row)]); return true;
}
export function setCells(editor, id, cells, props) {
  const block = editor.getBlock(id); if (!block) return;
  const rows = rowsOf(block);
  cells.forEach(([r, ci]) => { const cell = rows[r]?.cells[ci]; if (cell) Object.assign(cell.props, props); });
  put(editor, block, rows);
}
export function toggleHeader(editor, id, key) { // 'headerRows' | 'headerCols'
  const block = editor.getBlock(id); if (!block) return;
  put(editor, block, rowsOf(block), { [key]: block.content[key] ? undefined : 1 });
}

// ---- widths: one transaction that sets the width on every cell of every column, so a drag is one edit however long it lasted
export function setWidths(editor, id, widths) {
  const t = findTable(editor, id); if (!t) return;
  editor.transact((tr) => {
    const table = tr.doc.nodeAt(t.pos); const map = TableMap.get(table); const seen = new Set();
    for (let r = 0; r < map.height; r++) {
      for (let c = 0; c < map.width; c++) {
        const off = map.map[r * map.width + c];
        if (seen.has(off)) continue; seen.add(off);
        const cell = table.nodeAt(off); const cs = cell.attrs.colspan || 1;
        const cw = Array.from({ length: cs }, (_, k) => Math.round(widths[c + k] || 0));
        tr.setNodeMarkup(t.pos + 1 + off, undefined, { ...cell.attrs, colwidth: cw.some(Boolean) ? cw : null });
      }
    }
  });
}
export function copyCsv(editor, id) {
  const block = editor.getBlock(id); if (!block) return;
  const text = csvOf(block);
  const done = () => say('Table copied as CSV');
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => legacyCopy(text, done));
  else legacyCopy(text, done);
}
function legacyCopy(text, done) {
  const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch { say('Could not copy', 'error'); }
  ta.remove();
}
export const gridSize = (editor, id) => { const b = editor.getBlock(id); if (!b) return { R: 0, C: 0 }; const { R, C } = layout(rowsOf(b)); return { R, C }; };
export { build };
