import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { layout, toCell, tsvToTable } from '../utils/tableMeta';
import {
  selInfo, selectedCells, insertRow, insertColumn, removeRow, removeColumn, merge, split, duplicateRow, duplicateColumn, moveRow, sortBy,
  setCells, toggleHeader, setWidths, copyCsv, say, gridSize,
} from '../utils/tableOps';
import { SwatchGrid, pushRecent } from './ColorPanel';
import './tableTools.css';

// Table controls drawn over the note (mockup Table.dc): a "+" at every row and column edge, a grip to resize a column or a row,
// a corner to resize the whole table, a toolbar over the table while a cell is selected, a context menu, and status chips.
// Everything is drawn in a layer on the page itself, so it never changes the layout of the note.
const rowsOf = (b) => b.content.rows.map((r) => ({ ...r, cells: r.cells.map(toCell) }));
const colName = (i) => { let n = i; let s = ''; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };
const MIN_COL = 40;
const BORDERS = [undefined, 'grid', 'rows', 'none'];
const BORDER_LABEL = { undefined: 'Default', grid: 'All lines', rows: 'Row lines', none: 'None' };

const Svg = ({ children, size = 18, w = 2 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
const ICON = {
  hrow: <Svg><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18" /></Svg>,
  hcol: <Svg><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></Svg>,
  left: <Svg><path d="M4 6h16M4 10h10M4 14h16M4 18h10" /></Svg>,
  center: <Svg><path d="M4 6h16M7 10h10M4 14h16M7 18h10" /></Svg>,
  right: <Svg><path d="M4 6h16M10 10h10M4 14h16M10 18h10" /></Svg>,
  valign: <Svg><path d="M4 3h16M4 21h16M12 7v10M9 10l3-3 3 3M9 14l3 3 3-3" /></Svg>,
  merge: <Svg><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M8 12h8M10 10l-2 2 2 2M14 10l2 2-2 2" /></Svg>,
  split: <Svg><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M12 5v14" /></Svg>,
  color: <Svg><path d="M5 13l7-8 7 8-7 6z" /><path d="M20 17c0 1.5-1 2.5-1 3.5" /></Svg>,
  sort: <Svg><path d="M5 6h6M5 12h9M5 18h12M18 5v14M15 16l3 3 3-3" /></Svg>,
  dist: <Svg><path d="M4 4v16M12 4v16M20 4v16" /></Svg>,
  zebra: <Svg><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M3 15h18" /></Svg>,
  copy: <Svg><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" /></Svg>,
  trash: <Svg><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></Svg>,
  plus: <Svg size={12} w={3.4}><path d="M12 5v14M5 12h14" /></Svg>,
  grip: <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>,
  corner: <Svg size={10} w={3}><path d="M7 17L17 7M11 17l6-6" /></Svg>,
};

function geoOf(table) {
  const rect = table.getBoundingClientRect();
  let xs = [];
  const cols = [...table.querySelectorAll(':scope > colgroup > col')].map((c) => c.getBoundingClientRect());
  if (cols.length && cols.every((c) => c.width > 0)) { xs = [cols[0].left, ...cols.map((c) => c.right)]; } else {
    const row = [...table.rows].sort((a, b) => b.cells.length - a.cells.length)[0];
    if (row) { const cs = [...row.cells].map((c) => c.getBoundingClientRect()); xs = [cs[0].left, ...cs.map((c) => c.right)]; }
  }
  const trs = [...table.rows].map((tr) => tr.getBoundingClientRect());
  const ys = trs.length ? [trs[0].top, ...trs.map((t) => t.bottom)] : [];
  const cells = [...table.querySelectorAll('td, th')].map((c) => c.getBoundingClientRect());
  return { rect, xs, ys, cells };
}
function edgeAt(g, x, y) {
  const T = 7; let col = null; let row = null;
  if (y >= g.rect.top - 30 && y <= g.rect.bottom + 4) g.xs.forEach((bx, j) => { if (Math.abs(bx - x) <= T && (col === null || Math.abs(bx - x) < Math.abs(g.xs[col] - x))) col = j; });
  if (x >= g.rect.left - 44 && x <= g.rect.right + 4) g.ys.forEach((by, i) => { if (Math.abs(by - y) <= T && (row === null || Math.abs(by - y) < Math.abs(g.ys[row] - y))) row = i; });
  if (col !== null && row !== null) { if (Math.abs(g.xs[col] - x) <= Math.abs(g.ys[row] - y)) row = null; else col = null; }
  // an edge that runs through the middle of a merged cell is not a border there: no grip, no drag
  const colCross = col !== null && g.cells.some((c) => c.left + 4 < g.xs[col] && g.xs[col] < c.right - 4 && c.top <= y && y <= c.bottom);
  const rowCross = row !== null && g.cells.some((c) => c.top + 4 < g.ys[row] && g.ys[row] < c.bottom - 4 && c.left <= x && x <= c.right);
  return { col, row, colCross, rowCross };
}
// the box the note scrolls in (the toolbar and chips stay inside what is visible of it)
const scroller = (el) => { for (let p = el; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight + 1) return p; } return null; };
const idOf = (table) => table?.closest('.bn-block-outer')?.getAttribute('data-id') || null;

// a menu row. It lives outside TableTools: a component made inside it is a new component on every redraw, and a redraw between press and release lost the click
const MenuItem = ({ id, children, hint, onClick, danger, check, done }) => <button type="button" role="menuitem" className={`it${danger ? ' danger' : ''}`} data-testid={`cm-${id}`} onClick={done(onClick)}>{children}{check !== undefined && <span className={`pbtt-chk${check ? ' on' : ''}`} />}{hint && <span className="hint">{hint}</span>}</button>;

export default function TableTools({ editor, rootRef, store, editable, dark, onEdited }) {
  const [, setN] = useState(0);
  const tick = () => setN((n) => n + 1);
  const [hover, setHover] = useState(null); // { table, x, y }
  const [sel, setSel] = useState(null);
  const [drag, setDrag] = useState(null);
  const [menu, setMenu] = useState(null);
  const [pop, setPop] = useState(false);
  const live = useRef({ hover: null, drag: null });
  live.current.hover = hover; live.current.drag = drag;
  const layer = useRef(null);

  useEffect(() => {
    if (!editable) return undefined;
    const offs = [];
    try { offs.push(editor.onSelectionChange(() => { setSel(selInfo(editor)); setPop(false); })); } catch { /* old editor */ }
    try { offs.push(editor.onChange(() => tick())); } catch { /* old editor */ }
    const un = store.subscribe(() => tick());
    const t = () => tick();
    window.addEventListener('scroll', t, true); window.addEventListener('resize', t);
    document.addEventListener('focusin', t); document.addEventListener('focusout', t);
    return () => { offs.forEach((o) => { try { o?.(); } catch { /* gone */ } }); un(); window.removeEventListener('scroll', t, true); window.removeEventListener('resize', t); document.removeEventListener('focusin', t); document.removeEventListener('focusout', t); };
  }, [editor, store, editable]);

  // ---- column, row and whole-table dragging. The columns follow the pointer on the page; the note is written once, when the pointer is let go.
  const colsOf = (table) => [...table.querySelectorAll(':scope > colgroup > col')];
  // While a border is dragged the widths are drawn by a style sheet of this component, not on the columns themselves: the editor writes the
  // saved widths back onto the columns whenever the document is touched, and in a live note that is every few milliseconds (other people's cursors).
  // Written on the columns the drag would stutter and snap back; a rule with !important is not touched by that.
  const paint = (table, cols, ws) => {
    let s = document.getElementById('pb-table-drag'); if (!s) { s = document.createElement('style'); s.id = 'pb-table-drag'; document.head.appendChild(s); }
    const id = idOf(table); const sel = `.bn-block-outer[data-id="${id}"] table`;
    s.textContent = `${sel}{width:${ws.reduce((a, b) => a + b, 0)}px !important;min-width:0 !important;table-layout:fixed !important}` + ws.map((w, i) => `${sel} > colgroup > col:nth-child(${i + 1}){width:${w}px !important}`).join('');
  };
  const unpaint = () => { document.getElementById('pb-table-drag')?.remove(); };
  const widths = (id, ws) => { setWidths(editor, id, ws); onEdited?.(); }; // a width change is not a typed edit: tell the note to save
  const track = (onMove, onUp) => {
    const up = (e) => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up); onUp(e); };
    document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
  };
  // In a live note the table's elements can be replaced between the pointer reaching a handle and pressing on it: find the table again by its id.
  const ids = useRef(new WeakMap());
  const fresh = (t) => { const id = idOf(t) || ids.current.get(t); const n = id && rootRef.current ? rootRef.current.querySelector(`.bn-block-outer[data-id="${id}"] table`) : null; if (n && id) ids.current.set(n, id); return n || t; };
  const dragCol = (table0, j, startX) => {
    const table = fresh(table0); const id = idOf(table); const cols = colsOf(table); if (!id || !cols.length || j < 1) return;
    const ws0 = cols.map((c) => c.getBoundingClientRect().width); if (ws0.some((w) => !w)) return;
    const k = j - 1; let ws = ws0;
    setDrag({ kind: 'col', table, id, k, w: Math.round(ws0[k]), j });
    track((e) => { const w = Math.max(MIN_COL, Math.min(3000, ws0[k] + e.clientX - startX)); ws = ws0.map((x, i) => (i === k ? w : x)); paint(table, cols, ws); setDrag((d) => d && { ...d, w: Math.round(w) }); },
      () => { widths(id, ws.map((w) => Math.round(w))); requestAnimationFrame(unpaint); setDrag(null); });
  };
  const dragRow = (table0, i, startY) => {
    const table = fresh(table0); const id = idOf(table); const tr = table.rows[i - 1]; const block = id && editor.getBlock(id); if (!block || !tr) return;
    const h0 = tr.getBoundingClientRect().height; let h = h0;
    setDrag({ kind: 'row', table, id, h: Math.round(h0), i });
    track((e) => { h = Math.max(24, Math.min(1200, h0 + e.clientY - startY)); setDrag((d) => d && { ...d, h: Math.round(h) }); },
      () => { const { R } = layout(rowsOf(block)); const rh = Array.from({ length: R }, (_, r) => store.get(id)?.rh?.[r] || 0); rh[i - 1] = Math.round(h); store.set(id, { rh }); setDrag(null); });
  };
  const dragTable = (table0, startX) => {
    const table = fresh(table0); const id = idOf(table); const cols = colsOf(table); if (!id || !cols.length) return;
    const ws0 = cols.map((c) => c.getBoundingClientRect().width); if (ws0.some((w) => !w)) return;
    const total0 = ws0.reduce((a, b) => a + b, 0); let ws = ws0;
    setDrag({ kind: 'table', table, id, w: Math.round(total0) });
    track((e) => { const f = Math.max((MIN_COL * ws0.length) / total0, (total0 + e.clientX - startX) / total0); ws = ws0.map((w) => Math.max(MIN_COL, w * f)); paint(table, cols, ws); setDrag((d) => d && { ...d, w: Math.round(ws.reduce((a, b) => a + b, 0)) }); },
      () => { widths(id, ws.map((w) => Math.round(w))); requestAnimationFrame(unpaint); setDrag(null); });
  };

  // ---- the pointer: which table it is near, and which edge of it
  useEffect(() => {
    if (!editable) return undefined;
    const root = rootRef.current; if (!root) return undefined;
    let raf = 0; let last = null;
    const run = () => {
      raf = 0; const e = last; if (!e || live.current.drag) return;
      const tgt = e.target;
      if (tgt?.closest?.('.pbtt')) return; // on one of the controls: leave them as they are
      let table = tgt?.closest && root.contains(tgt) ? tgt.closest('table') : null;
      if (!table && live.current.hover?.table?.isConnected) {
        const r = live.current.hover.table.getBoundingClientRect();
        if (e.clientX >= r.left - 46 && e.clientX <= r.right + 16 && e.clientY >= r.top - 34 && e.clientY <= r.bottom + 16) table = live.current.hover.table;
      }
      if (table) ids.current.set(table, idOf(table));
      setHover((h) => (table ? { table, x: e.clientX, y: e.clientY } : h ? null : h));
    };
    const move = (e) => { last = e; if (!raf) raf = requestAnimationFrame(run); };
    document.addEventListener('pointermove', move, { passive: true });
    // The editor's own column drag moves the table a little on every frame; ours takes over from the same spot.
    const down = (e) => {
      if (e.button !== 0) return;
      const table = e.target?.closest?.('table'); if (!table || !root.contains(table)) return;
      const g = geoOf(table); const { col, colCross } = edgeAt(g, e.clientX, e.clientY);
      if (col !== null && !colCross && col >= 1 && e.clientY >= g.rect.top && e.clientY <= g.rect.bottom) { e.preventDefault(); e.stopImmediatePropagation(); dragCol(table, col, e.clientX); }
    };
    root.addEventListener('mousedown', down, true);
    const ctx = (e) => {
      const cell = e.target?.closest?.('td, th'); const table = cell?.closest('table'); if (!cell || !table || !root.contains(table)) return;
      const id = idOf(table); const block = id && editor.getBlock(id); if (!block) return;
      e.preventDefault();
      const tr = cell.parentElement; const r = tr.rowIndex; const ci = cell.cellIndex;
      const { list } = layout(rowsOf(block));
      const x = list.filter((q) => q.r === r).sort((a, b) => a.c - b.c)[ci];
      setMenu({ x: e.clientX, y: e.clientY, id, r, ci, c: x ? x.c : ci });
    };
    root.addEventListener('contextmenu', ctx);
    // Excel, Google Sheets and terminals put tab separated text on the clipboard: that becomes a table
    const paste = (e) => {
      const dt = e.clipboardData; if (!dt || (dt.types || []).includes('Files')) return;
      if (dt.getData('text/html').trim() && /<table/i.test(dt.getData('text/html'))) return; // the editor already makes a table from that
      if (selInfo(editor)) return; // pasting inside a table: the editor fills the cells
      const t = tsvToTable(dt.getData('text/plain')); if (!t) return;
      e.preventDefault(); e.stopPropagation();
      try {
        const cur = editor.getTextCursorPosition().block;
        const empty = cur.type === 'paragraph' && (!cur.content || !cur.content.length || (cur.content.length === 1 && !(cur.content[0].text || '').trim()));
        if (cur.type === 'table') { editor.insertBlocks([t], cur, 'after'); } else { editor.insertBlocks([t], cur, 'after'); if (empty) editor.removeBlocks([cur]); }
      } catch { /* no place to put it */ }
    };
    root.addEventListener('paste', paste, true);
    // Alt Up / Alt Down inside a table add a row above / below (the mockup's menu); elsewhere they still move the block
    const key = (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      if (!root.contains(document.activeElement)) return;
      const info = selInfo(editor); if (!info) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const block = editor.getBlock(info.id); if (!block) return;
      insertRow(editor, store, info.id, e.key === 'ArrowUp' ? info.r : info.r + 1);
    };
    document.addEventListener('keydown', key, true);
    return () => { cancelAnimationFrame(raf); document.removeEventListener('pointermove', move); root.removeEventListener('mousedown', down, true); root.removeEventListener('contextmenu', ctx); root.removeEventListener('paste', paste, true); document.removeEventListener('keydown', key, true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, editable, store]);

  useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => { if (e.type === 'keydown' && e.key !== 'Escape') return; if (e.type === 'pointerdown' && e.target?.closest?.('.pbtt-menu')) return; setMenu(null); };
    document.addEventListener('pointerdown', close, true); document.addEventListener('keydown', close, true); window.addEventListener('scroll', close, true); window.addEventListener('resize', close);
    return () => { document.removeEventListener('pointerdown', close, true); document.removeEventListener('keydown', close, true); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [menu]);

  if (!editable || typeof document === 'undefined') return null;
  const root = rootRef.current;
  const find = (id) => (root && id ? root.querySelector(`.bn-block-outer[data-id="${id}"] table`) : null);
  const focused = !!root && root.contains(document.activeElement);
  const th = dark ? 'dark' : 'light';

  // ---- hover handles
  const hv = hover && hover.table?.isConnected && !drag ? hover : null;
  let hoverUi = null;
  if (hv) {
    const g = geoOf(hv.table); const id = idOf(hv.table); const e = edgeAt(g, hv.x, hv.y);
    const insideRows = hv.y >= g.rect.top && hv.y <= g.rect.bottom; const insideCols = hv.x >= g.rect.left && hv.x <= g.rect.right;
    const C = g.xs.length - 1;
    hoverUi = (
      <>
        {e.col !== null && (
          <>
            <button type="button" className="pbtt-pl" style={{ left: g.xs[e.col] - 12, top: g.rect.top - 12 }} aria-label={e.col === 0 ? 'Add a column at the start' : e.col === C ? 'Add a column at the end' : `Add a column after ${colName(e.col - 1)}`} data-testid="tt-add-col" onMouseDown={(ev) => ev.preventDefault()} onClick={() => { insertColumn(editor, id, e.col); setHover(null); }}>{ICON.plus}</button>
            {e.col >= 1 && insideRows && !e.colCross && <div className="pbtt-vl" style={{ left: g.xs[e.col] - 1.5, top: g.rect.top - 2, height: g.rect.height + 4 }} />}
            {e.col >= 1 && insideRows && !e.colCross && <div className="pbtt-vgrip" role="separator" aria-label="Drag to resize column" data-testid="tt-col-grip" style={{ left: g.xs[e.col] - 10, top: Math.min(g.rect.bottom - 42, Math.max(g.rect.top + 2, hv.y - 20)) }} onPointerDown={(ev) => { ev.preventDefault(); dragCol(hv.table, e.col, ev.clientX); }}><i /><i /></div>}
          </>
        )}
        {e.row !== null && (
          <>
            <button type="button" className="pbtt-pl" style={{ left: Math.max(4, g.rect.left - 38), top: g.ys[e.row] - 12 }} aria-label={e.row === 0 ? 'Add a row at the top' : `Add a row after row ${e.row}`} data-testid="tt-add-row" onMouseDown={(ev) => ev.preventDefault()} onClick={() => { insertRow(editor, store, id, e.row); setHover(null); }}>{ICON.plus}</button>
            <div className="pbtt-stub" style={{ left: Math.max(2, g.rect.left - 28), top: g.ys[e.row] - 1, width: 60 }} />
            {e.row >= 1 && insideCols && !e.rowCross && <div className="pbtt-hl" style={{ left: g.rect.left - 2, top: g.ys[e.row] - 1.5, width: g.rect.width + 4 }} />}
            {e.row >= 1 && insideCols && !e.rowCross && <div className="pbtt-hgrip" role="separator" aria-label="Drag to resize row" data-testid="tt-row-grip" style={{ top: g.ys[e.row] - 10, left: Math.min(g.rect.right - 42, Math.max(g.rect.left + 2, hv.x - 20)) }} onPointerDown={(ev) => { ev.preventDefault(); dragRow(hv.table, e.row, ev.clientY); }}><i /><i /></div>}
          </>
        )}
        <div className="pbtt-corner" role="button" aria-label="Drag to resize the table" data-testid="tt-corner" style={{ left: g.rect.right - 9, top: g.rect.bottom - 9 }} onPointerDown={(ev) => { ev.preventDefault(); dragTable(hv.table, ev.clientX); }}>{ICON.corner}</div>
      </>
    );
  }

  // ---- while dragging: guide line and the size
  let dragUi = null;
  if (drag && drag.table?.isConnected) {
    const g = geoOf(drag.table);
    if (drag.kind === 'col') {
      const x = g.xs[drag.j];
      dragUi = (<>
        <div className="pbtt-vl on" style={{ left: x - 1.5, top: g.rect.top - 2, height: g.rect.height + 4 }} />
        <div className="pbtt-label" style={{ left: g.xs[drag.k], top: g.rect.top - 30, width: Math.max(90, x - g.xs[drag.k]) }}>Column {colName(drag.k)} &nbsp;·&nbsp; {drag.w} px</div>
        <div className="pbtt-px" style={{ left: x + 8, top: g.rect.top + 8 }}>{drag.w} px</div>
      </>);
    } else if (drag.kind === 'row') {
      const y = g.ys[drag.i];
      dragUi = (<>
        <div className="pbtt-hl on" style={{ left: g.rect.left - 2, top: y - 1.5, width: g.rect.width + 4 }} />
        <div className="pbtt-px" style={{ left: g.rect.left + 8, top: y + 8 }}>{drag.h} px</div>
      </>);
    } else {
      dragUi = <div className="pbtt-px" style={{ left: g.rect.right - 70, top: g.rect.bottom + 14 }}>{drag.w} px wide</div>;
    }
  }

  // ---- toolbar and chips for the table the cursor is in
  let bar = null;
  const cur = sel && focused && !drag ? sel : null;
  const table = cur ? find(cur.id) : null;
  const block = cur && table ? editor.getBlock(cur.id) : null;
  if (block && table && root) {
    const sc = scroller(root); const rr = sc ? sc.getBoundingClientRect() : { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth }; const tr = table.getBoundingClientRect(); const vis = Math.max(rr.top, 0); const bot = Math.min(rr.bottom, window.innerHeight);
    if (tr.bottom > vis + 20 && tr.top < bot - 20) {
      const meta = store.get(cur.id) || {}; const ct = block.content;
      const { list, R, C } = layout(rowsOf(block));
      const here = list.find((x) => x.r === cur.r && list.filter((q) => q.r === cur.r).sort((a, b) => a.c - b.c).indexOf(x) === cur.ci);
      const al = here?.cell.props?.textAlignment || 'left';
      const spanned = !!here && (here.cs > 1 || here.rs > 1);
      const top = Math.max(vis + 6, Math.min(tr.top - 56, bot - 120)); const box = root.getBoundingClientRect(); const wl = (table.closest('.tableWrapper') || table).getBoundingClientRect().left; const left = Math.max(box.left + 4, Math.min(wl, Math.max(box.left + 4, Math.min(box.right, window.innerWidth) - 580)));
      const B = ({ id, label, icon, on, off, onClick, danger }) => (
        <button type="button" className={`tb${on ? ' on' : ''}${danger ? ' danger' : ''}`} aria-label={label} title={label} aria-pressed={on === undefined ? undefined : !!on} disabled={off} data-testid={`tt-${id}`} onMouseDown={(ev) => ev.preventDefault()} onClick={onClick}>{icon}</button>
      );
      const aim = () => selectedCells(editor, selInfo(editor) || cur);
      const nextV = { undefined: 'middle', middle: 'bottom', bottom: undefined };
      const setColor = (key, name) => { const prev = here?.cell.props?.[key] || 'default'; setCells(editor, cur.id, aim(), { [key]: name === prev ? 'default' : name }); if (name !== 'default') pushRecent(key === 'backgroundColor' ? 'bg' : 'text', name); };
      bar = (
        <>
          <div className={`pbtt-bar ${th}`} style={{ left, top }} role="toolbar" aria-label="Table" data-testid="table-toolbar">
            {B({ id: 'hrow', label: 'Header row', icon: ICON.hrow, on: ct.headerRows > 0, onClick: () => toggleHeader(editor, cur.id, 'headerRows') })}
            {B({ id: 'hcol', label: 'Header column', icon: ICON.hcol, on: ct.headerCols > 0, onClick: () => toggleHeader(editor, cur.id, 'headerCols') })}
            <span className="sep" />
            {B({ id: 'al-left', label: 'Align left', icon: ICON.left, on: al === 'left', onClick: () => setCells(editor, cur.id, aim(), { textAlignment: 'left' }) })}
            {B({ id: 'al-center', label: 'Align center', icon: ICON.center, on: al === 'center', onClick: () => setCells(editor, cur.id, aim(), { textAlignment: 'center' }) })}
            {B({ id: 'al-right', label: 'Align right', icon: ICON.right, on: al === 'right', onClick: () => setCells(editor, cur.id, aim(), { textAlignment: 'right' }) })}
            {B({ id: 'valign', label: `Vertical align: ${meta.va || 'top'}`, icon: ICON.valign, on: !!meta.va, onClick: () => store.set(cur.id, { va: nextV[meta.va] }) })}
            <span className="sep" />
            {B({ id: 'merge', label: 'Merge cells', icon: ICON.merge, off: cur.n < 2, onClick: () => merge(editor) })}
            {B({ id: 'split', label: 'Split cell', icon: ICON.split, off: !spanned, onClick: () => split(editor) })}
            {B({ id: 'color', label: 'Cell color and text color', icon: ICON.color, on: pop, onClick: () => setPop((p) => !p) })}
            {B({ id: 'sort', label: 'Sort A to Z (again for Z to A)', icon: ICON.sort, onClick: () => { const k = `${cur.id}:${here?.c}`; const d = live.current.sortKey === k && live.current.sortDir === 1 ? -1 : 1; if (here && sortBy(editor, cur.id, here.c, d)) { live.current.sortKey = k; live.current.sortDir = d; say(d === 1 ? 'Sorted A to Z' : 'Sorted Z to A'); } } })}
            <span className="sep" />
            {B({ id: 'distribute', label: 'Distribute columns evenly', icon: ICON.dist, onClick: () => { const w = table.getBoundingClientRect().width; widths(cur.id, Array.from({ length: C }, () => Math.max(MIN_COL, Math.round(w / C)))); } })}
            {B({ id: 'zebra', label: 'Zebra stripes', icon: ICON.zebra, on: !!meta.z, onClick: () => store.set(cur.id, { z: meta.z ? 0 : 1 }) })}
            {B({ id: 'csv', label: 'Copy as CSV', icon: ICON.copy, onClick: () => copyCsv(editor, cur.id) })}
            <span className="sep" />
            {B({ id: 'delete', label: 'Delete table', icon: ICON.trash, danger: true, onClick: () => { editor.removeBlocks([cur.id]); setSel(null); } })}
            {pop && (
              <div className="pbtt-pop" data-testid="tt-color-pop">
                <div className="pbtt-lbl">Cell color</div>
                <SwatchGrid kind="bg" cur={here?.cell.props?.backgroundColor || 'default'} onPick={(n) => setColor('backgroundColor', n)} />
                <div className="pbtt-lbl">Text color</div>
                <SwatchGrid kind="text" cur={here?.cell.props?.textColor || 'default'} onPick={(n) => setColor('textColor', n)} />
              </div>
            )}
          </div>
          <div className={`pbtt-chips ${th}`} style={{ left: Math.max(box.left + 8, left), top: Math.min(bot, window.innerHeight - 70) - 38 }} data-testid="table-chips">
            <span>{R} {R === 1 ? 'row' : 'rows'}, {C} {C === 1 ? 'column' : 'columns'}</span>
            {cur.n > 1 && <span>{cur.n} cells selected</span>}
            <span>Tab moves right, Enter moves down, Ctrl+Z undoes</span>
          </div>
        </>
      );
    }
  }

  // ---- context menu
  let ctxUi = null;
  if (menu) {
    const blockM = editor.getBlock(menu.id); const tableM = find(menu.id);
    if (blockM && tableM) {
      const meta = store.get(menu.id) || {}; const { R, C } = gridSize(editor, menu.id);
      const done = (fn) => () => { setMenu(null); fn(); };
      const fit = () => {
        const g = tableM.closest('.bn-block-content')?.clientWidth || tableM.parentElement.clientWidth; const cols = [...tableM.querySelectorAll(':scope > colgroup > col')].map((c) => c.getBoundingClientRect().width);
        const sum = cols.reduce((a, b) => a + b, 0) || 1; widths(menu.id, cols.map((w) => Math.max(MIN_COL, Math.floor((w / sum) * (g - 2)))));
      };
      const x = Math.min(menu.x, window.innerWidth - 250); const y = Math.max(6, Math.min(menu.y, window.innerHeight - 580));
      ctxUi = (
        <div className={`pbtt-menu ${th}`} role="menu" aria-label="Table cell" style={{ left: x, top: y }} data-testid="table-context-menu">
          <MenuItem done={done} id="row-above" hint="Alt+Up" onClick={() => insertRow(editor, store, menu.id, menu.r)}>Insert row above</MenuItem>
          <MenuItem done={done} id="row-below" hint="Alt+Down" onClick={() => insertRow(editor, store, menu.id, menu.r + 1)}>Insert row below</MenuItem>
          <MenuItem done={done} id="col-left" onClick={() => insertColumn(editor, menu.id, menu.c)}>Insert column left</MenuItem>
          <MenuItem done={done} id="col-right" onClick={() => insertColumn(editor, menu.id, menu.c + 1)}>Insert column right</MenuItem>
          <div className="div" />
          <MenuItem done={done} id="dup-row" onClick={() => duplicateRow(editor, store, menu.id, menu.r)}>Duplicate row</MenuItem>
          <MenuItem done={done} id="dup-col" onClick={() => duplicateColumn(editor, menu.id, menu.c)}>Duplicate column</MenuItem>
          <MenuItem done={done} id="move-up" onClick={() => moveRow(editor, store, menu.id, menu.r, -1)}>Move row up</MenuItem>
          <MenuItem done={done} id="move-down" onClick={() => moveRow(editor, store, menu.id, menu.r, 1)}>Move row down</MenuItem>
          <div className="div" />
          <MenuItem done={done} id="fit" onClick={fit}>Fit columns to width</MenuItem>
          <MenuItem done={done} id="freeze" check={!!meta.fh} onClick={() => store.set(menu.id, { fh: meta.fh ? 0 : 1 })}>Freeze header row</MenuItem>
          <MenuItem done={done} id="borders" hint={BORDER_LABEL[meta.b]} onClick={() => store.set(menu.id, { b: BORDERS[(BORDERS.indexOf(meta.b) + 1) % BORDERS.length] })}>Borders</MenuItem>
          <MenuItem done={done} id="sort-az" onClick={() => sortBy(editor, menu.id, menu.c, 1)}>Sort column A to Z</MenuItem>
          <MenuItem done={done} id="sort-za" onClick={() => sortBy(editor, menu.id, menu.c, -1)}>Sort column Z to A</MenuItem>
          <div className="div" />
          <MenuItem done={done} id="del-row" danger onClick={() => removeRow(editor, store, menu.id, menu.r)}>Delete row{R <= 1 ? ' (removes the table)' : ''}</MenuItem>
          <MenuItem done={done} id="del-col" danger onClick={() => removeColumn(editor, menu.id, menu.c)}>Delete column{C <= 1 ? ' (removes the table)' : ''}</MenuItem>
        </div>
      );
    }
  }

  return createPortal(<div className="pbtt" ref={layer}>{hoverUi}{dragUi}{bar}{ctxUi}</div>, document.body);
}
