// Dependency audit gate. Runs `npm audit --omit=dev --json` for the root (server + desktop shell) and the client,
// and fails only when there is a high or critical advisory that is NOT in .github/audit-allowlist.json
// (or an allowlist entry has expired, which forces a re-review). Lower severities are listed but never fail the job.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allow = JSON.parse(readFileSync(path.join(root, '.github', 'audit-allowlist.json'), 'utf8')).accepted || [];
const today = new Date().toISOString().slice(0, 10);
const FAIL = new Set(['high', 'critical']);
let failed = false;

for (const e of allow) {
  if (e.expires < today) { failed = true; console.error(`EXPIRED allowlist entry ${e.id} (${e.package}) on ${e.expires}: re-review it (docs/SECURITY-AUDIT.md).`); }
}

for (const dir of ['.', 'client']) {
  const r = spawnSync('npm', ['audit', '--omit=dev', '--json'], { cwd: path.join(root, dir), encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 });
  let report;
  try { report = JSON.parse(r.stdout); } catch { failed = true; console.error(`[${dir}] npm audit gave no JSON (network or registry problem?):\n${r.stderr || r.stdout}`); continue; }
  if (report.error) { failed = true; console.error(`[${dir}] npm audit error: ${report.error.summary || JSON.stringify(report.error)}`); continue; }
  const seen = new Map();
  for (const v of Object.values(report.vulnerabilities || {})) {
    for (const via of v.via || []) {
      if (typeof via === 'string' || !via.url) continue;
      const id = via.url.split('/').pop();
      seen.set(id, { id, pkg: via.name, severity: via.severity, title: via.title, url: via.url });
    }
  }
  console.log(`\n[${dir}] ${seen.size} advisory(ies)`);
  for (const a of [...seen.values()].sort((x, y) => x.id.localeCompare(y.id))) {
    const accepted = allow.find((e) => e.id === a.id);
    const blocking = FAIL.has(a.severity) && !accepted;
    if (blocking) failed = true;
    console.log(`${blocking ? 'FAIL' : accepted ? 'ACCEPTED' : 'note'}  ${a.severity.padEnd(8)} ${a.pkg}  ${a.id}  ${a.title}${accepted ? `  (until ${accepted.expires})` : ''}`);
  }
}

if (failed) { console.error('\nAudit gate failed. Fix or upgrade the package, or review it and add it to .github/audit-allowlist.json with a reason and expiry.'); process.exit(1); }
console.log('\nAudit gate passed.');
