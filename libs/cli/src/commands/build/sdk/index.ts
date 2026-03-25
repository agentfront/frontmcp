import * as path from 'path';
import { ParsedArgs } from '../../../core/args';
import { c } from '../../../core/colors';
import { ensureDir, runCmd } from '@frontmcp/utils';
import { resolveEntry } from '../../../shared/fs';

/**
 * Build a direct-client SDK library for Node.js applications.
 *
 * Produces CJS + ESM dual output with type declarations so the server
 * can be consumed as a library dependency (e.g., `import { DirectMcpServer } from './my-mcp'`).
 *
 * @example
 * ```bash
 * frontmcp build --target sdk
 * ```
 */
export async function buildSdk(opts: ParsedArgs): Promise<void> {
  const cwd = process.cwd();
  const entry = await resolveEntry(cwd, opts.entry);
  const outDir = path.resolve(cwd, opts.outDir || 'dist');
  await ensureDir(outDir);

  console.log(`${c('cyan', '[build:sdk]')} entry: ${path.relative(cwd, entry)}`);
  console.log(`${c('cyan', '[build:sdk]')} outDir: ${path.relative(cwd, outDir)}`);

  // Step 1: Compile TypeScript with declaration emit
  console.log(c('cyan', '[build:sdk] Compiling TypeScript...'));
  const tscArgs = [
    '-y', 'tsc',
    '--project', path.join(cwd, 'tsconfig.json'),
    '--outDir', outDir,
    '--declaration', '--declarationMap',
    '--skipLibCheck',
  ];
  await runCmd('npx', tscArgs);

  // Step 2: Bundle CJS with esbuild
  console.log(c('cyan', '[build:sdk] Bundling CJS...'));
  const esbuild = await import('esbuild');
  const pkg = require(path.join(cwd, 'package.json'));
  const appName = pkg.name || path.basename(cwd);

  const sharedBuildOptions: import('esbuild').BuildOptions = {
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    target: 'node22',
    keepNames: true,
    treeShaking: true,
    sourcemap: true,
    external: [
      '@frontmcp/sdk', '@frontmcp/di', '@frontmcp/utils',
      '@frontmcp/auth', '@frontmcp/adapters', '@frontmcp/plugins',
      'reflect-metadata', 'better-sqlite3', 'fsevents',
      // Keep user's dependencies external
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.peerDependencies || {}),
    ],
  };

  await esbuild.build({
    ...sharedBuildOptions,
    format: 'cjs',
    outfile: path.join(outDir, `${appName}.cjs.js`),
  });

  // Step 3: Bundle ESM
  console.log(c('cyan', '[build:sdk] Bundling ESM...'));
  await esbuild.build({
    ...sharedBuildOptions,
    format: 'esm',
    outfile: path.join(outDir, `${appName}.esm.mjs`),
  });

  console.log(c('green', `\n  SDK build complete:`));
  console.log(c('gray', `  CJS: ${appName}.cjs.js`));
  console.log(c('gray', `  ESM: ${appName}.esm.mjs`));
  console.log(c('gray', `  Types: *.d.ts`));
}
