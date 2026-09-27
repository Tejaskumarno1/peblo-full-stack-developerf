// Peblo desktop — Electron main process.
//
// Runs the Express API in-process on a random localhost port, stores everything in a
// SQLite file inside the OS app-data folder, and shows the React UI in a window.
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

async function startBackend() {
  const dataDir = app.getPath('userData');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbFile = path.join(dataDir, 'peblo.db');

  // Prisma wants forward slashes in file: URLs, also on Windows.
  process.env.DATABASE_URL = 'file:' + dbFile.replace(/\\/g, '/');
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
  // Open at the size the designs are drawn for (1440 × 900 of content) when the screen allows.
  const work = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1456, work.width),
    height: Math.min(940, work.height),
    minWidth: 900,
    minHeight: 600,
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

  mainWindow.once('ready-to-show', () => mainWindow.show());
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
    width: 620,
    height: 256,
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
  // Soft Studio's capture card is bigger; every other style keeps the compact box.
  let style = 'studio';
  try {
    style = await captureWindow.webContents.executeJavaScript("localStorage.getItem('peblo-style') || 'studio'", true);
  } catch { /* page still loading: use the default size */ }
  const [cw, ch] = style === 'soft' ? [760, 400] : [620, 256];
  captureWindow.setResizable(true);
  captureWindow.setSize(cw, ch);
  captureWindow.setResizable(false);
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
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
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
