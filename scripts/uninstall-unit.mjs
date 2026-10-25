// Unit tests for electron/uninstall.cjs: what it will and will not delete, and that the cleanup script is valid PowerShell.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
// The module only needs Electron at run time; give the tests a stand-in so they run under plain Node.
const Module = require('node:module');
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  return request === 'electron' ? { app: {}, dialog: {}, ipcMain: {} } : realLoad.call(this, request, ...rest);
};
const u = require('../electron/uninstall.cjs');
let n = 0;
const ok = (name, fn) => { fn(); n += 1; console.log('ok -', name); };

const home = process.platform === 'win32' ? 'C:\\Users\\tejas' : '/home/tejas';
const j = (...p) => path.join(...p);

ok('only a folder called peblo is safe to delete', () => {
  assert.equal(u.isSafeDataDir(j(home, 'AppData', 'Roaming', 'Peblo'), home), true);
  assert.equal(u.isSafeDataDir(j(home, 'peblo-e2e'), home), true);
  assert.equal(u.isSafeDataDir(j(home, 'Documents'), home), false);
  assert.equal(u.isSafeDataDir(home, home), false);
  assert.equal(u.isSafeDataDir(path.parse(home).root, home), false);
  assert.equal(u.isSafeDataDir('', home), false);
  assert.equal(u.isSafeDataDir(undefined, home), false);
});

ok('a folder that contains the home folder is never safe', () => {
  assert.equal(u.isSafeDataDir(path.dirname(home), home), false);
});

ok('leftovers list the data, updater cache and nothing outside Peblo', () => {
  const l = u.leftoverPaths({ dataDir: j(home, 'AppData', 'Roaming', 'Peblo'), localAppData: j(home, 'AppData', 'Local'), temp: j(home, 'AppData', 'Local', 'Temp') });
  assert.ok(l.some((p) => p.endsWith('peblo-updater')));
  assert.ok(l.some((p) => p.endsWith(j('Roaming', 'Peblo'))));
  assert.ok(l.every((p) => /peblo/i.test(p)));
  const bad = u.leftoverPaths({ dataDir: home, localAppData: j(home, 'AppData', 'Local') });
  assert.ok(!bad.includes(home));
});

const base = { pid: 4242, installDir: "C:\\Users\\te'jas\\AppData\\Local\\Programs\\Peblo", uninstaller: "C:\\Users\\te'jas\\AppData\\Local\\Programs\\Peblo\\Uninstall Peblo.exe", logFile: 'C:\\t\\peblo-uninstall.log', leftovers: ['C:\\Users\\te\'jas\\AppData\\Roaming\\Peblo'] };

ok('keeping data leaves the data folder out of the script', () => {
  const s = u.buildCleanupScript({ ...base, removeData: false });
  assert.ok(s.includes('Uninstall Peblo.exe'));
  assert.ok(!s.includes('Roaming'));
  assert.ok(s.includes("te''jas"), 'quotes are doubled');
});

ok('removing data deletes the leftovers after the uninstaller', () => {
  const s = u.buildCleanupScript({ ...base, removeData: true });
  assert.ok(s.indexOf('Start-Process') < s.indexOf('Roaming'));
  assert.ok(s.includes('Wait-Process -Id 4242'));
});

ok('the script is valid PowerShell', () => {
  if (process.platform !== 'win32') return;
  for (const removeData of [false, true]) {
    const f = path.join(os.tmpdir(), `peblo-un-test-${removeData}.ps1`);
    fs.writeFileSync(f, '\ufeff' + u.buildCleanupScript({ ...base, removeData }), 'utf8');
    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', `$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${f}',[ref]$t,[ref]$e); if($e.Count){$e|%{$_.Message};exit 1}`], { encoding: 'utf8' });
    fs.rmSync(f, { force: true });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
});

console.log(`${n} uninstall tests passed`);
