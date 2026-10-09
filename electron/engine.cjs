// Which Prisma query engine file belongs to this computer (PEB-71).
// The installers carry one engine per platform (see binaryTargets in server/prisma/schema.prisma). Taking "the first
// one found" starts the wrong engine on a Mac of the other kind, so pick by operating system and processor.
'use strict';

/**
 * @param {string[]} files   file names found next to the generated Prisma client
 * @param {string} platform  process.platform
 * @param {string} arch      process.arch
 * @returns {string | undefined}
 */
function pickEngine(files, platform, arch) {
  const engines = files.filter((f) => /query_engine.*\.node$/.test(f));
  const first = (re) => engines.find((f) => re.test(f));
  if (platform === 'win32') return first(/windows/);
  if (platform === 'darwin') return arch === 'arm64' ? first(/darwin-arm64/) : first(/darwin(?!-arm64)/);
  if (platform === 'linux') {
    const musl = /musl/;
    const wantArm = arch === 'arm64' ? /arm64/ : /^(?!.*arm64)/;
    return engines.find((f) => !musl.test(f) && wantArm.test(f) && /debian-openssl-3/.test(f))
      || engines.find((f) => !musl.test(f) && wantArm.test(f) && /openssl-3/.test(f))
      || engines.find((f) => !musl.test(f) && wantArm.test(f) && /\.so\.node$/.test(f));
  }
  return undefined;
}

module.exports = { pickEngine };
