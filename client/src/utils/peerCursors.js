import './peer-cursors.css';

/*
 * Where other people are in the note. Each person on a share link reports which top-level block of the text their
 * caret is in (just a number); we draw a coloured bar and their name next to that block. The marks live in their own
 * layer on top of the page, so the editor's own elements are never touched. Only blocks are marked, never characters.
 */
const PALETTE = ['#E2501A', '#2350FF', '#2FB67C', '#B05AF0', '#D9A400', '#0E9AA7', '#E0457B'];
export const peerColor = (id = '') => PALETTE[[...id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % PALETTE.length];

const topBlocks = (root) => {
  const group = root?.querySelector(':scope > .bn-block-group') || root?.querySelector('.bn-block-group');
  return group ? [...group.children].filter((el) => el.classList?.contains('bn-block-outer')) : [];
};

/** Index of the top-level block the caret is in, or null when the caret is not in the note editor. */
export function caretBlock() {
  const sel = window.getSelection?.();
  const node = sel?.anchorNode;
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  const root = el?.closest?.('.bn-editor');
  if (!root) return null;
  const blocks = topBlocks(root);
  const at = blocks.findIndex((b) => b.contains(el));
  return at >= 0 ? at : null;
}

let layer = null;
let current = [];
let bound = false;

/** The nearest ancestor that scrolls, so marks do not float outside the part of the page that is visible. */
const clipOf = (el) => {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === 'auto' || o === 'scroll') return p.getBoundingClientRect();
  }
  return { top: 0, bottom: window.innerHeight };
};

function draw() {
  const root = document.querySelector('.bn-editor');
  if (!layer || !root || current.length === 0) { if (layer) layer.replaceChildren(); return; }
  const blocks = topBlocks(root);
  const clip = clipOf(root);
  const byBlock = new Map();
  for (const p of current) {
    if (p.cursor == null || !blocks[p.cursor]) continue;
    const prev = byBlock.get(p.cursor);
    byBlock.set(p.cursor, prev ? { ...prev, name: `${prev.name} + ${p.name}` } : { name: p.name, color: peerColor(p.id) });
  }
  const frag = document.createDocumentFragment();
  for (const [idx, info] of byBlock) {
    const r = blocks[idx].getBoundingClientRect();
    if (r.bottom < clip.top + 4 || r.top > clip.bottom - 4) continue; // scrolled out of view
    const mark = document.createElement('div');
    mark.className = 'pb-peer';
    mark.setAttribute('data-peer-name', info.name);
    mark.style.cssText = `top:${Math.round(r.top)}px;left:${Math.round(r.left) - 6}px;width:${Math.round(r.width) + 6}px;height:${Math.max(8, Math.round(r.height))}px;--peer:${info.color}`;
    const label = document.createElement('span');
    label.textContent = info.name;
    mark.appendChild(label);
    frag.appendChild(mark);
  }
  layer.replaceChildren(frag);
}

/** Mark the blocks other people are in. `peers`: [{ id, name, cursor }]. Pass [] to clear. Safe to call often. */
export function showPeers(peers) {
  current = peers;
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'pb-peer-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
  }
  if (!bound) {
    bound = true;
    let raf = 0;
    const again = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); };
    window.addEventListener('scroll', again, true);
    window.addEventListener('resize', again);
  }
  draw();
}
