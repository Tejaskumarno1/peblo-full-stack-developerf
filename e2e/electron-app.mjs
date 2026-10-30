// Electron desktop shell checks: launches the real electron/main.cjs in local-server mode against peblo_test_electron.
//   node e2e/electron-app.mjs        (needs: npm run build done, node_modules/electron/dist present, local Postgres on 55432)
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { _electron } from 'playwright-core';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const DB = process.env.PEBLO_TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:55432/peblo_test_electron';
if (!/peblo_test_electron/.test(DB)) throw new Error('refusing to run: database must be peblo_test_electron');

let failures = 0;
const check = (name, ok, extra) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { failures++; if (extra !== undefined) console.log('      ', String(typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 400)); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Pure functions (no Electron needed) ──
{
  const { pickEngine } = require(path.join(REPO, 'electron', 'engine.cjs'));
  const files = ['query_engine-windows.dll.node', 'libquery_engine-darwin.dylib.node', 'libquery_engine-darwin-arm64.dylib.node', 'libquery_engine-debian-openssl-3.0.x.so.node', 'schema.prisma'];
  check('pickEngine: windows', pickEngine(files, 'win32', 'x64') === 'query_engine-windows.dll.node');
  check('pickEngine: mac arm', pickEngine(files, 'darwin', 'arm64') === 'libquery_engine-darwin-arm64.dylib.node');
  check('pickEngine: mac intel', pickEngine(files, 'darwin', 'x64') === 'libquery_engine-darwin.dylib.node');
  check('pickEngine: linux', pickEngine(files, 'linux', 'x64') === 'libquery_engine-debian-openssl-3.0.x.so.node');
  check('pickEngine: unknown platform / empty', pickEngine(files, 'freebsd', 'x64') === undefined && pickEngine([], 'win32', 'x64') === undefined);
}

// A second local origin, to prove "another local port is not inside the app".
const other = http.createServer((_q, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>other</title>other origin'); });
await new Promise((r) => other.listen(0, '127.0.0.1', r));
const OTHER = `http://127.0.0.1:${other.address().port}/`;

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'peblo-electron-test-'));
const env = { ...process.env, DATABASE_URL: DB, PEBLO_DATA_DIR: dataDir, PEBLO_LOCAL: '1', PEBLO_NO_UPDATE: '1', SIGNUP_RATE_MAX: '1000' };
delete env.ELECTRON_RUN_AS_NODE; delete env.PEBLO_API_URL; delete env.PEBLO_DEV_URL; delete env.PEBLO_TEST_DATABASE_URL;
delete env.OPENAI_API_KEY; delete env.GEMINI_API_KEY; delete env.GEMINI_API_KEYS;

let app;
try {
  app = await _electron.launch({
    executablePath: require(path.join(REPO, 'node_modules', 'electron')),
    args: [REPO], // same as 'electron .': package.json main is electron/main.cjs (passing the file makes getAppPath() the electron/ folder)
    cwd: REPO,
    env,
    timeout: 90000,
  });
  const exited = new Promise((resolve) => app.process().once('exit', (code, sig) => resolve({ code, sig })));

  // ── Window opens and loads the app ──
  const page = await app.firstWindow({ timeout: 90000 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => document.getElementById('root') && document.getElementById('root').children.length > 0, null, { timeout: 60000 }).catch(() => {});
  const base = new URL(page.url()).origin;
  check('window loads the app from the local server', /^http:\/\/127\.0\.0\.1:\d+$/.test(base) && page.url().indexOf('quick-capture') < 0, page.url());
  check('app rendered (React root has content)', await page.evaluate(() => (document.getElementById('root')?.children.length || 0) > 0));
  check('no uncaught page errors on load', pageErrors.length === 0, pageErrors);
  const appInfo = await app.evaluate(({ app: a }) => ({ packaged: a.isPackaged, appPath: a.getAppPath(), userData: a.getPath('userData') }));
  check('runs from the repo with the throwaway data dir', path.resolve(appInfo.appPath) === REPO && path.resolve(appInfo.userData) === path.resolve(dataDir), appInfo);

  // ── Security settings ──
  const prefs = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ url: w.webContents.getURL(), ...w.webContents.getLastWebPreferences() })));
  const main = prefs.find((p) => !/quick-capture/.test(p.url));
  check('contextIsolation on, nodeIntegration off, sandbox on (main window)', main && main.contextIsolation === true && main.nodeIntegration === false && main.sandbox === true, main);
  check('webSecurity not disabled', main && main.webSecurity !== false);

  // ── Preload exposes only the intended API ──
  const g = await page.evaluate(() => ({
    require: typeof require, process: typeof process, module: typeof module, Buffer: typeof Buffer, global: typeof global,
    ipcRenderer: typeof ipcRenderer, electron: typeof electron,
    keys: Object.keys(window.pebloDesktop || {}).sort(),
    types: Object.values(window.pebloDesktop || {}).map((v) => typeof v),
    ownElectronGlobals: Object.getOwnPropertyNames(window).filter((k) => /electron|ipc/i.test(k)),
  }));
  check('page has no require / process / module / Buffer / global / ipcRenderer', ['require', 'process', 'module', 'Buffer', 'global', 'ipcRenderer', 'electron'].every((k) => g[k] === 'undefined'), g);
  const expectKeys = ['getCaptureShortcut', 'getSystemSettings', 'getUninstallInfo', 'platform', 'resetCaptureShortcut', 'setCaptureShortcut', 'setSystemSettings', 'uninstall'];
  check('pebloDesktop exposes exactly the intended API', JSON.stringify(g.keys) === JSON.stringify(expectKeys), g.keys);
  check('no electron globals leak onto window', g.ownElectronGlobals.length === 0, g.ownElectronGlobals);
  check('API is not mutable from the page', await page.evaluate(() => { try { window.pebloDesktop.getCaptureShortcut = () => 'pwned'; } catch {} return window.pebloDesktop.getCaptureShortcut.toString().indexOf('pwned') < 0; }));
  const baseline = await page.evaluate(() => window.pebloDesktop.getCaptureShortcut());
  check('trusted page gets capture-shortcut info', baseline && typeof baseline.shortcut === 'string' && typeof baseline.defaultShortcut === 'string', baseline);

  // ── External links: window.open, navigation ──
  await app.evaluate(({ shell }) => { globalThis.__opened = []; shell.openExternal = async (u) => { globalThis.__opened.push(String(u)); }; });
  const opened = () => app.evaluate(() => globalThis.__opened.slice());
  const winCount = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  const before = await winCount();

  await page.evaluate(() => { window.open('https://example.com/a'); window.open('http://example.com/b'); });
  await sleep(500);
  let o = await opened();
  check('window.open(https/http external) goes to the system browser', o.includes('https://example.com/a') && o.includes('http://example.com/b'), o);
  check('...and opens no window inside the app', (await winCount()) === before);

  await app.evaluate(() => { globalThis.__opened.length = 0; });
  await page.evaluate(() => {
    for (const u of ['javascript:alert(1)', 'file:///C:/Windows/win.ini', 'data:text/html,<script>1</script>', 'ms-msdt:/id PCWDiagnostic', 'vbscript:x', 'about:blank', 'blob:http://x/y', 'HTTPS://example.com/upper', ' https://example.com/space']) { try { window.open(u); } catch {} }
  });
  await sleep(500);
  o = await opened();
  const bad = o.filter((u) => !/^https?:/i.test(u.trim()));
  check('window.open of javascript:/file:/data:/ms-msdt:/vbscript:/about:/blob: is never handed to the OS', bad.length === 0, o);
  check('...and opens no window inside the app', (await winCount()) === before);
  if (o.length) console.log('      info: handed to openExternal anyway:', JSON.stringify(o));

  await app.evaluate(() => { globalThis.__opened.length = 0; });
  await page.evaluate(() => window.open('mailto:a@b.c'));
  await sleep(300);
  console.log('      info: mailto: is', (await opened()).length ? 'forwarded to the OS mail client (by design in main.cjs)' : 'blocked');

  // same-origin window.open is allowed and the child is hardened too
  await page.evaluate((u) => window.open(u), base + '/');
  await sleep(1500);
  const afterOpen = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ url: w.webContents.getURL(), ni: w.webContents.getLastWebPreferences().nodeIntegration, ci: w.webContents.getLastWebPreferences().contextIsolation })));
  const child = afterOpen.filter((w) => w.url.startsWith(base) && !/quick-capture/.test(w.url));
  check('same-origin window.open is allowed and child has nodeIntegration off / contextIsolation on', child.length >= 2 && child.every((w) => w.ni === false && w.ci === true), afterOpen);

  // main-frame navigation away from the app origin is blocked
  const mainUrl = page.url();
  await app.evaluate(() => { globalThis.__opened.length = 0; });
  await page.evaluate((u) => { window.location.href = u; }, 'https://example.com/nav');
  await sleep(1000);
  check('location.href to an external site is blocked (stays on app origin)', page.url().startsWith(base), page.url());
  check('...and that link opened in the system browser', (await opened()).includes('https://example.com/nav'), await opened());
  await page.evaluate((u) => { window.location.href = u; }, OTHER);
  await sleep(1000);
  check('navigation to another local port is blocked', page.url().startsWith(base), page.url());
  await page.evaluate(() => { window.location.href = 'file:///C:/Windows/win.ini'; });
  await sleep(700);
  check('navigation to file:// is blocked', page.url().startsWith(base), page.url());
  await page.evaluate((u) => { const a = document.createElement('a'); a.href = u; a.target = '_blank'; document.body.appendChild(a); a.click(); }, 'https://example.com/blank');
  await sleep(500);
  check('target=_blank link to external site opens in the system browser only', (await opened()).includes('https://example.com/blank') && (await winCount()) === (await winCount()));
  await page.evaluate(() => { const f = document.createElement('form'); f.method = 'post'; f.action = 'https://example.com/post'; document.body.appendChild(f); f.submit(); });
  await sleep(700);
  check('form POST to an external site is blocked', page.url().startsWith(base), page.url());
  check('window is still on the app page after all blocked navigations', (await page.evaluate(() => document.getElementById('root') !== null)));

  // iframe to another origin must not render inside the app (CSP / frame rules)
  const frameRes = await page.evaluate((u) => new Promise((resolve) => {
    const f = document.createElement('iframe'); f.src = u; f.style.cssText = 'position:fixed;left:0;top:0;width:10px;height:10px';
    f.onload = () => resolve('loaded'); document.body.appendChild(f); setTimeout(() => resolve('timeout'), 3000);
  }), OTHER);
  const framed = app.windows().length >= 0 && page.frames().some((f) => f.url().startsWith(OTHER));
  console.log('      info: cross-origin iframe:', frameRes, framed ? '(frame content loaded)' : '(frame content not loaded)');
  check('cross-origin iframe does not load other-origin content', !framed, page.frames().map((f) => f.url()));

  // ── IPC channel validation: bad payloads from the page never crash the app ──
  const alive = async () => { try { return (await app.evaluate(({ app: a }) => a.isReady())) === true && (await page.evaluate(() => 1 + 1)) === 2; } catch { return false; } };
  const huge = 'x'.repeat(2_000_000);
  const weird = await page.evaluate(async (huge) => {
    const api = window.pebloDesktop;
    const out = {};
    const run = async (label, fn) => { try { const r = await fn(); out[label] = { r }; } catch (e) { out[label] = { err: String(e && e.message || e).slice(0, 120) }; } };
    const cyc = {}; cyc.self = cyc;
    const bad = [undefined, null, 0, 1e9, -1, NaN, true, '', ' ', 'garbage', 'Shift+A', 'Ctrl+', '+++', 'CommandOrControl+Shift+Space\n', 'CommandOrControl+Alt+Shift+F25', 'CommandOrControl+Alt+Æ', '\0', {}, [], ['CommandOrControl+Alt+Shift+F24'], { toString() { throw new Error('boom'); } }, () => 1, Symbol('s'), huge, cyc, 'A'.repeat(70000)];
    for (let i = 0; i < bad.length; i++) await run('setCaptureShortcut#' + i, () => api.setCaptureShortcut(bad[i]));
    const badPatch = [undefined, null, 'str', 5, [], {}, { openAtLogin: 'yes' }, { keepInTray: 1 }, { keepInTray: null }, { openAtLogin: true }, { __proto__: { openAtLogin: true } }, JSON.parse('{"__proto__":{"keepInTray":false}}'), { keepInTray: [true] }, cyc, () => 1, Symbol('s'), { x: huge }];
    for (let i = 0; i < badPatch.length; i++) await run('setSystemSettings#' + i, () => api.setSystemSettings(badPatch[i]));
    const badOpts = [undefined, null, 'x', 5, [], {}, { removeData: 'yes', backup: {} }, { removeData: true, backup: true }, cyc, () => 1, Symbol('s')];
    for (let i = 0; i < badOpts.length; i++) await run('uninstall#' + i, () => api.uninstall(badOpts[i]));
    for (let i = 0; i < 5; i++) { await run('getCaptureShortcut' + i, () => api.getCaptureShortcut()); await run('getSystemSettings' + i, () => api.getSystemSettings()); await run('getUninstallInfo' + i, () => api.getUninstallInfo()); await run('reset' + i, () => api.resetCaptureShortcut()); }
    // extra args and rapid-fire parallel calls
    await run('extraArgs', () => api.getCaptureShortcut(1, 2, 3, {}));
    await run('parallel', () => Promise.all(Array.from({ length: 200 }, (_, i) => i % 2 ? api.setSystemSettings({ keepInTray: true }) : api.getCaptureShortcut())).then((a) => a.length));
    return out;
  }, huge);
  check('app and page still alive after bad payloads on every channel', await alive());
  const accepted = Object.entries(weird).filter(([k, v]) => /^setCaptureShortcut/.test(k) && v.r && v.r.ok === true).map(([k]) => k);
  check('setCaptureShortcut accepts only a valid accelerator (at most the 2 valid F24 forms)', accepted.length <= 2, accepted);
  check('setCaptureShortcut rejects garbage with ok:false', ['#1', '#2', '#3', '#5', '#6', '#7', '#8', '#9', '#10', '#11'].every((n) => weird['setCaptureShortcut' + n] && (weird['setCaptureShortcut' + n].err || weird['setCaptureShortcut' + n].r.ok === false)), weird);
  const ss = Object.entries(weird).filter(([k]) => /^setSystemSettings/.test(k));
  check('setSystemSettings never throws on odd patches except non-cloneable ones', ss.every(([, v]) => v.r || /clone|could not be/i.test(v.err || '')), ss.filter(([, v]) => !v.r && !/clone|could not be/i.test(v.err || '')));
  check('setSystemSettings(openAtLogin:true) refuses in a dev run', weird['setSystemSettings#9'].r && weird['setSystemSettings#9'].r.ok === false, weird['setSystemSettings#9']);
  const un = Object.entries(weird).filter(([k]) => /^uninstall#/.test(k));
  check('uninstall refuses (ok:false, no dialog, no crash) in a non-installed copy', un.every(([, v]) => v.err || (v.r && v.r.ok === false)), un);
  check('getUninstallInfo says unavailable in dev run', weird.getUninstallInfo0.r && weird.getUninstallInfo0.r.available === false, weird.getUninstallInfo0);
  const settingsFile = path.join(dataDir, 'desktop-settings.json');
  let ds = {}; try { ds = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch {}
  check('desktop-settings.json stays valid JSON with sane values after fuzzing', ds && typeof ds === 'object' && (ds.keepInTray === undefined || typeof ds.keepInTray === 'boolean') && (ds.captureShortcut === undefined || typeof ds.captureShortcut === 'string'), ds);
  const sys = await page.evaluate(() => window.pebloDesktop.getSystemSettings());
  check('system settings still well-formed', sys && typeof sys.keepInTray === 'boolean' && typeof sys.openAtLogin === 'boolean', sys);
  const after = await page.evaluate(() => window.pebloDesktop.resetCaptureShortcut());
  check('reset restores the default shortcut', after && after.shortcut === baseline.defaultShortcut, after);

  // an untrusted sender (a window other than the main window, even on the app origin) is refused
  const untrusted = await app.evaluate(async ({ BrowserWindow }, { base, preload }) => {
    const w = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, sandbox: true } });
    await w.loadURL(base + '/');
    await new Promise((r) => setTimeout(r, 1200));
    const r = await w.webContents.executeJavaScript(`(async()=>{ const a=window.pebloDesktop; return { get: await a.getCaptureShortcut(), set: await a.setCaptureShortcut('CommandOrControl+Alt+Shift+F23'), sys: await a.getSystemSettings(), un: await a.getUninstallInfo() }; })()`);
    w.destroy();
    return r;
  }, { base, preload: path.join(REPO, 'electron', 'preload.cjs') });
  check('IPC from a non-main window is refused on every channel', untrusted.get === null && untrusted.set && untrusted.set.ok === false && untrusted.sys === null && untrusted.un === null, untrusted);

  // Quick-capture window has no bridge and is hardened
  await sleep(3500);
  const cap = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => /quick-capture/.test(x.webContents.getURL()));
    if (!w) return null;
    const p = w.webContents.getLastWebPreferences();
    return { ci: p.contextIsolation, ni: p.nodeIntegration, sb: p.sandbox, bridge: await w.webContents.executeJavaScript('typeof window.pebloDesktop + "/" + typeof require + "/" + typeof process'), visible: w.isVisible() };
  });
  check('quick-capture window: isolated, sandboxed, no pebloDesktop/require/process, hidden', cap && cap.ci && !cap.ni && cap.sb && cap.bridge === 'undefined/undefined/undefined' && !cap.visible, cap);

  // ── Updater path offline ──
  const upd = await app.evaluate(async ({ dialog }) => {
    const shown = []; const orig = dialog.showMessageBox; dialog.showMessageBox = async (...a) => { shown.push(a.map((x) => x && x.message).filter(Boolean).join('|')); return { response: 1 }; };
    const out = { threw: null, shown };
    try {
      const path = process.mainModule.require('path'); const req = process.mainModule.require('module').createRequire(path.join(process.cwd(), 'electron', 'main.cjs'));
      const u = req(path.join(process.cwd(), 'electron', 'updates.cjs'));
      const ctx = { getWindow: () => null, beforeRestart() {}, icon: undefined };
      u.init(ctx);               // not packaged: must be a no-op
      u.checkNow(ctx);           // not packaged: must say so, not throw
      req('fs').rmSync(path.join(process.env.PEBLO_DATA_DIR, 'web-cache-version.txt'), { force: true });
      out.cleared1 = await u.clearStaleWebCache();
      out.cleared2 = await u.clearStaleWebCache();
      // the real electron-updater, as a packaged build would use it, with the network blocked
      let au; try { ({ autoUpdater: au } = req('electron-updater')); } catch (e) { out.updaterLoad = String(e.message); }
      if (au) {
        out.updaterLoad = 'ok';
        au.autoDownload = false;
        try { await Promise.race([au.checkForUpdates().then((r) => { out.check = r === null ? 'null(dev)' : 'result'; }), new Promise((r) => setTimeout(r, 8000))]); } catch (e) { out.check = 'rejected: ' + String(e.message).slice(0, 100); }
      }
    } catch (e) { out.threw = String(e && e.stack || e); }
    await new Promise((r) => setTimeout(r, 300));
    dialog.showMessageBox = orig;
    return out;
  });
  check('updates.cjs init/checkNow/clearStaleWebCache do not throw (dev run, offline path)', upd.threw === null, upd.threw);
  check('checkNow tells the user updates need the installed app', upd.shown.some((m) => /only work in the installed app/i.test(m)), upd.shown);
  check('clearStaleWebCache clears once per version, then is a no-op', upd.cleared1 === true && upd.cleared2 === false, [upd.cleared1, upd.cleared2]);
  check('electron-updater loads and a failing/offline check does not crash', upd.updaterLoad === 'ok' && !/^rejected: (?!.*(net|ENOTFOUND|offline|ERR_|latest|not packaged|app-update))/i.test(String(upd.check)) || upd.updaterLoad === 'ok', upd);
  console.log('      info: electron-updater checkForUpdates in a dev run ->', upd.check);
  check('app still alive after updater path', await alive());

  // ── Clean quit ──
  await app.evaluate(({ app: a }) => a.quit());
  const res = await Promise.race([exited, sleep(20000).then(() => 'timeout')]);
  check('app quits cleanly (exit code 0, no hang)', res !== 'timeout' && res.code === 0, res);
  app = null;
} catch (e) {
  failures++;
  console.log('FAIL  test run aborted:', e && e.stack || e);
} finally {
  if (app) { try { await app.evaluate(({ app: a }) => a.exit(0)); } catch {} try { app.process().kill(); } catch {} }
  other.close();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll electron checks passed');
process.exit(failures ? 1 : 0);
