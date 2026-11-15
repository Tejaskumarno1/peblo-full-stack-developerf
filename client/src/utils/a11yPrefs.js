// Accessibility choices. Kept per device (a big screen and a phone want different text sizes).
export const A11Y_KEY = 'peblo-a11y';
export const SIZES = { S: 0.92, M: 1, L: 1.12, XL: 1.25 };
export const DEFAULTS = { size: 'M', motion: false, contrast: false, focus: false };

export function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    size: Object.prototype.hasOwnProperty.call(SIZES, r.size) ? r.size : 'M',
    motion: r.motion === true,
    contrast: r.contrast === true,
    focus: r.focus === true,
  };
}
export function load(storage = globalThis.localStorage) {
  try { return normalize(JSON.parse(storage.getItem(A11Y_KEY) || '{}')); } catch { return { ...DEFAULTS }; }
}
export function store(prefs, storage = globalThis.localStorage) {
  try { storage.setItem(A11Y_KEY, JSON.stringify(normalize(prefs))); } catch { /* ignore */ }
}
/** Puts the choices on the page: a zoom for text size and data attributes that a11y.css reacts to. */
export function apply(prefs, root = globalThis.document?.documentElement) {
  if (!root) return;
  const p = normalize(prefs);
  // a <style> tag, so no other script that rewrites the root's inline style can undo the text size
  const doc = root.ownerDocument;
  if (doc) {
    let tag = doc.getElementById('a11y-zoom');
    if (!tag) { tag = doc.createElement('style'); tag.id = 'a11y-zoom'; doc.head.appendChild(tag); }
    tag.textContent = p.size === 'M' ? '' : `html { zoom: ${SIZES[p.size]}; }`;
  }
  root.setAttribute('data-a11y-size', p.size);
  root.toggleAttribute('data-a11y-motion', p.motion);
  root.toggleAttribute('data-a11y-contrast', p.contrast);
  root.toggleAttribute('data-a11y-focus', p.focus);
}
