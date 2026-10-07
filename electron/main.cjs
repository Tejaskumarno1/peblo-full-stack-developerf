// Peblo desktop — Electron main process.
//
// Runs the Express API in-process on a random localhost port and shows the React UI in a window.
// Everything is stored in the shared MySQL database named by DATABASE_URL (see loadEnvFile).
const { app, BrowserWindow, shell, Menu, dialog, globalShortcut, Tray, nativeImage, Notification, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const isDev = !app.isPackaged;
const DEV_URL = process.env.PEBLO_DEV_URL; // e.g. http://localhost:5173 when running `npm run dev`

// PEBLO_DATA_DIR lets you run a throwaway copy (for testing) without touching your real notes.
if (process.env.PEBLO_DATA_DIR) app.setPath('userData', path.resolve(process.env.PEBLO_DATA_DIR));

// ── Only one copy of the app at a time (two copies would fight over the database) ──
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let captureWindow = null;
let tray = null;
let serverPort = null;
let isQuitting = false;
let trayHintShown = false;

const CAPTURE_SHORTCUT = 'CommandOrControl+Shift+Space';

// ── Design canvas ──
// Every screen is designed at 1440 × 900 (client/src/styles/canvas.css). Here we pick one
// zoom factor so 1440 × 900 just fits the window, and apply it to the whole page: the design's
// height (or width, in a tall window) fills the window exactly and the other side gets the
// extra room. Window size, screen DPI, OS display scaling and Ctrl + / Ctrl − then only change
// how big the design is drawn, never its proportions.
// Keep these sizes in sync with client/src/styles/canvas.css.
const CANVAS = { width: 1440, height: 900 };
const CAPTURE_CANVAS = {
  soft: { width: 760, height: 400 },
  river: { width: 640, height: 200 },
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
  const base = DEV_URL || `http://127.0.0.1:${serverPort}`;
  return base.replace(/\/$/, '') + route;
}

function isInternal(target) {
  try {
    const u = new URL(target);
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost';
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
  win.webContents.on('will-navigate', (event, target) => {
    if (!isInternal(target)) {
      event.preventDefault();
      if (/^https?:|^mailto:/.test(target)) shell.openExternal(target);
    }
  });
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
  const engine = fs.readdirSync(dir).find((f) => /query_engine.*\.node$/.test(f));
  if (engine) process.env.PRISMA_QUERY_ENGINE_LIBRARY = path.join(dir, engine);
}

/**
 * The database is a MySQL server shared by every account, so the app needs its address
 * (DATABASE_URL) and the secret that signs sign-ins (JWT_SECRET). They come from the environment,
 * or from the first .env file found: PEBLO_ENV_FILE, one in the app-data folder, or server/.env
 * when running from the project folder.
 */
function loadEnvFile() {
  const candidates = [
    process.env.PEBLO_ENV_FILE,
    path.join(app.getPath('userData'), '.env'),
    path.join(app.getAppPath(), 'server', '.env'),
  ].filter(Boolean);
  const file = candidates.find((f) => fs.existsSync(f));
  if (file) require('dotenv').config({ path: file });
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Put your MySQL connection string in server/.env (or set PEBLO_ENV_FILE), then start Peblo again.');
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
    backgroundColor: '#F6F5F2',
    icon: ICON_PATH,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  lockZoom(mainWindow);
  for (const ev of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'moved']) mainWindow.on(ev, applyScale);
  applyScale();

  mainWindow.once('ready-to-show', () => { applyScale(); mainWindow.show(); });
  mainWindow.loadURL(appUrl('/'));
  secureWebContents(mainWindow);

  // Microphone for voice notes / AI voice calls; nothing else is granted.
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['media', 'clipboard-sanitized-write', 'notifications'].includes(permission));
  });

  // Closing the window keeps Peblo running in the tray so quick capture keeps working.
  mainWindow.on('close', (event) => {
    if (isQuitting || !tray) return;
    event.preventDefault();
    mainWindow.hide();
    if (!trayHintShown && Notification.isSupported()) {
      trayHintShown = true;
      new Notification({
        title: 'Peblo is still running',
        body: `Press ${process.platform === 'darwin' ? '⌘' : 'Ctrl'}+Shift+Space anywhere to capture a note or task. Quit from the tray icon.`,
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
    backgroundColor: '#ffffff',
    title: 'Quick capture',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  lockZoom(captureWindow);
  captureWindow.loadURL(appUrl('/quick-capture'));
  secureWebContents(captureWindow);

  // The page calls window.close() when done; keep the window around (hidden) so it opens instantly next time.
  captureWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    captureWindow.hide();
  });
  captureWindow.on('blur', () => {
    if (captureWindow && !captureWindow.webContents.isDevToolsOpened()) captureWindow.hide();
  });
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
  captureWindow.setPosition(Math.round(x + (width - w) / 2), Math.round(y + height * 0.28));
  captureWindow.show();
  captureWindow.focus();
}

function createTray() {
  const image = nativeImage.createFromPath(ICON_PATH).resize({ width: process.platform === 'darwin' ? 18 : 16 });
  tray = new Tray(image);
  tray.setToolTip('Peblo');
  const menu = Menu.buildFromTemplate([
    { label: 'Open Peblo', click: () => showMainWindow() },
    { label: 'Quick capture', accelerator: CAPTURE_SHORTCUT, click: () => toggleCapture() },
    { type: 'separator' },
    { label: 'Notes', click: () => showMainWindow('/notes') },
    { label: 'To-dos', click: () => showMainWindow('/todolist') },
    { label: 'Calendar', click: () => showMainWindow('/calendar') },
    { type: 'separator' },
    { label: 'Quit Peblo', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => showMainWindow());
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
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Quick Capture',
          accelerator: CAPTURE_SHORTCUT,
          click: () => toggleCapture(),
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
    if (!DEV_URL) serverPort = await startBackend();
  } catch (err) {
    console.error(err);
    dialog.showErrorBox('Peblo could not start', String(err && err.stack ? err.stack : err));
    app.quit();
    return;
  }
  buildMenu();
  createWindow();
  // Moving to another monitor or changing Windows/macOS display scaling can change the content size.
  screen.on('display-metrics-changed', applyScale);
  try {
    createTray();
  } catch (err) {
    console.warn('Tray not available:', err.message); // some Linux desktops have no tray
  }
  if (!globalShortcut.register(CAPTURE_SHORTCUT, toggleCapture)) {
    console.warn(`Could not register ${CAPTURE_SHORTCUT} (another app may be using it).`);
  }
  // Pre-load the capture box in the background so the shortcut feels instant.
  setTimeout(() => { if (!captureWindow) createCaptureWindow(); }, 3000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // With a tray icon Peblo keeps running in the background; without one, quit as usual.
  if (process.platform !== 'darwin' && !tray) app.quit();
});

// Design canvas check (npm run check:canvas). Only runs when the check starts the app.
if (process.env.PEBLO_CANVAS_CHECK) require('../scripts/canvas-check.cjs')({ getMainWindow: () => mainWindow });
