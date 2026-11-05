import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBlockNoteEditor, useComponentsContext, useSelectedBlocks } from '@blocknote/react';
import { Type, Heading1, Heading2, Heading3, Heading4, Heading5, Heading6, List, ListOrdered, ListChecks, ChevronRight, ChevronDown, Quote, Code2, Table2, Image as ImageIcon } from 'lucide-react';

// The block type menu on the selection toolbar (mockup "Editor toolbar block menu"): a grouped icon grid with a type-to-filter box,
// the current type highlighted, and the rarely used types (Heading 4 to 6, toggle headings) behind "More".
const H = (level, toggle) => ({ type: 'heading', props: { level, isToggleable: !!toggle } });
const GROUPS = [
  { name: 'Text', items: [
    { id: 'paragraph', label: 'Text', icon: Type, to: { type: 'paragraph', props: {} } },
    { id: 'h1', label: 'Heading 1', icon: Heading1, to: H(1) },
    { id: 'h2', label: 'Heading 2', icon: Heading2, to: H(2) },
    { id: 'h3', label: 'Heading 3', icon: Heading3, to: H(3) },
  ] },
  { name: 'Lists', items: [
    { id: 'bullet', label: 'Bullets', icon: List, to: { type: 'bulletListItem', props: {} } },
    { id: 'numbered', label: 'Numbered', icon: ListOrdered, to: { type: 'numberedListItem', props: {} } },
    { id: 'check', label: 'Check list', icon: ListChecks, to: { type: 'checkListItem', props: {} } },
    { id: 'toggle', label: 'Toggle', icon: ChevronRight, to: { type: 'toggleListItem', props: {} } },
  ] },
  { name: 'Blocks', items: [
    { id: 'quote', label: 'Quote', icon: Quote, to: { type: 'quote', props: {} } },
    { id: 'code', label: 'Code', icon: Code2, to: { type: 'codeBlock', props: {} } },
    { id: 'table', label: 'Table', icon: Table2, insert: 'table' },
    { id: 'picture', label: 'Picture', icon: ImageIcon, insert: 'picture' },
  ] },
];
const MORE = [
  { id: 'h4', label: 'Heading 4', icon: Heading4, to: H(4) },
  { id: 'h5', label: 'Heading 5', icon: Heading5, to: H(5) },
  { id: 'h6', label: 'Heading 6', icon: Heading6, to: H(6) },
  { id: 'th1', label: 'Toggle heading 1', icon: Heading1, to: H(1, true) },
  { id: 'th2', label: 'Toggle heading 2', icon: Heading2, to: H(2, true) },
  { id: 'th3', label: 'Toggle heading 3', icon: Heading3, to: H(3, true) },
];
const ALL = [...GROUPS.flatMap((g) => g.items), ...MORE];

const matches = (item, block) => {
  if (!item.to || !block) return false;
  if (block.type !== item.to.type) return false;
  if (item.to.type === 'heading') return (block.props.level || 1) === item.to.props.level && !!block.props.isToggleable === !!item.to.props.isToggleable;
  return true;
};
export const currentItem = (blocks) => (blocks && blocks.length ? ALL.find((i) => matches(i, blocks[0])) : null);

const tableBlock = () => ({ type: 'table', content: { type: 'tableContent', rows: [0, 1, 2].map(() => ({ cells: ['', '', ''] })) } });

