// Peblo desktop — Electron main process.
//
// Runs the Express API in-process on a random localhost port and shows the React UI in a window.
// Everything is stored in the shared Postgres (Supabase) database named by DATABASE_URL (see loadEnvFile).
const { app, BrowserWindow, shell, Menu, dialog, globalShortcut, ipcMain, Tray, nativeImage, Notification, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const updates = require('./updates.cjs');
const uninstaller = require('./uninstall.cjs');
const isDev = !app.isPackaged;
const DEV_URL = process.env.PEBLO_DEV_URL; // e.g. http://localhost:5173 when running `npm run dev`

// The window's own background shows before the page paints. Remember the page's background from the last run
// (written by rememberBackground) so a dark theme does not start with a light window.
const BG_FILE = () => path.join(app.getPath('userData'), 'window-bg.txt');
function savedBackground(fallback) {
  try {
    const v = fs.readFileSync(BG_FILE(), 'utf8').trim();
    return /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
  } catch { return fallback; }
}
function rememberBackground(win) {
  const save = async () => {
    try {
      if (win.isDestroyed()) return;
      const rgb = await win.webContents.executeJavaScript('getComputedStyle(document.body).backgroundColor');
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(String(rgb));
      if (!m) return;
      const hex = '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
      fs.writeFileSync(BG_FILE(), hex);
    } catch { /* not worth stopping for */ }
  };
  win.webContents.on('did-finish-load', () => setTimeout(save, 600));
  win.on('blur', save);
  win.on('close', save);
}

// PEBLO_DATA_DIR lets you run a throwaway copy (for testing) without touching your real notes.
if (process.env.PEBLO_DATA_DIR) app.setPath('userData', path.resolve(process.env.PEBLO_DATA_DIR));

// ── Only one copy of the app at a time (two copies would fight over the database) ──
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let captureWindow = null;
let captureMovedTo = null; // where the person last dragged the quick capture window
let tray = null;
let serverPort = null;
// Hosted mode: when set, the app is just a window onto a Peblo server running elsewhere.
// Set PEBLO_API_URL (e.g. https://peblo.example.com), or put the address in server-url.txt in the app-data folder.
const PRODUCTION_URL = 'https://peblo-stxo.onrender.com'; // same address as mobile/capacitor.config.json
let REMOTE_URL = null;
function readRemoteUrl() {
  let url = process.env.PEBLO_API_URL;
  if (!url) {
    try { url = fs.readFileSync(path.join(app.getPath('userData'), 'server-url.txt'), 'utf8'); } catch { /* none */ }
  }
  // Released builds are a window onto the production server, which alone holds DATABASE_URL and the
  // other secrets. PEBLO_LOCAL=1 runs the in-process server instead (needs a .env).
  if (!url && app.isPackaged && !process.env.PEBLO_LOCAL) url = PRODUCTION_URL;
  url = (url || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(url) ? url : null;
}
let isQuitting = false;
let trayHintShown = false;
const updateCtx = { getWindow: () => mainWindow, beforeRestart: () => { isQuitting = true; } };

const DEFAULT_CAPTURE_SHORTCUT = 'CommandOrControl+Shift+Space';
let captureShortcut = DEFAULT_CAPTURE_SHORTCUT;

// Desktop-only preferences (not account settings): kept in a small file in the app-data folder.
const DESKTOP_SETTINGS_FILE = () => path.join(app.getPath('userData'), 'desktop-settings.json');
function readDesktopSettings() {
  try { return JSON.parse(fs.readFileSync(DESKTOP_SETTINGS_FILE(), 'utf8')) || {}; } catch { return {}; }
}
function writeDesktopSettings(patch) {
  try { fs.writeFileSync(DESKTOP_SETTINGS_FILE(), JSON.stringify({ ...readDesktopSettings(), ...patch }, null, 2)); } catch (err) { console.warn('Could not save desktop settings:', err.message); }
}
const ACCELERATOR_RE = /^(?:(?:CommandOrControl|Command|Control|Alt|Shift|Super)\+)+(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Space|Tab|Backspace|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete)$/;
const shortcutLabel = (acc) => acc.replace('CommandOrControl', process.platform === 'darwin' ? '⌘' : 'Ctrl');

/** Moves the global quick-capture key. Keeps the old one if the new one is invalid or taken by another app. */
function applyCaptureShortcut(accelerator, { persist = true } = {}) {
  if (!ACCELERATOR_RE.test(accelerator) || !/(CommandOrControl|Command|Control|Alt|Super)\+/.test(accelerator)) {
    return { ok: false, shortcut: captureShortcut, error: 'Use at least Ctrl, Alt or ⌘ together with another key.' };
  }
  if (accelerator === captureShortcut && globalShortcut.isRegistered(accelerator)) return { ok: true, shortcut: accelerator };
  const previous = captureShortcut;
  try { globalShortcut.unregister(previous); } catch { /* not registered */ }
  let ok = false;
  try { ok = globalShortcut.register(accelerator, toggleCapture); } catch { ok = false; }
  if (!ok) {
    try { globalShortcut.register(previous, toggleCapture); } catch { /* nothing more to do */ }
    return { ok: false, shortcut: previous, error: 'Windows or another app already uses that key combination. Try a different one.' };
  }
  captureShortcut = accelerator;
  if (persist) writeDesktopSettings({ captureShortcut: accelerator });
  refreshMenus();
  return { ok: true, shortcut: accelerator };
}

// Only Peblo's own main window may ask to change desktop settings.
function trustedSender(event) {
  try { return !!mainWindow && event.sender === mainWindow.webContents && isInternal(event.senderFrame.url); } catch { return false; }
}
ipcMain.handle('peblo:capture-shortcut:get', (event) => {
  if (!trustedSender(event)) return null;
  return { shortcut: captureShortcut, defaultShortcut: DEFAULT_CAPTURE_SHORTCUT, registered: globalShortcut.isRegistered(captureShortcut) };
});
ipcMain.handle('peblo:capture-shortcut:set', (event, accelerator) => {
  if (!trustedSender(event)) return { ok: false, error: 'Not allowed.' };
  return applyCaptureShortcut(String(accelerator));
});
ipcMain.handle('peblo:capture-shortcut:reset', (event) => {
  if (!trustedSender(event)) return { ok: false, error: 'Not allowed.' };
  return applyCaptureShortcut(DEFAULT_CAPTURE_SHORTCUT);
});

// Settings > This computer: start with Windows (or at login), and whether closing the window keeps Peblo in the tray.
function systemSettings() {
  let openAtLogin = false;
  try { openAtLogin = !!app.getLoginItemSettings().openAtLogin; } catch { /* not supported here (some Linux desktops) */ }
  return { openAtLogin, keepInTray: readDesktopSettings().keepInTray !== false, platform: process.platform };
}
ipcMain.handle('peblo:system:get', (event) => (trustedSender(event) ? systemSettings() : null));
ipcMain.handle('peblo:system:set', (event, patch) => {
  if (!trustedSender(event)) return { ok: false, error: 'Not allowed.' };
  try {
    if (patch && typeof patch.openAtLogin === 'boolean') {
      if (!app.isPackaged) return { ok: false, error: 'Start-at-login only works in the installed app, not in a development run.', ...systemSettings() };
      app.setLoginItemSettings({ openAtLogin: patch.openAtLogin });
    }
    if (patch && typeof patch.keepInTray === 'boolean') writeDesktopSettings({ keepInTray: patch.keepInTray });
    return { ok: true, ...systemSettings() };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err), ...systemSettings() };
  }
});

