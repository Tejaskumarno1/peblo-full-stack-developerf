// Preload for the main window: the only bridge between Peblo's web page and the desktop shell.
// The main process checks that every call comes from Peblo's own page (see trustedSender in main.cjs).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pebloDesktop', {
  platform: process.platform,
  /** { shortcut, defaultShortcut, registered } for the global quick-capture key. */
  getCaptureShortcut: () => ipcRenderer.invoke('peblo:capture-shortcut:get'),
  /** Try a new accelerator such as "CommandOrControl+Alt+N"; resolves { ok, shortcut, error? }. */
  setCaptureShortcut: (accelerator) => ipcRenderer.invoke('peblo:capture-shortcut:set', String(accelerator)),
  resetCaptureShortcut: () => ipcRenderer.invoke('peblo:capture-shortcut:reset'),
});
