/**
 * The design canvas (see styles/canvas.css and electron/main.cjs).
 * Screens are laid out at least 1440 × 900 design pixels and scaled as a whole to fit the window,
 * so layout decisions use the canvas size, never window.innerWidth.
 */
export function canvasWidth() {
  return document.getElementById('root')?.clientWidth || 1440;
}
