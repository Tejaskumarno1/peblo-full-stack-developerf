/** Opens the Ctrl+K palette from a button (it listens for the key press). */
export function openCommandPalette() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
}
