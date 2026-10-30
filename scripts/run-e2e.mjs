#!/usr/bin/env node
// Runs every e2e/*.mjs suite one at a time and prints ONE line per suite.
//
// Usage (from the repo root, after `npm run build`):
//   npm run e2e                               all suites
//   npm run e2e -- share                      only suites whose name contains "share" (several filters allowed)
//   npm run e2e -- --only-failed e2e.log      re-run just the suites listed as failed in a previous log
//                                             (the log may be this script's stdout or e2e-results.json)
//   npm run e2e -- --timeout 120              per-suite timeout in seconds (default 240)
//   npm run e2e -- --no-retry                 do not retry failures
//
// Output:  "name => PASS" | "name => FLAKY (passed on retry; first run: <FAIL lines>)" | "name => FAILED: <first 2 FAIL lines>"
// Writes e2e-results.json in the repo root. Exit code 1 if any suite failed on both attempts (FLAKY does not fail the run).
//
// Skipped (not suites): files starting with "lib" or "_", plus the explicit list below.
// Checkless scripts that exit 0 whatever happens (screenshot/probe tools), so a "PASS" would mean nothing:
//   notesprobe, notesprobe2, np-shots, np-shots2, orbitshots, ref-shots, refshots, rivshots, yjs-debug*
// Other non-suites: hosted-cursors, spawn-lab, shots-share, present2-dbg, comments-dbg, rivprobe
// (see SKIP below; edit it there). Note: seeddemo, capture2, filtershot, media-probe are NOT skipped here; check if they are suites.
import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const E2E = path.join(REPO, 'e2e');
const SKIP = [
  'hosted-cursors', 'spawn-lab', 'shots-share', 'present2-dbg', 'yjs-debug*', 'notesprobe*', 'np-shots*',
  'orbitshots', 'ref-shots', 'refshots', 'rivshots', 'comments-dbg', 'rivprobe',
];
const skipRes = SKIP.map((p) => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'));
const isSkipped = (n) => n.startsWith('lib') || n.startsWith('_') || skipRes.some((r) => r.test(n));

// ---- args
const argv = process.argv.slice(2);
let timeoutSec = 240, retry = true, onlyFailedLog = null; const filters = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--only-failed') onlyFailedLog = argv[++i];
  else if (a === '--timeout') timeoutSec = Number(argv[++i]) || 240;
  else if (a === '--no-retry') retry = false;
  else if (a.startsWith('--')) { console.error(`unknown option ${a}`); process.exit(2); }
  else filters.push(a.replace(/\.mjs$/, ''));
}

let names = fs.readdirSync(E2E).filter((f) => f.endsWith('.mjs')).map((f) => f.slice(0, -4)).filter((n) => !isSkipped(n)).sort();
if (filters.length) names = names.filter((n) => filters.some((f) => n.includes(f)));
if (onlyFailedLog) {
  const text = fs.readFileSync(path.resolve(onlyFailedLog), 'utf8').replace(/^﻿/, '');
  let failed = new Set();
  try { const j = JSON.parse(text); for (const r of j.results || []) if (r.status === 'FAILED') failed.add(r.name); }
  catch { for (const m of text.matchAll(/^(\S+) => FAILED/gm)) failed.add(m[1]); }
  names = names.filter((n) => failed.has(n));
}

// ---- running one suite
function killTree(child) {
  try { if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); else child.kill('SIGKILL'); } catch {}
}
function runOnce(name) {
  return new Promise((resolve) => {
    const t0 = Date.now(); let out = ''; let timedOut = false;
    const child = spawn(process.execPath, [path.join('e2e', name + '.mjs')], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    const add = (d) => { out += d; if (out.length > 4e6) out = out.slice(-2e6); };
    child.stdout.on('data', add); child.stderr.on('data', add);
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutSec * 1000);
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, code: -1, out: out + String(e), ms: Date.now() - t0, timedOut }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const failLines = out.split(/\r?\n/).filter((l) => /^\s*FAIL\b/.test(l)).map((l) => l.trim());
      resolve({ ok: !timedOut && code === 0 && failLines.length === 0, code, out, failLines, ms: Date.now() - t0, timedOut });
    });
  });
}
const oneLine = (s) => s.replace(/\s+/g, ' ').trim().slice(0, 240);
function reason(r) {
  if (r.timedOut) return `timeout after ${timeoutSec}s`;
  if (r.failLines.length) return r.failLines.slice(0, 2).map(oneLine).join(' | ');
  const tail = r.out.split(/\r?\n/).filter((l) => l.trim()).slice(-2).map(oneLine).join(' | ');
  return `exit ${r.code}${tail ? ': ' + tail : ''}`;
}

// ---- main
const results = []; const t00 = Date.now();
for (const name of names) {
  let r = await runOnce(name); let status = 'PASS', first = null, detail = '';
  if (!r.ok) {
    first = reason(r);
    if (retry) {
      const r2 = await runOnce(name);
      if (r2.ok) { status = 'FLAKY'; detail = first; r = r2; }
      else { status = 'FAILED'; detail = reason(r2); r = r2; }
    } else { status = 'FAILED'; detail = first; }
  }
  console.log(status === 'PASS' ? `${name} => PASS` : status === 'FLAKY' ? `${name} => FLAKY (passed on retry; first run: ${detail})` : `${name} => FAILED: ${detail}`);
  results.push({ name, status, detail, firstRun: first, ms: r.ms });
}
const count = (s) => results.filter((r) => r.status === s).length;
fs.writeFileSync(path.join(REPO, 'e2e-results.json'), JSON.stringify({ at: new Date().toISOString(), seconds: Math.round((Date.now() - t00) / 1000), pass: count('PASS'), flaky: count('FLAKY'), failed: count('FAILED'), results }, null, 2));
console.log(`SUMMARY: ${count('PASS')} pass, ${count('FLAKY')} flaky, ${count('FAILED')} failed of ${results.length} (e2e-results.json)`);
process.exit(count('FAILED') ? 1 : 0);
