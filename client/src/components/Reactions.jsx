import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Ic, icSvg, REACTIONS } from '../utils/icons';

/*
 * Reactions on blocks (an icon and a count under a paragraph; icons, never emoji). They live in the shared document as a flat map, one entry per
 * person per reaction per block, so two people reacting at once never overwrite each other and everyone sees it live.
 */

export const EMOJI = REACTIONS.map((r) => r.id); // ids: like, love, celebrate, look, done, question
const labelOf = (id) => REACTIONS.find((r) => r.id === id)?.label || id;

function summary(map) {
  const out = new Map(); // blockId -> Map(emoji -> names[])
  map.forEach((name, key) => {
    const [block, emoji] = String(key).split('|');
    if (!block || !emoji) return;
    if (!out.has(block)) out.set(block, new Map());
    const m = out.get(block);
    m.set(emoji, [...(m.get(emoji) || []), String(name)]);
  });
  return out;
}

export default function Reactions({ rt, editor, rootRef, ready, canReact, dark }) {
  const [hover, setHover] = useState(null); // { id, x, y }
  const [pick, setPick] = useState(false);
  const hideTimer = useRef(null);
  const toggleRef = useRef(null);

  const userKey = rt ? `${String(rt.user.name).replace(/\|/g, ' ')}|${rt.user.color}` : '';
  const toggle = (blockId, emoji) => {
    if (!rt || !canReact) return;
    const map = rt.doc.getMap('reactions');
    const key = `${blockId}|${emoji}|${userKey}`;
    rt.doc.transact(() => { if (map.has(key)) map.delete(key); else map.set(key, rt.user.name); }, 'pb-editors');
  };
  toggleRef.current = toggle;

  // chips under the blocks that have reactions
  useEffect(() => {
    if (!rt || !ready || !editor) return undefined;
    const map = rt.doc.getMap('reactions');
    const plugin = new Plugin({
      key: new PluginKey('pb-reactions'),
      props: {
        decorations(state) {
          const groups = summary(map);
          if (!groups.size) return DecorationSet.empty;
          const out = [];
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'blockContainer') return true;
            const g = groups.get(node.attrs.id);
            if (g && node.firstChild) {
              const sig = [...g.entries()].map(([e, n]) => `${e}${n.sort().join(',')}`).join(';') + (canReact ? 'w' : 'r');
              out.push(Decoration.widget(pos + 1 + node.firstChild.nodeSize, () => {
                const row = document.createElement('div');
                row.className = 'pb-reactions';
                row.contentEditable = 'false';
                for (const [emoji, names] of g) {
                  const b = document.createElement('button');
                  b.type = 'button';
                  b.className = 'pb-react' + (names.includes(rt.user.name) ? ' mine' : '');
                  b.setAttribute('data-testid', 'reaction');
                  b.title = names.join(', ');
                  b.setAttribute('aria-label', `${labelOf(emoji)} ${names.length}: ${names.join(', ')}`);
                  b.setAttribute('data-reaction', emoji);
                  b.innerHTML = `${icSvg(emoji, 14)}<span>${names.length}</span>`;
                  if (canReact) b.addEventListener('click', (e) => { e.preventDefault(); toggleRef.current(node.attrs.id, emoji); });
                  else b.disabled = true;
                  row.appendChild(b);
                }
                return row;
              }, { side: 1, key: `r-${node.attrs.id}-${sig}`, stopEvent: () => true, ignoreSelection: true }));
            }
            return true;
          });
          return DecorationSet.create(state.doc, out);
        },
      },
    });
    try { editor.registerExtension({ key: 'pb-reactions', prosemirrorPlugins: [plugin] }); } catch { /* editor not ready */ }
    const refresh = () => { try { editor.transact((tr) => tr.setMeta('pb-react-refresh', Date.now())); } catch { /* gone */ } };
    map.observe(refresh);
    refresh();
    return () => { map.unobserve(refresh); try { editor.unregisterExtension('pb-reactions'); } catch { /* editor already gone */ } };
  }, [rt, ready, editor, canReact]); // eslint-disable-line react-hooks/exhaustive-deps

  // the small "add a reaction" button just outside the right edge of the block under the mouse (never over the text or a code block's Copy chip)
  useEffect(() => {
    const root = rootRef?.current;
    if (!rt || !ready || !root || !canReact) return undefined;
    const over = (e) => {
      const outer = e.target?.closest?.('.bn-block-outer');
      const id = outer?.getAttribute('data-id');
      if (!id) return;
      clearTimeout(hideTimer.current);
      const r = (outer.querySelector('.bn-block-content') || outer).getBoundingClientRect();
      const ed = root.querySelector('.bn-editor')?.getBoundingClientRect();
      setHover({ id, x: Math.min((ed?.right ?? r.right) + 4, window.innerWidth - 40), y: r.top + 2 });
    };
    const leave = () => { hideTimer.current = setTimeout(() => { setHover(null); setPick(false); }, 450); };
    const hide = () => { setHover(null); setPick(false); };
    root.addEventListener('mouseover', over);
    root.addEventListener('mouseleave', leave);
    root.addEventListener('scroll', hide);
    return () => { clearTimeout(hideTimer.current); root.removeEventListener('mouseover', over); root.removeEventListener('mouseleave', leave); root.removeEventListener('scroll', hide); };
  }, [rt, ready, rootRef, canReact]);

  if (!rt || !ready) return null;
  const bg = dark ? '#1f2430' : '#ffffff';
  return (
    <>
      {hover && canReact && createPortal(
        <div className="pb-reactadd" style={{ left: hover.x, top: hover.y, background: bg, color: dark ? '#e7e9ee' : '#1b1f2a' }} onMouseEnter={() => clearTimeout(hideTimer.current)} onMouseLeave={() => { hideTimer.current = setTimeout(() => { setHover(null); setPick(false); }, 450); }}>
          {pick ? (
            <div className="pick" role="menu" aria-label="Pick a reaction" data-testid="reaction-menu">
              {EMOJI.map((e) => <button key={e} type="button" role="menuitem" onClick={() => { toggle(hover.id, e); setPick(false); }} data-testid={`react-${e}`} aria-label={labelOf(e)} title={labelOf(e)}><Ic name={e} size={16} /></button>)}
            </div>
          ) : (
            <button type="button" aria-label="Add a reaction to this paragraph" title="React" onClick={() => setPick(true)} data-testid="reaction-add"><Ic name="addReaction" size={16} /></button>
          )}
        </div>,
        document.body,
      )}
      <style>{`
        .pb-reactions { display: flex; flex-wrap: wrap; gap: 4px; margin: 2px 0 6px 0; padding-left: 2px; user-select: none; }
        .pb-react { display: inline-flex; align-items: center; gap: 5px; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); background: color-mix(in srgb, currentColor 6%, transparent); color: inherit; border-radius: 999px; padding: 1px 8px; font-size: 12.5px; cursor: pointer; line-height: 1.5; }
        .pb-react.mine { border-color: #2563eb; background: #2563eb22; }
        .pb-react:disabled { cursor: default; }
        .pb-reactadd { position: fixed; z-index: 1200; border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 999px; box-shadow: 0 4px 14px rgba(0,0,0,.14); padding: 1px; }
        .pb-reactadd button { border: 0; background: transparent; cursor: pointer; width: 26px; height: 26px; border-radius: 50%; font-size: 15px; color: inherit; }
        .pb-reactadd button:hover { background: color-mix(in srgb, currentColor 12%, transparent); }
        .pb-reactadd .pick { display: flex; }
      `}</style>
    </>
  );
}
