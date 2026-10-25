// Uninstalling Peblo from inside the app (Windows).
//
// The person picks what happens to the files Peblo keeps on this computer:
//   - keep them (a later install picks up where they left off), or remove everything;
//   - optionally copy them to a backup folder in Documents first.
// A running program cannot delete itself, so the app writes a small PowerShell script, starts it detached and quits.
// The script waits for Peblo to close, runs the real uninstaller (which removes the program, shortcuts and the
// "Apps" entry), then deletes the leftovers. Notes that live in the person's cloud account are not touched.
const { app, dialog, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

/** Quote text for a PowerShell single-quoted string. */
const psq = (s) => "'" + String(s).replace(/'/g, "''") + "'";

/**
 * Only ever delete a folder that is clearly Peblo's own: its name contains "peblo" and it is not a drive root,
 * the home folder or a folder that merely holds other things (PEBLO_DATA_DIR could point anywhere).
 */
function isSafeDataDir(dir, home = os.homedir()) {
  if (!dir || typeof dir !== 'string') return false;
  const norm = path.resolve(dir);
  const base = path.basename(norm).toLowerCase();
  if (!base.includes('peblo')) return false;
  if (path.parse(norm).root === norm) return false;
  const h = path.resolve(home).toLowerCase();
  const n = norm.toLowerCase();
  if (n === h || h.startsWith(n + path.sep)) return false;
  return true;
}

/** The folders and files, other than the program itself, that Peblo leaves on this computer. */
function leftoverPaths({ dataDir, localAppData, temp }) {
  const list = [];
  if (isSafeDataDir(dataDir)) list.push(dataDir);
  if (localAppData) {
    list.push(path.join(localAppData, 'peblo-updater')); // electron-updater's download cache
    list.push(path.join(localAppData, 'Peblo'));
  }
  if (temp) list.push(path.join(temp, 'peblo-backup-staging'));
  return list;
}

/** PowerShell that runs after Peblo has quit. Exported so the tests can read it. */
function buildCleanupScript({ pid, installDir, uninstaller, removeData, leftovers, logFile }) {
  const lines = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `function Log($m) { Add-Content -LiteralPath ${psq(logFile)} -Value ((Get-Date -Format s) + ' ' + $m) }`,
    "Log 'start'",
    `try { Wait-Process -Id ${Number(pid) | 0} -Timeout 60 } catch { }`,
    // Anything left over from tray / capture windows.
    `Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith(${psq(installDir)}, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force`,
    'Start-Sleep -Seconds 1',
    // "_?=" makes the uninstaller work in place and wait, instead of copying itself to Temp and returning at once.
    `Start-Process -FilePath ${psq(uninstaller)} -ArgumentList '/currentuser','/S',${psq('_?=' + installDir)} -Wait`,
    "Log 'uninstaller finished'",
    `Remove-Item -LiteralPath ${psq(installDir)} -Recurse -Force`,
    "Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'Peblo','electron.app.Peblo','com.peblo.app','dev.peblo.app'",
  ];
  if (removeData) {
    for (const p of leftovers) lines.push(`Remove-Item -LiteralPath ${psq(p)} -Recurse -Force`);
    lines.push("Log 'data removed'");
  }
  lines.push("Log 'done'");
  // The script deletes itself last.
  lines.push('Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force');
  return lines.join('\r\n') + '\r\n';
}

/** What this copy of Peblo can do. Only an installed Windows copy has an uninstaller. */
function info() {
  const installDir = path.dirname(process.execPath);
  const uninstaller = path.join(installDir, 'Uninstall Peblo.exe');
  const available = process.platform === 'win32' && app.isPackaged && fs.existsSync(uninstaller);
  return {
    available,
    version: app.getVersion(),
    installDir: available ? installDir : null,
    dataDir: app.getPath('userData'),
    reason: available ? null : (process.platform !== 'win32' ? 'Uninstall from the app is available on Windows. On this system, remove Peblo the way you installed it.' : 'This copy was not set up with the installer, so there is nothing to uninstall. Delete its folder instead.'),
  };
}

const stamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '');