export function BlockMenu({ onPicture }) {
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext();
  const blocks = useSelectedBlocks(editor);
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef(null);
  const pop = useRef(null);
  const [at, setAt] = useState({ left: 8, top: 8 });
  // The menu is drawn on the page itself (a portal), because the floating toolbar clips anything that hangs out of it.
  useLayoutEffect(() => {
    if (!open || !box.current) return;
    const r = box.current.getBoundingClientRect(); const h = pop.current ? pop.current.offsetHeight : 380; const w = pop.current ? pop.current.offsetWidth : 340;
    const below = r.bottom + 8; const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - 8 - h) : below;
    setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), top });
  }, [open, more, q]);
  const cur = currentItem(blocks);
  const Cur = cur ? cur.icon : Type;
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if ((box.current && box.current.contains(e.target)) || (pop.current && pop.current.contains(e.target))) return; setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', away, true); document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', away, true); document.removeEventListener('keydown', esc, true); };
  }, [open]);
  const query = q.trim().toLowerCase();
  const found = useMemo(() => (query ? ALL.filter((i) => i.label.toLowerCase().includes(query) || i.id.includes(query)) : null), [query]);
  const apply = (item) => {
    setOpen(false); setQ('');
    try {
      if (item.insert === 'table') { const last = blocks[blocks.length - 1]; editor.insertBlocks([tableBlock()], last, 'after'); return; }
      if (item.insert === 'picture') { onPicture?.(blocks[blocks.length - 1]); return; }
      editor.focus();
      for (const b of blocks) editor.updateBlock(b, item.to);
    } catch { /* that block cannot become this type */ }
  };
  const Cell = ({ item }) => {
    const Icon = item.icon;
    const on = cur && cur.id === item.id;
    return (
      <button type="button" className={`pb-bm-cell${on ? ' on' : ''}`} data-testid={`bm-${item.id}`} aria-pressed={on} onMouseDown={(e) => e.preventDefault()} onClick={() => apply(item)}>
        <Icon size={20} />
        <span>{item.label}</span>
      </button>
    );
  };
  if (!blocks || !blocks.length) return null;
  const Btn = Components.FormattingToolbar.Button;
  return (
    <div className="pb-bm">
      <span className="pb-bm-wrap" ref={box}>
      <button type="button" className="pb-bm-btn" data-testid="bm-open" aria-haspopup="menu" aria-expanded={open} title="Block type" onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => !o)}>
        <Cur size={16} /><span>{cur ? cur.label : 'Text'}</span><ChevronDown size={14} />
      </button>
      {open && createPortal(
        <div className="pb-bm-pop" role="menu" data-testid="bm-pop" ref={pop} style={{ left: at.left, top: at.top }} onMouseDown={(e) => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); }}>
          <input className="pb-bm-q" data-testid="bm-filter" aria-label="Filter block types" placeholder="Type to filter, e.g. check" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && found && found[0]) { e.preventDefault(); apply(found[0]); } }} />
          {found ? (
            <div className="pb-bm-grid">{found.length ? found.map((i) => <Cell key={i.id} item={i} />) : <div className="pb-bm-none">No block type matches</div>}</div>
          ) : (
            <>
              {GROUPS.map((g) => (
                <div key={g.name}>
                  <div className="pb-bm-lab">{g.name}</div>
                  <div className="pb-bm-grid">{g.items.map((i) => <Cell key={i.id} item={i} />)}</div>
                </div>
              ))}
              <button type="button" className="pb-bm-more" data-testid="bm-more" aria-expanded={more} onMouseDown={(e) => e.preventDefault()} onClick={() => setMore((m) => !m)}>
                More: Heading 4 to 6, toggle headings <ChevronRight size={14} style={{ transform: more ? 'rotate(90deg)' : 'none' }} />
              </button>
              {more && <div className="pb-bm-grid">{MORE.map((i) => <Cell key={i.id} item={i} />)}</div>}
            </>
          )}
        </div>, document.body)}
      </span>
      <ListBtn Btn={Btn} id="bullet" icon={<List size={15} />} label="Bullet list" type="bulletListItem" blocks={blocks} editor={editor} />
      <ListBtn Btn={Btn} id="numbered" icon={<ListOrdered size={15} />} label="Numbered list" type="numberedListItem" blocks={blocks} editor={editor} />
      <ListBtn Btn={Btn} id="check" icon={<ListChecks size={15} />} label="Check list" type="checkListItem" blocks={blocks} editor={editor} />
    </div>
  );
}

// Bullet, numbered and check list sit straight on the bar: one click turns the selection into that list, a second click back into text.
function ListBtn({ Btn, id, icon, label, type, blocks, editor }) {
  const on = blocks.every((b) => b.type === type);
  return (
    <Btn className="bn-button" label={label} mainTooltip={label} isSelected={on} icon={icon} data-testid={`bm-direct-${id}`}
      onClick={() => {
        try {
          editor.focus();
          const now = (editor.getSelection()?.blocks) || [editor.getTextCursorPosition().block]; // read at click time, not from the last render
          const off = now.length > 0 && now.every((b) => b.type === type);
          for (const b of now) editor.updateBlock(b, off ? { type: 'paragraph', props: {} } : { type, props: {} });
        } catch { /* not possible here */ }
      }} />
  );
}
