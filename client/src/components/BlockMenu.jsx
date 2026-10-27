import { useBlockNoteEditor, useComponentsContext, useExtensionState } from '@blocknote/react';
import { SideMenuExtension } from '@blocknote/core/extensions';
import { Type, Highlighter, AlignLeft, Copy, ArrowUpDown, Trash2, ChevronUp, ChevronDown } from 'lucide-react';

// The menu behind a block's handle (mockup B5): Turn into, Colour, Highlight, Align, Duplicate, Move up or down, Delete. One menu, no extra panel.
const TEXT = [['default', '#241F1A', 'Black'], ['red', '#e11d48', 'Red'], ['orange', '#ea580c', 'Orange'], ['green', '#16a34a', 'Green'], ['blue', '#0e7490', 'Teal'], ['purple', '#7c3aed', 'Violet']];
const FILL = [['yellow', '#FFE9A6', 'Yellow'], ['orange', '#FFD9C4', 'Peach'], ['green', '#CDEBD9', 'Mint'], ['blue', '#CFE5F8', 'Sky'], ['purple', '#DDD8FF', 'Lilac']];
const TURN = [
  ['Text', { type: 'paragraph' }], ['Heading 1', { type: 'heading', props: { level: 1 } }], ['Heading 2', { type: 'heading', props: { level: 2 } }], ['Heading 3', { type: 'heading', props: { level: 3 } }],
  ['Bullet list', { type: 'bulletListItem' }], ['Numbered list', { type: 'numberedListItem' }], ['Checklist', { type: 'checkListItem' }], ['Quote', { type: 'quote' }], ['Code', { type: 'codeBlock' }],
];
const clone = (b) => ({ type: b.type, props: b.props, content: b.content, children: (b.children || []).map(clone) });

export default function BlockMenu() {
  const editor = useBlockNoteEditor();
  const C = useComponentsContext();
  const block = useExtensionState(SideMenuExtension, { editor, selector: (s) => s?.block });
  if (!block || !C) return null;
  const has = (k) => block.props && Object.prototype.hasOwnProperty.call(block.props, k);
  const set = (props) => editor.updateBlock(block, { props });
  const text = has('textColor') ? block.props.textColor : null;
  const fill = has('backgroundColor') ? block.props.backgroundColor : null;
  const align = has('textAlignment') ? block.props.textAlignment : null;
  const turnable = ['paragraph', 'heading', 'bulletListItem', 'numberedListItem', 'checkListItem', 'quote', 'codeBlock', 'toggleListItem'].includes(block.type);
  const move = (dir) => { try { editor.setTextCursorPosition(block); if (dir < 0) editor.moveBlocksUp(); else editor.moveBlocksDown(); } catch { /* at the edge */ } };
  const Sw = ({ list, cur, on }) => list.map(([name, hex, tip]) => (
    <button key={name} type="button" className={`sw${cur === name ? ' on' : ''}`} style={{ background: hex }} title={tip} aria-label={tip} aria-pressed={cur === name} data-testid={`bm-${tip.toLowerCase()}`} onClick={() => on(cur === name ? 'default' : name)} />
  ));
  return (
    <C.Generic.Menu.Dropdown className="bn-menu-dropdown bn-drag-handle-menu pb-block-menu">
      {turnable && (
        <C.Generic.Menu.Root position="right" sub>
          <C.Generic.Menu.Trigger sub>
            <C.Generic.Menu.Item className="bn-menu-item" subTrigger icon={<Type size={16} />}>Turn into</C.Generic.Menu.Item>
          </C.Generic.Menu.Trigger>
          <C.Generic.Menu.Dropdown sub className="bn-menu-dropdown">
            {TURN.map(([label, spec]) => (
              <C.Generic.Menu.Item key={label} className="bn-menu-item" onClick={() => editor.updateBlock(block, spec)}>{label}</C.Generic.Menu.Item>
            ))}
          </C.Generic.Menu.Dropdown>
        </C.Generic.Menu.Root>
      )}
      {text !== null && <div className="pb-bm-row" data-testid="bm-colour-row"><Highlighter size={16} /><span className="lab">Colour</span><Sw list={TEXT} cur={text} on={(v) => set({ textColor: v })} /></div>}
      {fill !== null && <div className="pb-bm-row" data-testid="bm-highlight-row"><Highlighter size={16} /><span className="lab">Highlight</span><Sw list={FILL} cur={fill} on={(v) => set({ backgroundColor: v })} /></div>}
      {align !== null && (
        <div className="pb-bm-row" data-testid="bm-align-row"><AlignLeft size={16} /><span className="lab">Align</span>
          <span className="seg">{[['left', 'L'], ['center', 'C'], ['right', 'R']].map(([v, l]) => <button key={v} type="button" className={align === v ? 'on' : ''} aria-label={`Align ${v}`} data-testid={`bm-align-${v}`} onClick={() => set({ textAlignment: v })}>{l}</button>)}</span>
        </div>
      )}
      <C.Generic.Menu.Item className="bn-menu-item" icon={<Copy size={16} />} onClick={() => editor.insertBlocks([clone(block)], block, 'after')}>Duplicate</C.Generic.Menu.Item>
      <div className="pb-bm-row" data-testid="bm-move-row"><ArrowUpDown size={16} /><span className="lab wide">Move up or down</span>
        <button type="button" className="mv" aria-label="Move up" data-testid="bm-up" onClick={() => move(-1)}><ChevronUp size={15} /></button>
        <button type="button" className="mv" aria-label="Move down" data-testid="bm-down" onClick={() => move(1)}><ChevronDown size={15} /></button>
      </div>
      <C.Generic.Menu.Item className="bn-menu-item pb-bm-del" icon={<Trash2 size={16} />} onClick={() => editor.removeBlocks([block])}>Delete</C.Generic.Menu.Item>
    </C.Generic.Menu.Dropdown>
  );
}
