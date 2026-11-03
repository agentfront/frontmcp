// Writes the require and import files of each subpath export as a re-export of the package root, so a subpath hands back the
// root's own classes instead of a second copy of them: node scripts/build-subpath-reexports.mjs <package-dir>
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { build } from 'esbuild';

const [packageDirArg] = process.argv.slice(2);
if (!packageDirArg) {
  console.error('Usage: node scripts/build-subpath-reexports.mjs <package-dir>');
  process.exit(1);
}

const packageDir = resolve(packageDirArg);
const manifest = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8'));
const FORMAT_BY_CONDITION = { require: 'cjs', import: 'esm' };

async function exportedNames(sourcePath) {
  const { outputFiles } = await build({
    entryPoints: [sourcePath],
    bundle: true,
    packages: 'external',
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'warning',
  });
  const code = outputFiles[0].text;
  if (/^export \* from /m.test(code)) {
    throw new Error(
      `${sourcePath} re-exports another package with export *, so the names its subpath re-exports are unknown`,
    );
  }
  // The metafile of the bundle also lists a type re-exported without `export type`; the bundled code leaves it out
  const { metafile } = await build({
    stdin: { contents: code, loader: 'js' },
    outfile: 'names.js',
    write: false,
    metafile: true,
    format: 'esm',
    logLevel: 'warning',
  });
  return Object.values(metafile.outputs)[0].exports;
}

for (const [subpath, conditions] of Object.entries(manifest.exports)) {
  if (subpath === '.' || !conditions?.development) continue;
  const names = await exportedNames(resolve(packageDir, conditions.development));
  const contents = `export { ${names.join(', ')} } from '${manifest.name}';`;
  for (const [condition, format] of Object.entries(FORMAT_BY_CONDITION)) {
    await build({
      stdin: { contents, resolveDir: packageDir, loader: 'js' },
      outfile: resolve(packageDir, conditions[condition].default),
      bundle: true,
      external: [manifest.name],
      format,
      platform: 'node',
      logLevel: 'warning',
    });
  }
}