// Settings > About > Uninstall Peblo (see uninstall.cjs).
uninstaller.register({ trusted: trustedSender, getWindow: () => mainWindow, beforeQuit: () => { isQuitting = true; } });

// ── Design canvas ──
// Every screen is designed at 1440 × 900 (client/src/styles/canvas.css). Here we pick one
// zoom factor so 1440 × 900 just fits the window, and apply it to the whole page: the design's
// height (or width, in a tall window) fills the window exactly and the other side gets the
// extra room. Window size, screen DPI, OS display scaling and Ctrl + / Ctrl − then only change
// how big the design is drawn, never its proportions.
// Keep these sizes in sync with client/src/styles/canvas.css.
const CANVAS = { width: 1440, height: 900 };
const CAPTURE_CANVAS = {
  soft: { width: 800, height: 680 },
  river: { width: 640, height: 280 },
  orbit: { width: 640, height: 220 },
  other: { width: 620, height: 256 },
};
let uiScale = 1;

/** The largest zoom at which the whole canvas fits in the window's content area. */
function fitScale(win) {
  const [w, h] = win.getContentSize();
  const fit = Math.min(w / CANVAS.width, h / CANVAS.height);
  // Round down a little so rounding never leaves the canvas 1px too big for the window.
  return Math.max(0.25, Math.floor(fit * 1000) / 1000);
}

