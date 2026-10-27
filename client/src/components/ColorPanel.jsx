import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Undo2 } from 'lucide-react';
import { useBlockNoteEditor, useComponentsContext, useEditorState } from '@blocknote/react';
import './colorPanel.css';

// Colours you can see (mockups G1a, G1b): real swatches, names only on hover. The same names BlockNote stores,
// so notes written before this keep their colours; blockEditor.css gives each name a strong, readable shade.
export const TXT = [['default', '#241F1A', 'Default'], ['gray', '#6B6459', 'Gray'], ['brown', '#9A5B2E', 'Brown'], ['red', '#D13B2E', 'Red'], ['orange', '#E8740C', 'Orange'], ['yellow', '#D4A000', 'Yellow'], ['green', '#1E8E4E', 'Green'], ['blue', '#2563EB', 'Blue'], ['purple', '#7C3AED', 'Purple'], ['pink', '#D6336C', 'Pink']];
export const BG = [['default', '#FFFFFF', 'None'], ['gray', '#E6E0D6', 'Gray'], ['brown', '#EBD3BC', 'Brown'], ['red', '#FBCFCA', 'Red'], ['orange', '#FFD9AE', 'Orange'], ['yellow', '#FFEC99', 'Yellow'], ['green', '#BFEBCF', 'Green'], ['blue', '#C5DDFB', 'Blue'], ['purple', '#DCD1FF', 'Purple'], ['pink', '#F9D0E1', 'Pink']];
const RKEY = 'pb-recent-colours';
const readRecent = () => { try { const v = JSON.parse(localStorage.getItem(RKEY) || '[]'); return Array.isArray(v) ? v.slice(0, 3) : []; } catch { return []; } };
export const pushRecent = (kind, name) => { if (name === 'default') return; try { const v = [{ kind, name }, ...readRecent().filter((r) => !(r.kind === kind && r.name === name))].slice(0, 3); localStorage.setItem(RKEY, JSON.stringify(v)); } catch { /* not kept */ } };

export function Swatch({ kind, name, hex, tip, on, onPick }) {
  const none = kind === 'bg' && name === 'default';
  return (
    <button type="button" className={`pbc-sw ${kind}${on ? ' on' : ''}${none ? ' none' : ''}`} style={kind === 'bg' ? { background: hex } : { color: hex }} title={tip} aria-label={`${kind === 'bg' ? 'Highlight' : 'Text colour'} ${tip}`} aria-pressed={!!on} data-testid={`pbc-${kind}-${name}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(name)}>
      {kind === 'text' ? 'A' : none ? <i className="slash" /> : null}
      {on && <i className="tick"><Check size={11} strokeWidth={3.4} /></i>}
    </button>
  );
}
export const SwatchGrid = ({ kind, cur, onPick }) => (
  <div className="pbc-grid">{(kind === 'bg' ? BG : TXT).map(([name, hex, tip]) => <Swatch key={name} kind={kind} name={name} hex={hex} tip={tip} on={cur === name} onPick={onPick} />)}</div>
);

/** The picker behind the colours button on the selection bar (G1a). */
export function ColorPanel({ text, bg, onText, onBg, onReset }) {
  const recent = useMemo(readRecent, [text, bg]);
  const hexOf = (r) => (r.kind === 'bg' ? BG : TXT).find((x) => x[0] === r.name)?.[1];
  const cur = bg !== 'default' ? BG.find((x) => x[0] === bg)?.[1] : text !== 'default' ? TXT.find((x) => x[0] === text)?.[1] : '#1E8E4E';
  return (
    <div className="pbc-panel" role="dialog" aria-label="Colours" data-testid="color-panel" onMouseDown={(e) => e.preventDefault()}>
      <div className="pbc-row"><b>Text colour</b><span className="pbc-reset" role="button" tabIndex={0} data-testid="pbc-reset" onClick={onReset}><Undo2 size={12} />Reset</span></div>
      <SwatchGrid kind="text" cur={text} onPick={onText} />
      <div className="pbc-row"><b>Highlight</b></div>
      <SwatchGrid kind="bg" cur={bg} onPick={onBg} />
      <div className="pbc-lbl">Recent</div>
      <div className="pbc-recent">{recent.length ? recent.map((r) => <Swatch key={r.kind + r.name} kind={r.kind} name={r.name} hex={hexOf(r)} tip={r.name} on={(r.kind === 'bg' ? bg : text) === r.name} onPick={r.kind === 'bg' ? onBg : onText} />) : <span className="pbc-none">Colours you use show up here</span>}</div>
      <div className="pbc-foot"><i style={{ background: cur }} />Hover a colour for its name. Stays open until you click away.</div>
    </div>
  );
}

const Palette = ({ size = 20, text, bg }) => (
  <span className="pbc-ico" style={{ width: size, height: size, color: text && text !== 'default' ? TXT.find((x) => x[0] === text)?.[1] : undefined, background: bg && bg !== 'default' ? BG.find((x) => x[0] === bg)?.[1] : undefined }}>A</span>
);

/** The colours button itself. Replaces BlockNote's name-only list. */
export default function ColorTool() {
  const editor = useBlockNoteEditor();
  const C = useComponentsContext();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const st = useEditorState({ editor, selector: ({ editor: e }) => {
    if (!e.isEditable) return undefined;
    const a = e.getActiveStyles();
    return { text: a.textColor || 'default', bg: a.backgroundColor || 'default' };
  } });
  useEffect(() => {
    if (!open) return undefined;
    const r = ref.current?.getBoundingClientRect();
    if (r) { const w = 300; setPos({ top: r.bottom + 10, left: Math.max(8, Math.min(r.left - 20, window.innerWidth - w - 8)) }); }
    const close = (e) => { if (e.type === 'keydown' && e.key !== 'Escape') return; if (e.type === 'mousedown' && (e.target.closest?.('.pbc-panel') || ref.current?.contains(e.target))) return; setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  if (!st || !C) return null;
  const Btn = C.FormattingToolbar.Button;
  const setText = (n) => { if (n === 'default') editor.removeStyles({ textColor: 'default' }); else { editor.addStyles({ textColor: n }); pushRecent('text', n); } };
  const setBg = (n) => { if (n === 'default') editor.removeStyles({ backgroundColor: 'default' }); else { editor.addStyles({ backgroundColor: n }); pushRecent('bg', n); } };
  const reset = () => { editor.removeStyles({ textColor: 'default' }); editor.removeStyles({ backgroundColor: 'default' }); };
  return (
    <span ref={ref} className="pbc-anchor" onMouseDown={(e) => e.preventDefault()}>
      <Btn className="bn-button" data-test="colors" mainTooltip="Colours" label="Colours" icon={<Palette text={st.text} bg={st.bg} />} isSelected={open} onClick={() => setOpen((v) => !v)} />
      {open && pos && createPortal(<div className="pbc-pop" style={{ top: pos.top, left: pos.left }}><ColorPanel text={st.text} bg={st.bg} onText={(n) => setText(n === st.text ? 'default' : n)} onBg={(n) => setBg(n === st.bg ? 'default' : n)} onReset={reset} /></div>, document.body)}
    </span>
  );
}
