// Keeping the desktop app current.
//
// 1. The window shows the pages of the Peblo server. Electron keeps its own web cache, and an old copy of the start
//    page could stay there for days, so the window looked like an old version. The cache is emptied the first time a
//    new version of the app starts (and the server now marks its start page "no-cache").
// 2. The app itself (the window, tray, shortcuts) updates from GitHub Releases through electron-updater: it checks a few
//    seconds after start and every 4 hours, downloads in the background, and asks before restarting.
//    Only installed copies (the Setup .exe) can update themselves; a loose win-unpacked folder cannot.
const { app, dialog, Notification, session } = require('electron');
const fs = require('fs');
const path = require('path');

const FOUR_HOURS = 4 * 60 * 60 * 1000;
let autoUpdater = null;
let started = false;
let manual = false;
let ready = null; // the version that is downloaded and waiting for a restart

/** Empty Electron's web cache once per app version, so a new version never shows the pages of an old one. */
async function clearStaleWebCache() {
  const marker = path.join(app.getPath('userData'), 'web-cache-version.txt');
  try {
    if (fs.readFileSync(marker, 'utf8').trim() === app.getVersion()) return false;
  } catch { /* first run */ }
  try {
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData({ storages: ['cachestorage', 'serviceworkers'] });
    fs.writeFileSync(marker, app.getVersion());
    return true;
  } catch (err) {
    console.warn('Could not clear the web cache:', err.message);
    return false;
  }
}

function loadUpdater() {
  if (autoUpdater) return autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.warn('Updates are not available in this build:', err.message);
    autoUpdater = null;
  }
  return autoUpdater;
}

/**
 * @param {{ getWindow: () => import('electron').BrowserWindow | null, beforeRestart: () => void, icon?: string }} ctx
 */
function init(ctx) {
  if (started || !app.isPackaged || process.env.PEBLO_NO_UPDATE) return;
  const updater = loadUpdater();
  if (!updater) return;
  started = true;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true; // installed the next time Peblo is closed, even if "Later" is chosen
  updater.allowPrerelease = false;

  updater.on('update-available', (info) => {
    if (manual) dialog.showMessageBox(ctx.getWindow() || undefined, { type: 'info', title: 'Update found', message: `Peblo ${info.version} is downloading.`, detail: 'You can keep working. Peblo will ask before restarting.' });
    else if (Notification.isSupported()) new Notification({ title: 'Peblo update found', body: `Version ${info.version} is downloading in the background.`, icon: ctx.icon }).show();
  });
  updater.on('update-not-available', () => {
    if (manual) dialog.showMessageBox(ctx.getWindow() || undefined, { type: 'info', title: 'Peblo is up to date', message: `You have the latest version (${app.getVersion()}).` });
    manual = false;
  });
  updater.on('error', (err) => {
    console.warn('Update check failed:', err && err.message);
    if (manual) dialog.showMessageBox(ctx.getWindow() || undefined, { type: 'warning', title: 'Could not check for updates', message: 'Peblo could not reach the update server.', detail: 'Check your internet connection and try again. The web screens in the app update by themselves.' });
    manual = false;
  });
  updater.on('update-downloaded', async (info) => {
    ready = info.version;
    manual = false;
    const { response } = await dialog.showMessageBox(ctx.getWindow() || undefined, {
      type: 'question', buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1,
      title: 'Peblo update ready', message: `Peblo ${info.version} is ready to install.`,
      detail: 'Your notes are saved. Peblo restarts in a few seconds. Choosing Later installs it the next time you close Peblo.',
    });
    if (response === 0) { ctx.beforeRestart(); updater.quitAndInstall(false, true); }
  });

  const check = () => updater.checkForUpdates().catch(() => {});
  setTimeout(check, 15_000);
  setInterval(check, FOUR_HOURS).unref?.();
}

/** Help → Check for updates. Says what happened either way. */
function checkNow(ctx) {
  if (!app.isPackaged) { dialog.showMessageBox({ type: 'info', title: 'Updates', message: 'Updates only work in the installed app.' }); return; }
  const updater = loadUpdater();
  if (!updater) { dialog.showMessageBox({ type: 'info', title: 'Updates', message: 'Updates are not available in this build.' }); return; }
  if (!started) init(ctx);
  if (ready) { dialog.showMessageBox({ type: 'info', title: 'Update ready', message: `Peblo ${ready} is downloaded. It installs when you close Peblo.` }); return; }
  manual = true;
  updater.checkForUpdates().catch((err) => {
    manual = false;
    dialog.showMessageBox({ type: 'warning', title: 'Could not check for updates', message: err.message || 'Unknown error' });
  });
}

module.exports = { clearStaleWebCache, init, checkNow };