function applyScale() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  uiScale = fitScale(mainWindow);
  mainWindow.webContents.setZoomFactor(uiScale);
  // Pages from the same address share one zoom in Chromium, so the capture window follows too.
  if (captureWindow && !captureWindow.isDestroyed()) captureWindow.webContents.setZoomFactor(uiScale);
}

/** The user can't zoom the page: Ctrl/Cmd + / − / 0, Ctrl + wheel and pinch all keep our scale. */
function lockZoom(win) {
  const wc = win.webContents;
  const keep = () => {
    if (wc.isDestroyed()) return;
    wc.setZoomFactor(uiScale);
    wc.setVisualZoomLevelLimits(1, 1).catch(() => {});
  };
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    if (['+', '=', '-', '_', '0'].includes(input.key)) event.preventDefault();
  });
  wc.on('zoom-changed', keep);
  wc.on('dom-ready', keep);
  wc.on('did-finish-load', keep);
}
const ICON_PATH = path.join(__dirname, '..', 'build', 'icon.png');

function appUrl(route = '/') {
  const base = DEV_URL || REMOTE_URL || `http://127.0.0.1:${serverPort}`;
  return base.replace(/\/$/, '') + route;
}

// Only Peblo's own address counts as "inside the app" (same scheme, host and port). A page on another
// local port, or any other site, opens in the normal browser and never inside Peblo.
function isInternal(target) {
  try {
    return new URL(target).origin === new URL(appUrl('/')).origin;
  } catch {
    return false;
  }
}

/** Shared safety settings for every window: external links open in the normal browser. */
function secureWebContents(win) {
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isInternal(target)) return { action: 'allow' };
    if (/^https?:|^mailto:/.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  // A window Peblo opens for itself gets the same rules, so it cannot be steered to another site inside the app.
  win.webContents.on('did-create-window', (child) => secureWebContents(child));
  const keepInside = (event, target) => {
    if (!isInternal(target)) {
      event.preventDefault();
      if (/^https?:|^mailto:/.test(target)) shell.openExternal(target);
    }
  };
  win.webContents.on('will-navigate', keepInside);
  // A server-side redirect from the app to another site is stopped the same way (will-navigate does not see redirects).
  win.webContents.on('will-redirect', keepInside);
  win.webContents.on('will-frame-navigate', (event) => keepInside(event, event.url));
}

/** Path inside the app bundle, pointing at the unpacked copy for files that must live on disk. */
function resourcePath(...parts) {
  const p = path.join(app.getAppPath(), ...parts);
  return p.replace(/app\.asar(?=[\\/]|$)/, 'app.asar.unpacked');
}

/** Prisma's query engine is a native file; point Prisma straight at the unpacked copy. */
function configurePrismaEngine() {
  const dir = resourcePath('server', 'generated', 'prisma');
  if (!fs.existsSync(dir)) return;
  const engine = require('./engine.cjs').pickEngine(fs.readdirSync(dir), process.platform, process.arch);
  if (engine) process.env.PRISMA_QUERY_ENGINE_LIBRARY = path.join(dir, engine);
  else console.error(`[peblo] no database engine for ${process.platform}/${process.arch} in ${dir}`);
}

/**
 * The database is a Postgres server shared by every account, so the app needs its address
 * (DATABASE_URL) and the secret that signs sign-ins (JWT_SECRET). They come from the environment,
 * or from the first .env file found: PEBLO_ENV_FILE, one in the app-data folder, next to Peblo.exe, or server/.env
 * when running from the project folder.
 */
