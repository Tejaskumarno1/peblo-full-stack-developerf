// The quick-capture key. In the desktop app it is a global shortcut owned by Electron (electron/main.cjs);
// in a browser tab a page cannot listen outside itself, so the same key works while Peblo is open in the tab.
// Keys are stored as Electron-style accelerators, e.g. "CommandOrControl+Shift+Space".

export const DEFAULT_CAPTURE_KEY = 'CommandOrControl+Shift+Space';
const STORE = 'peblo-capture-key';
export const CAPTURE_KEY_EVENT = 'peblo:capture-key-changed';

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '');

/** "CommandOrControl+Shift+Space" -> "Ctrl + Shift + Space" for display. */
export function shortcutLabel(accelerator) {
  return (accelerator || '').split('+').map((p) => (p === 'CommandOrControl' ? (isMac ? '⌘' : 'Ctrl') : p)).join(' + ');
}

/** A key event -> an accelerator, or null while only modifiers are held. */
export function toAccelerator(e) {
  const code = e.code || '';
  let key = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^F([1-9]|1\d|2[0-4])$/.test(code)) key = code;
  else if (['Space', 'Tab', 'Backspace', 'Enter', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete'].includes(code)) key = code;
  else if (/^Arrow(Up|Down|Left|Right)$/.test(code)) key = code.slice(5);
  if (!key) return null;
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push('CommandOrControl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  return [...mods, key].join('+');
}

export function getWebCaptureKey() {
  try { return localStorage.getItem(STORE) || DEFAULT_CAPTURE_KEY; } catch { return DEFAULT_CAPTURE_KEY; }
}

export function setWebCaptureKey(accelerator) {
  try {
    if (accelerator === DEFAULT_CAPTURE_KEY) localStorage.removeItem(STORE);
    else localStorage.setItem(STORE, accelerator);
  } catch { /* private window: the key just resets next visit */ }
  window.dispatchEvent(new Event(CAPTURE_KEY_EVENT));
}
