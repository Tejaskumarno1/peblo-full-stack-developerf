// Peblo desktop — Electron main process.
//
// Runs the Express API in-process on a random localhost port, stores everything in a
// SQLite file inside the OS app-data folder, and shows the React UI in a window.
const { app, BrowserWindow, shell, Menu, dialog } = require('electron');
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
let serverPort = null;

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
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Peblo',
    backgroundColor: '#f7f7f8',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  const url = DEV_URL || `http://127.0.0.1:${serverPort}/`;
  mainWindow.loadURL(url);

  // Links to other websites open in the user's normal browser, not inside the app.
  const isInternal = (target) => {
    try {
      const u = new URL(target);
      return (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
    } catch {
      return false;
    }
  };
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isInternal(target)) return { action: 'allow' };
    if (/^https?:|^mailto:/.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (!isInternal(target)) {
      event.preventDefault();
      if (/^https?:|^mailto:/.test(target)) shell.openExternal(target);
    }
  });

  // Microphone for voice notes / AI voice calls; nothing else is granted.
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['media', 'clipboard-sanitized-write', 'notifications'].includes(permission));
  });

  if (DEV_URL) mainWindow.webContents.openDevTools({ mode: 'detach' });
  mainWindow.on('closed', () => { mainWindow = null; });
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
          label: 'Open Data Folder',
          click: () => shell.openPath(app.getPath('userData')),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