function loadEnvFile() {
  const candidates = [
    process.env.PEBLO_ENV_FILE,
    path.join(app.getPath('userData'), '.env'),
    path.join(path.dirname(app.getPath('exe')), '.env'),
    path.join(app.getAppPath(), 'server', '.env'),
  ].filter(Boolean);
  const file = candidates.find((f) => fs.existsSync(f));
  if (file) require('dotenv').config({ path: file });
  // The secret that signs sign-ins: use the configured one, or make one on first run and keep it.
  if (!process.env.JWT_SECRET) {
    const secretFile = path.join(app.getPath('userData'), '.jwt-secret');
    let secret = '';
    try { secret = fs.readFileSync(secretFile, 'utf8').trim(); } catch { /* first run */ }
    if (secret.length < 32) {
      secret = require('crypto').randomBytes(48).toString('hex');
      fs.writeFileSync(secretFile, secret, { mode: 0o600 });
    }
    process.env.JWT_SECRET = secret;
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Copy server/.env to ' + path.join(app.getPath('userData'), '.env') + ' (or next to Peblo.exe, or set PEBLO_ENV_FILE), then start Peblo again.');
  }
}

async function startBackend() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  loadEnvFile();
  process.env.PEBLO_SQL_DIR = resourcePath('server', 'prisma', 'sql');
  process.env.NODE_ENV = isDev ? 'development' : 'production';
  if (!isDev) configurePrismaEngine();

  const entry = path.join(app.getAppPath(), 'dist', 'server', 'index.js');

  const { startServer } = await import(pathToFileURL(entry).href);
  const { port } = await startServer({
    port: 0,
    staticDir: path.join(app.getAppPath(), 'client', 'dist'),
  });
  return port;
}

function createWindow() {
  // Open at the design size (1440 × 900 of content), or smaller with the same shape if the screen is smaller.
  const work = screen.getPrimaryDisplay().workAreaSize;
  const fit = Math.min(1, (work.width - 16) / CANVAS.width, (work.height - 56) / CANVAS.height);
  mainWindow = new BrowserWindow({
    useContentSize: true,
    width: Math.round(CANVAS.width * fit),
    height: Math.round(CANVAS.height * fit),
    minWidth: 720,
    minHeight: 450,
    show: false,
    title: 'Peblo',
    backgroundColor: savedBackground('#F6F5F2'),
    icon: ICON_PATH,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: isDev, // no DevTools in release builds
      spellcheck: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  lockZoom(mainWindow);
  for (const ev of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'moved']) mainWindow.on(ev, applyScale);
  applyScale();

  rememberBackground(mainWindow);
  mainWindow.once('ready-to-show', () => { applyScale(); mainWindow.show(); });
  mainWindow.loadURL(appUrl('/'));
  secureWebContents(mainWindow);

  // Microphone for dictating to the AI assistant; nothing else is granted.
  const allowedPermission = (permission) => ['media', 'clipboard-sanitized-write', 'notifications'].includes(permission);
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowedPermission(permission));
  });
  mainWindow.webContents.session.setPermissionCheckHandler((_wc, permission) => allowedPermission(permission));

  // Closing the window keeps Peblo running in the tray so quick capture keeps working.
  mainWindow.on('close', (event) => {
    if (isQuitting || !tray || readDesktopSettings().keepInTray === false) return;
    event.preventDefault();
    mainWindow.hide();
    if (!trayHintShown && Notification.isSupported()) {
      trayHintShown = true;
      new Notification({
        title: 'Peblo is still running',
        body: `Press ${shortcutLabel(captureShortcut)} anywhere to capture a note or task. Quit from the tray icon.`,
        icon: ICON_PATH,
      }).show();
    }
  });

  if (DEV_URL) mainWindow.webContents.openDevTools({ mode: 'detach' });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function showMainWindow(route) {
  if (!mainWindow) createWindow();
  if (route) mainWindow.loadURL(appUrl(route));
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ── Quick capture: a small always-on-top box, opened with a global shortcut ──
function createCaptureWindow() {
  captureWindow = new BrowserWindow({
    useContentSize: true,
    width: CAPTURE_CANVAS.other.width,
    height: CAPTURE_CANVAS.other.height,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: savedBackground('#ffffff'),
    title: 'Quick capture',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: isDev, spellcheck: true },
  });
  lockZoom(captureWindow);
  captureWindow.loadURL(appUrl('/quick-capture'));
  secureWebContents(captureWindow);
  captureWindow.webContents.on('did-fail-load', (_e, code, _d, _u, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = aborted by a newer navigation
    setTimeout(() => { if (captureWindow && !captureWindow.isDestroyed()) captureWindow.loadURL(appUrl('/quick-capture')); }, 3000);
  });

  // The page calls window.close() when done; keep the window around (hidden) so it opens instantly next time.
  captureWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    captureWindow.hide();
  });
  // Hide when you click away, unless something is typed or attached: then taking a screenshot (or looking
  // something up) does not make the box disappear. Esc, the close button or saving still close it.
  captureWindow.on('blur', async () => {
    if (!captureWindow || captureWindow.webContents.isDevToolsOpened()) return;
    try {
      if (await captureWindow.webContents.executeJavaScript('window.__pebloCaptureDirty === true', true)) return;
    } catch { /* page not ready: just hide */ }
    if (captureWindow && !captureWindow.isDestroyed()) captureWindow.hide();
  });
  captureWindow.on('moved', () => { const [x, y] = captureWindow.getPosition(); captureMovedTo = { x, y }; });
  captureWindow.on('closed', () => { captureWindow = null; });
}

