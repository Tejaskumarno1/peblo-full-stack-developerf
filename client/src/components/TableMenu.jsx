import { useRef, useState } from 'react';
import { Plus, Type, Trash2 } from 'lucide-react';
import { useBlockNoteEditor, useComponentsContext, useExtension, useExtensionState } from '@blocknote/react';
import { TableHandlesExtension } from '@blocknote/core/extensions';
import { SwatchGrid, pushRecent } from './ColorPanel';

// The menu behind a table's row or column grip (mockup G1b): fill the whole row, one cell or the whole column,
// insert, header row, delete. BlockNote keeps the colour on each cell, so a row fill sets every cell in it.
const toCell = (c) => (c && c.type === 'tableCell' ? { ...c, props: { ...(c.props || {}) } } : { type: 'tableCell', props: {}, content: c });
const colLetter = (i) => { let n = i, s = ''; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };

export default function TableMenu({ orientation }) {
  const editor = useBlockNoteEditor();
  const C = useComponentsContext();
  const ext = useExtension(TableHandlesExtension);
  const live = useExtensionState(TableHandlesExtension, { selector: (s) => ({ block: s?.block, rowIndex: s?.rowIndex, colIndex: s?.colIndex }) }) || {};
  const last = useRef(null);
  if (live.block && live.rowIndex !== undefined && live.colIndex !== undefined) last.current = live; // keep the menu open after a fill, when the grips hide
  const [scope, setScope] = useState(orientation === 'row' ? 'row' : 'column');
  const { rowIndex, colIndex } = last.current || {};
  const block = last.current ? (editor.getBlock(last.current.block.id) || last.current.block) : null;
  if (!block || !C || rowIndex === undefined || colIndex === undefined) return null;
  const isRow = orientation === 'row';
  const idx = isRow ? rowIndex : colIndex;
  const rows = block.content.rows;
  const cellAt = (r, c) => rows[r]?.cells?.[c];
  const cur = cellAt(rowIndex, colIndex)?.props?.backgroundColor || 'default';
  const targets = () => {
    const out = [];
    if (scope === 'cell') out.push([rowIndex, colIndex]);
    else if (scope === 'row') rows[rowIndex].cells.forEach((_, c) => out.push([rowIndex, c]));
    else rows.forEach((r, i) => { if (r.cells[colIndex]) out.push([i, colIndex]); });
    return out;
  };
  const fill = (name) => {
    const next = rows.map((r) => ({ ...r, cells: r.cells.map(toCell) }));
    const value = name === cur ? 'default' : name;
    targets().forEach(([r, c]) => { next[r].cells[c].props.backgroundColor = value; });
    editor.updateBlock(block, { type: 'table', content: { ...block.content, rows: next } });
    if (value !== 'default') pushRecent('bg', value);
  };
  const header = isRow ? (block.content.headerRows || 0) > 0 && rowIndex === 0 : (block.content.headerCols || 0) > 0 && colIndex === 0;
  const toggleHeader = () => {
    const key = isRow ? 'headerRows' : 'headerCols';
    editor.updateBlock(block, { type: 'table', content: { ...block.content, rows: rows.map((r) => ({ ...r, cells: r.cells.map(toCell) })), [key]: header ? undefined : 1 } });
  };
  const word = isRow ? 'row' : 'column';
  const side = isRow ? ['above', 'below'] : ['left', 'right'];
  const title = isRow ? `Row ${rowIndex + 1}` : `Column ${colLetter(colIndex)}`;
  const Btn = ({ id, onClick, icon, children, danger }) => <button type="button" className={`pbt-r${danger ? ' danger' : ''}`} data-testid={id} onClick={onClick}>{icon}{children}</button>;
  return (
    <C.Generic.Menu.Dropdown className="bn-menu-dropdown bn-table-handle-menu pb-tmenu">
      <div className="pbt" data-testid="table-menu">
        <div className="pbt-h"><b>{title}</b><span className="pbt-seg" role="tablist">{[['row', 'Row'], ['cell', 'Cell'], ['column', 'Column']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={scope === k} className={scope === k ? 'on' : ''} data-testid={`tm-scope-${k}`} onClick={() => setScope(k)}>{l}</button>)}</span></div>
        <div className="pbt-lbl">Fill the whole {scope}</div>
        <SwatchGrid kind="bg" cur={cur} onPick={fill} />
        <Btn id="tm-ins-a" icon={<Plus size={14} />} onClick={() => ext.addRowOrColumn(idx, { orientation: isRow ? 'row' : 'column', side: side[0] })}>Insert {word} {side[0]}</Btn>
        <Btn id="tm-ins-b" icon={<Plus size={14} />} onClick={() => ext.addRowOrColumn(idx, { orientation: isRow ? 'row' : 'column', side: side[1] })}>Insert {word} {side[1]}</Btn>
        <Btn id="tm-header" icon={<Type size={14} />} onClick={toggleHeader}>Header {word}<span className={`pbt-sw${header ? ' on' : ''}`} /></Btn>
        <Btn id="tm-delete" danger icon={<Trash2 size={14} />} onClick={() => ext.removeRowOrColumn(idx, word)}>Delete {word}</Btn>
      </div>
    </C.Generic.Menu.Dropdown>
  );
}
