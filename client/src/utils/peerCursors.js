import './peer-cursors.css';

/*
 * Where other people are in the note. Each person on a share link reports which top-level block of the text their
 * caret is in (just a number); we draw a coloured bar and their name next to that block. The marks live in their own
 * layer on top of the page, so the editor's own elements are never touched. Only blocks are marked, never characters.
 */
const PALETTE = ['#E2501A', '#2350FF', '#2FB67C', '#B05AF0', '#D9A400', '#0E9AA7', '#E0457B'];
export const peerColor = (id = '') => PALETTE[[...id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % PALETTE.length];
/** Idle people are drawn grey so they are not mistaken for someone who is active. */
const colorOf = (p) => (p.status === 'idle' ? '#8A8071' : peerColor(p.id));
const nameOf = (p) => (p.status === 'idle' ? `${p.name} \u00B7 idle` : p.name);

/** Scroll the editor so a person's block is in view (used by Follow). */
export function scrollToPeerBlock(index) {
  const root = document.querySelector('.bn-editor');
  const blk = root && topBlocks(root)[index];
  blk?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

const topBlocks = (root) => {
  const group = root?.querySelector(':scope > .bn-block-group') || root?.querySelector('.bn-block-group');
  return group ? [...group.children].filter((el) => el.classList?.contains('bn-block-outer')) : [];
};

/** The top-level blocks that are headings, in order: { index, text }. */
export function headingIndexes() {
  const root = document.querySelector('.bn-editor');
  if (!root) return [];
  return topBlocks(root).map((b, i) => { const c = b.querySelector('.bn-block-content'); return c?.getAttribute('data-content-type') === 'heading' ? { index: i, text: (c.textContent || '').trim() } : null; }).filter(Boolean);
}


/** For each outline title, the people whose caret is in that section: { title: [{ id, name }] }. */
export function peersBySection(peers, titles) {
  const hi = headingIndexes();
  const out = {};
  if (!hi.length) return out;
  for (const p of peers) {
    if (p.cursor == null) continue;
    let hit = null;
    for (const h of hi) { if (h.index <= p.cursor && titles.includes(h.text)) hit = h; }
    if (hit) (out[hit.text] ||= []).push({ id: p.id, name: p.name });
  }
  return out;
}
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


/** The caret or selection inside the top-level block it starts in: { block, start, end } as character offsets in that block's text. */
export function caretSelection() {
  const sel = window.getSelection?.();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const elOf = (n) => n && (n.nodeType === 1 ? n : n.parentElement);
  const startEl = elOf(range.startContainer);
  const root = startEl?.closest?.('.bn-editor');
  if (!root) return null;
  const blocks = topBlocks(root);
  const at = blocks.findIndex((b) => b.contains(startEl));
  if (at < 0) return null;
  const blk = blocks[at];
  const offsetOf = (node, off) => { const r = document.createRange(); r.selectNodeContents(blk); r.setEnd(node, off); return r.toString().length; };
  const start = offsetOf(range.startContainer, range.startOffset);
  const end = blk.contains(elOf(range.endContainer)) ? offsetOf(range.endContainer, range.endOffset) : (blk.textContent || '').length;
  return { block: at, start: Math.min(start, end), end: Math.max(start, end) };
}

/** A DOM range for characters [s, e) of a block's text, or null when the text is shorter than that. */
function rangeIn(blk, s, e) {
  const walker = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT);
  let pos = 0; let a = null; let b = null; let node;
  while ((node = walker.nextNode())) {
    const len = node.nodeValue.length;
    if (!a && s <= pos + len) a = [node, s - pos];
    if (e <= pos + len) { b = [node, e - pos]; break; }
    pos += len;
  }
  if (!a) return null;
  if (!b) b = [a[0], a[0].nodeValue.length];
  const r = document.createRange();
  try { r.setStart(a[0], a[1]); r.setEnd(b[0], b[1]); } catch { return null; }
  return r;
}

const el = (tag, cls, css, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (css) n.style.cssText = css; if (text) n.textContent = text; return n; };

/** Where a person's selection starts and ends: a tinted range, a pin at the start, a flag at the end. Also a thin caret. */
const lastMove = new Map(); // person id -> { key, at }: flags fade after 3 s without movement
const isQuiet = (p) => { const key = `${p.cursor}:${p.selStart}:${p.selEnd}`; const m = lastMove.get(p.id); if (!m || m.key !== key) { lastMove.set(p.id, { key, at: Date.now() }); return false; } return Date.now() - m.at > 3000; };

/** Flags that would sit on top of each other stack upward instead. */
const stackFlag = (used, node, left, top) => { const k = `${Math.round(top / 6)}:${Math.round(left / 60)}`; const n = used.get(k) || 0; used.set(k, n + 1); if (n) node.querySelector('span').style.marginBottom = `${1 + n * 21}px`; };

function drawRange(frag, blk, p, clip, used) {
  const quiet = isQuiet(p);
  if (p.selStart == null || p.selEnd == null) return;
  const range = rangeIn(blk, p.selStart, p.selEnd);
  if (!range) return;
  const color = colorOf(p);
  const rects = [...range.getClientRects()].filter((r) => r.width > 0 || p.selEnd === p.selStart);
  if (!rects.length) return;
  const inView = (r) => r.bottom >= clip.top + 4 && r.top <= clip.bottom - 4;
  if (p.selEnd === p.selStart) {
    const r = rects[0];
    if (!inView(r)) return;
    const caret = el('div', 'pb-peer-caret', `left:${Math.round(r.left)}px;top:${Math.round(r.top)}px;height:${Math.round(r.height || 20)}px;--peer:${color}`);
    caret.setAttribute('data-peer-caret', p.name);
    caret.appendChild(el('span', '', '', nameOf(p)));
    if (quiet) caret.classList.add('quiet');
    stackFlag(used, caret, r.left, r.top);
    frag.appendChild(caret);
    return;
  }
  for (const r of rects) {
    if (!inView(r)) continue;
    const sel = el('div', 'pb-peer-sel', `left:${Math.round(r.left)}px;top:${Math.round(r.top)}px;width:${Math.round(r.width)}px;height:${Math.round(r.height)}px;--peer:${color}`);
    sel.setAttribute('data-peer-span', `${p.name}|${range.toString()}`);
    frag.appendChild(sel);
  }
  const first = rects[0]; const last = rects[rects.length - 1];
  const words = range.toString().trim().split(/\s+/).filter(Boolean).length;
  if (inView(first)) {
    const pin = el('div', 'pb-peer-pin', `left:${Math.round(first.left)}px;top:${Math.round(first.top)}px;height:${Math.round(first.height)}px;--peer:${color}`);
    pin.setAttribute('data-peer-start', p.name);
    pin.appendChild(el('span', '', '', 'Start'));
    frag.appendChild(pin);
  }
  if (inView(last)) {
    const end = el('div', 'pb-peer-end', `left:${Math.round(last.right)}px;top:${Math.round(last.top)}px;height:${Math.round(last.height)}px;--peer:${color}`);
    end.setAttribute('data-peer-end', p.name);
    end.appendChild(el('span', '', '', `${p.name} · End · ${words} word${words === 1 ? '' : 's'}`));
    if (quiet) end.classList.add('quiet');
    stackFlag(used, end, last.right, last.top);
    frag.appendChild(end);
  }
}

/** Pointing at someone's selection or caret shows their flag again and the exact words they selected. */
let tip = null;
let lastMouse = null;
function hover(e) {
  if (e) lastMouse = { x: e.clientX, y: e.clientY };
  if (!layer || !lastMouse) return;
  e = { clientX: lastMouse.x, clientY: lastMouse.y };
  let tipText = null;
  for (const n of layer.querySelectorAll('.pb-peer-sel, .pb-peer-caret')) {
    const r = n.getBoundingClientRect();
    const hit = e.clientX >= r.left - 6 && e.clientX <= r.right + 6 && e.clientY >= r.top - 2 && e.clientY <= r.bottom + 2;
    n.classList.toggle('hot', hit);
    if (hit && n.dataset.peerSpan) { const [who, text] = n.dataset.peerSpan.split(/\|(.*)/s); tipText = `${who} selected \u201C${text.length > 90 ? `${text.slice(0, 87)}\u2026` : text}\u201D`; }
  }
  for (const n of layer.querySelectorAll('.pb-peer-end, .pb-peer-pin')) n.classList.toggle('hot', !!tipText);
  if (!tipText) { tip?.remove(); tip = null; return; }
  if (!tip) { tip = el('div', 'pb-peer-tip'); layer.parentNode.appendChild(tip); }
  tip.textContent = tipText;
  tip.style.cssText = `left:${Math.min(e.clientX + 14, window.innerWidth - 280)}px;top:${e.clientY + 18}px`;
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
    byBlock.set(p.cursor, prev ? { ...prev, name: `${prev.name} + ${p.name}` } : { name: nameOf(p), color: colorOf(p) });
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
  const used = new Map();
  for (const p of current) { if (p.cursor != null && blocks[p.cursor]) drawRange(frag, blocks[p.cursor], p, clip, used); }
  layer.replaceChildren(frag);
  hover(); // keep the hover state across redraws
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
    window.addEventListener('mousemove', hover, { passive: true });
  }
  draw();
}