async function toggleCapture() {
  if (!captureWindow) createCaptureWindow();
  if (captureWindow.isVisible()) {
    captureWindow.hide();
    return;
  }
  // Soft Studio, River and Orbit have their own capture cards; Studio and Console share the compact box.
  let style = 'studio';
  try {
    style = await captureWindow.webContents.executeJavaScript("localStorage.getItem('peblo-style') || 'studio'", true);
  } catch { /* page still loading: use the default size */ }
  // The capture box has its own design canvas, drawn at the same scale as the main window.
  const canvas = CAPTURE_CANVAS[style] || CAPTURE_CANVAS.other;
  captureWindow.setResizable(true);
  captureWindow.setContentSize(Math.round(canvas.width * uiScale), Math.round(canvas.height * uiScale));
  captureWindow.setResizable(false);
  captureWindow.webContents.setZoomFactor(uiScale);
  // Center on the screen the mouse is on, a little above the middle.
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { x, y, width, height } = display.workArea;
  const [w, h] = captureWindow.getSize();
  // Reopen where the person last dragged it, as long as that spot is still on a screen.
  const saved = captureMovedTo && screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return captureMovedTo.x + 60 > a.x && captureMovedTo.x + 60 < a.x + a.width && captureMovedTo.y >= a.y && captureMovedTo.y + 60 < a.y + a.height;
  });
  if (saved) captureWindow.setPosition(captureMovedTo.x, captureMovedTo.y);
  else captureWindow.setPosition(Math.round(x + (width - w) / 2), Math.round(y + height * 0.28));
  // Windows often refuses to give focus to a window opened from the background: lift it above everything first.
  captureWindow.setAlwaysOnTop(true, 'screen-saver');
  captureWindow.show();
  captureWindow.moveTop();
  captureWindow.focus();
  captureWindow.webContents.focus();
  if (style === 'river') startCaptureFit(canvas);
}

let captureFitTimer = null;
/** The River card grows with what is typed (suggestions, meeting settings, clash list); keep the window as tall as the card. */
function startCaptureFit(canvas) {
  clearInterval(captureFitTimer);
  captureFitTimer = setInterval(async () => {
    if (!captureWindow || captureWindow.isDestroyed() || !captureWindow.isVisible()) { clearInterval(captureFitTimer); return; }
    try {
      const cssH = await captureWindow.webContents.executeJavaScript("(document.querySelector('.r-capture')||{}).offsetHeight || 0", true);
      if (!cssH) return;
      const area = screen.getDisplayMatching(captureWindow.getBounds()).workArea;
      const want = Math.min(Math.max(Math.round(cssH * uiScale), Math.round(canvas.height * uiScale)), area.height - 40);
      const [cw, ch] = captureWindow.getContentSize();
      if (Math.abs(ch - want) > 3) {
        captureWindow.setResizable(true);
        captureWindow.setContentSize(cw, want);
        captureWindow.setResizable(false);
        const b = captureWindow.getBounds();
        if (b.y + b.height > area.y + area.height) captureWindow.setPosition(b.x, Math.max(area.y, area.y + area.height - b.height - 10));
      }
    } catch { /* page busy */ }
  }, 150);
}

