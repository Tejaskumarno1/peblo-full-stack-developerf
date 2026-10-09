// electron-builder hook: after the app is assembled, keep only the database engine(s) this installer needs (PEB-71).
// The Prisma client is generated with an engine for every platform we ship (see binaryTargets in schema.prisma);
// shipping all of them in every installer would add ~60 MB of files that can never run there.
'use strict';
const fs = require('fs');
const path = require('path');

/** Engine file names to delete for a given target. Exported so the tests can check the rules. */
function unwanted(files, platform, arch) {
  const engines = files.filter((f) => /query_engine.*\.node$/.test(f));
  const keep = (f) => {
    if (platform === 'win32') return /windows/.test(f);
    if (platform === 'darwin') return arch === 'arm64' ? /darwin-arm64/.test(f) : /darwin(?!-arm64)/.test(f);
    if (platform === 'linux') return /debian-openssl-3|openssl-3|\.so\.node$/.test(f) && !/musl/.test(f);
    return true;
  };
  return engines.filter((f) => !keep(f));
}

const ARCH = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName;
  const arch = ARCH[context.arch] || String(context.arch);
  const resources = platform === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  const dir = path.join(resources, 'app.asar.unpacked', 'server', 'generated', 'prisma');
  if (!fs.existsSync(dir)) throw new Error(`afterPack: Prisma folder not found at ${dir}`);
  for (const f of unwanted(fs.readdirSync(dir), platform, arch)) fs.unlinkSync(path.join(dir, f));
  const left = fs.readdirSync(dir).filter((f) => /query_engine.*\.node$/.test(f));
  if (left.length === 0) throw new Error(`afterPack: no database engine left for ${platform}/${arch}`);
  console.log(`  • database engine for ${platform}/${arch}: ${left.join(', ')}`);
};
exports.unwanted = unwanted;
