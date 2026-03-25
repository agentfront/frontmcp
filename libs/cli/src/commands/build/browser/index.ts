import * as path from 'path';
import { ParsedArgs } from '../../../core/args';
import { c } from '../../../core/colors';
import { ensureDir } from '@frontmcp/utils';
import { resolveEntry } from '../../../shared/fs';

/**
 * Build a browser-compatible ESM bundle.
 *
 * Uses esbuild with `platform: 'browser'` which resolves conditional imports
 * (`#imports` in package.json) to browser implementations automatically:
 * - Crypto → @noble/hashes + @noble/ciphers (no node:crypto)
 * - AsyncLocalStorage → stack-based polyfill
 * - EventEmitter → Map-based polyfill
 * - SSE/Express/Stdio → stubs that throw on instantiation
 *
 * @example
 * ```bash
 * frontmcp build --target browser
 * ```
 */
export async function buildBrowser(opts: ParsedArgs): Promise<void> {
  const cwd = process.cwd();
  const entry = await resolveEntry(cwd, opts.entry);
  const outDir = path.resolve(cwd, opts.outDir || 'dist');
  await ensureDir(outDir);

  const pkg = require(path.join(cwd, 'package.json'));
  const appName = pkg.name || path.basename(cwd);

  console.log(`${c('cyan', '[build:browser]')} entry: ${path.relative(cwd, entry)}`);
  console.log(`${c('cyan', '[build:browser]')} outDir: ${path.relative(cwd, outDir)}`);

  const esbuild = await import('esbuild');

  // Build ESM bundle for browsers
  console.log(c('cyan', '[build:browser] Bundling ESM for browser...'));
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    outfile: path.join(outDir, `${appName}.browser.mjs`),
    keepNames: true,
    treeShaking: true,
    sourcemap: true,
    // Browser-safe: keep React and peer deps external (user's bundler handles them)
    external: [
      'react', 'react-dom', 'react-router', 'react-router-dom',
      // Keep @frontmcp/* external — user installs them
      '@frontmcp/sdk', '@frontmcp/di', '@frontmcp/utils',
      '@frontmcp/auth', '@frontmcp/react',
      'reflect-metadata',
      // Node.js-only — these should be tree-shaken by platform: 'browser'
      // but list explicitly to avoid accidental bundling
      'better-sqlite3', 'fsevents', 'ioredis',
      ...Object.keys(pkg.peerDependencies || {}),
    ],
    // Resolve conditional imports to browser variants
    conditions: ['browser', 'import', 'default'],
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });

  console.log(c('green', `\n  Browser build complete:`));
  console.log(c('gray', `  ESM: ${appName}.browser.mjs`));
  console.log(c('gray', `  Source map: ${appName}.browser.mjs.map`));
}
