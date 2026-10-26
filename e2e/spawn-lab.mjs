import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = os.tmpdir();
const variants = {
  A_current: { detached: true, stdio: 'ignore', windowsHide: true },
  B_not_detached: { detached: false, stdio: 'ignore', windowsHide: true },
  C_no_hide: { detached: true, stdio: 'ignore' },
  D_plain: { stdio: 'ignore' },
};
for (const [name, opts] of Object.entries(variants)) {
  const log = path.join(dir, `peblo-lab-${name}.log`);
  const ps1 = path.join(dir, `peblo-lab-${name}.ps1`);
  fs.rmSync(log, { force: true });
  fs.writeFileSync(ps1, `Add-Content -LiteralPath '${log}' -Value 'start'\r\n`, 'utf8');
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ps1];
  const c = spawn('powershell.exe', args, opts);
  c.on('error', (e) => console.log(name, 'error', e.message));
  c.unref?.();
  await new Promise((r) => setTimeout(r, 4000));
  console.log(name, fs.existsSync(log) ? 'STARTED' : 'did not start');
}
process.exit(0);
