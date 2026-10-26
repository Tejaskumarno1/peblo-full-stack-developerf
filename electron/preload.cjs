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
  /** { openAtLogin, keepInTray, platform } - Settings > This computer. */
  getSystemSettings: () => ipcRenderer.invoke('peblo:system:get'),
  /** { openAtLogin?, keepInTray? } -> { ok, openAtLogin, keepInTray, error? } */
  setSystemSettings: (patch) => ipcRenderer.invoke('peblo:system:set', patch || {}),
  /** { available, version, dataDir, reason } - whether this copy can uninstall itself. */
  getUninstallInfo: () => ipcRenderer.invoke('peblo:uninstall:info'),
  /** { removeData, backup } -> { ok, backupDir?, cancelled?, error? }. On ok the app closes and removes itself. */
  uninstall: (opts) => ipcRenderer.invoke('peblo:uninstall:run', { removeData: !!(opts && opts.removeData), backup: !!(opts && opts.backup) }),
});