/** Copy the small files Peblo keeps here (settings, any local database) to Documents. Returns the folder. */
function makeBackup() {
  const dataDir = app.getPath('userData');
  const dest = path.join(app.getPath('documents'), `Peblo backup ${stamp()}`);
  fs.mkdirSync(dest, { recursive: true });
  const keep = ['peblo.db', 'desktop-settings.json', 'server-url.txt', 'window-bg.txt'];
  const copied = [];
  for (const name of keep) {
    const from = path.join(dataDir, name);
    if (fs.existsSync(from)) { fs.copyFileSync(from, path.join(dest, name)); copied.push(name); }
  }
  fs.writeFileSync(path.join(dest, 'README.txt'),
    'This folder was made by Peblo just before it was uninstalled.\r\n' +
    'It holds only what was stored on this computer. Notes, tasks and events in your Peblo account stay in the cloud\r\n' +
    'and appear again when you sign in after reinstalling. To keep a copy of those too, use Settings > Data > Export notes.\r\n');
  return { dest, copied };
}

/**
 * @param {{ trusted: (event: any) => boolean, getWindow: () => import('electron').BrowserWindow | null, beforeQuit: () => void }} ctx
 */
function register(ctx) {
  ipcMain.handle('peblo:uninstall:info', (event) => (ctx.trusted(event) ? info() : null));

  ipcMain.handle('peblo:uninstall:run', async (event, opts) => {
    if (!ctx.trusted(event)) return { ok: false, error: 'Not allowed.' };
    const state = info();
    if (!state.available) return { ok: false, error: state.reason };
    const removeData = !!(opts && opts.removeData);
    const backup = !!(opts && opts.backup);

    const choice = await dialog.showMessageBox(ctx.getWindow() || undefined, {
      type: 'warning',
      title: 'Uninstall Peblo',
      message: 'Uninstall Peblo from this computer?',
      detail:
        (backup ? 'A backup of the files stored here will be saved to your Documents folder first.\n' : '') +
        (removeData
          ? 'Everything Peblo stored on this computer will be deleted, including settings and caches.\n'
          : 'Your settings will stay on this computer, so a later install picks up where you left off.\n') +
        'Notes and tasks in your Peblo account are not deleted.',
      buttons: ['Uninstall', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (choice.response !== 0) return { ok: false, cancelled: true };

    let backupDir = null;
    if (backup) {
      try { backupDir = makeBackup().dest; } catch (err) {
        return { ok: false, error: 'Could not save the backup, so nothing was removed: ' + err.message };
      }
    }

    const dataDir = app.getPath('userData');
    if (removeData && !isSafeDataDir(dataDir)) {
      return { ok: false, error: 'Peblo will not delete this data folder because it is not clearly Peblo\'s own. Nothing was removed.' };
    }
    const logFile = path.join(os.tmpdir(), 'peblo-uninstall.log');
    const script = buildCleanupScript({
      pid: process.pid,
      installDir: state.installDir,
      uninstaller: path.join(state.installDir, 'Uninstall Peblo.exe'),
      removeData,
      leftovers: leftoverPaths({ dataDir, localAppData: process.env.LOCALAPPDATA, temp: os.tmpdir() }),
      logFile,
    });
    const scriptFile = path.join(os.tmpdir(), `peblo-uninstall-${process.pid}.ps1`);
    try {
      fs.writeFileSync(scriptFile, '﻿' + script, 'utf8'); // BOM so PowerShell reads any non-ASCII path correctly
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptFile], {
        detached: true, stdio: 'ignore', windowsHide: true,
      });
      child.unref();
    } catch (err) {
      return { ok: false, error: 'Could not start the uninstaller: ' + err.message };
    }

    try { app.setLoginItemSettings({ openAtLogin: false }); } catch { /* not set */ }
    ctx.beforeQuit();
    setTimeout(() => app.quit(), 900); // let the answer reach the page first
    return { ok: true, backupDir, removeData };
  });
}

module.exports = { register, info, isSafeDataDir, leftoverPaths, buildCleanupScript, psq };
