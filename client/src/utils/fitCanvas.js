// Browser windows smaller than the design (1440 x 900) show the whole screen scaled down instead of cutting off the right
// and bottom. The desktop app does its own scaling (electron/main.cjs) and never uses this. Windows at least as big as the
// design are left alone: nothing is ever enlarged here.
const DESIGN_W = 1440;
const DESIGN_H = 900;
const MAX_W = 2160; // the widest the canvas stretches (see styles/canvas.css)

export function fitScale(width, height) {
  return Math.min(1, width / DESIGN_W, height / DESIGN_H);
}

/** Starts fitting the signed-in screens to the window; returns a function that stops it and restores the page. */
export function startFitCanvas() {
  if (typeof window === 'undefined' || window.pebloDesktop) return () => {};
  const root = document.documentElement;
  const clear = () => { root.style.removeProperty('zoom'); root.style.removeProperty('--pb-canvas-w'); root.style.removeProperty('--pb-canvas-h'); };
  const apply = () => {
    if (root.classList.contains('pb-canvas-capture')) return clear();
    const s = fitScale(window.innerWidth, window.innerHeight);
    if (s >= 0.999) return clear();
    root.style.zoom = String(s);
    root.style.setProperty('--pb-canvas-w', Math.min(MAX_W, Math.max(DESIGN_W, window.innerWidth / s)) + 'px');
    root.style.setProperty('--pb-canvas-h', Math.max(DESIGN_H, window.innerHeight / s) + 'px');
  };
  apply();
  window.addEventListener('resize', apply);
  return () => { window.removeEventListener('resize', apply); clear(); };
}