function createTray() {
  const image = nativeImage.createFromPath(ICON_PATH).resize({ width: process.platform === 'darwin' ? 18 : 16 });
  tray = new Tray(image);
  tray.setToolTip('Peblo');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => showMainWindow());
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Open Peblo', click: () => showMainWindow() },
    { label: 'Quick capture', accelerator: captureShortcut, click: () => toggleCapture() },
    { type: 'separator' },
    { label: 'Notes', click: () => showMainWindow('/notes') },
    { label: 'To-dos', click: () => showMainWindow('/todolist') },
    { label: 'Calendar', click: () => showMainWindow('/calendar') },
    { type: 'separator' },
    { label: 'Quit Peblo', click: () => { isQuitting = true; app.quit(); } },
  ]);
}

/** The shortcut shows in the Help menu and the tray menu, so rebuild both when it changes. */
function refreshMenus() {
  buildMenu();
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        ...(isDev ? [{ role: 'toggleDevTools' }] : []),
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Quick Capture',
          accelerator: captureShortcut,
          click: () => toggleCapture(),
        },
        {
          label: `Check for Updates… (v${app.getVersion()})`,
          click: () => updates.checkNow(updateCtx),
        },
        {
          label: 'Open Data Folder',
          click: () => shell.openPath(app.getPath('userData')),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('second-instance', () => showMainWindow());
app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());

app.whenReady().then(async () => {
  try {
    // With PEBLO_DEV_URL set (`npm run dev`), the API already runs separately via tsx + Vite.
    REMOTE_URL = DEV_URL ? null : readRemoteUrl();
    if (!DEV_URL && !REMOTE_URL) serverPort = await startBackend();
  } catch (err) {
    console.error(err);
    dialog.showErrorBox('Peblo could not start', String(err && err.stack ? err.stack : err));
    app.quit();
    return;
  }
  captureShortcut = readDesktopSettings().captureShortcut || DEFAULT_CAPTURE_SHORTCUT;
  if (!ACCELERATOR_RE.test(captureShortcut)) captureShortcut = DEFAULT_CAPTURE_SHORTCUT;
  await updates.clearStaleWebCache(); // a new app version must not show the pages of an old one
  buildMenu();
  createWindow();
  updates.init({ ...updateCtx, icon: ICON_PATH });
  // Moving to another monitor or changing Windows/macOS display scaling can change the content size.
  screen.on('display-metrics-changed', applyScale);
  try {
    createTray();
  } catch (err) {
    console.warn('Tray not available:', err.message); // some Linux desktops have no tray
  }
  let registered = false;
  try { registered = globalShortcut.register(captureShortcut, toggleCapture); } catch { registered = false; }
  if (!registered) {
    console.warn(`Could not register ${captureShortcut} (another app may be using it).`);
    if (Notification.isSupported()) {
      new Notification({
        title: 'Quick capture shortcut is not working',
        body: `${shortcutLabel(captureShortcut)} is used by Windows or another app. Pick another in Settings → Shortcuts.`,
        icon: ICON_PATH,
      }).show();
    }
  }
  // Pre-load the capture box in the background so the shortcut feels instant.
  setTimeout(() => { if (!captureWindow) createCaptureWindow(); }, 3000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // With a tray icon Peblo keeps running in the background; without one, quit as usual.
  if (process.platform !== 'darwin' && (!tray || readDesktopSettings().keepInTray === false)) app.quit();
});

// Design canvas check (npm run check:canvas). Only runs when the check starts the app.
if (process.env.PEBLO_CANVAS_CHECK) require('../scripts/canvas-check.cjs')({ getMainWindow: () => mainWindow });
