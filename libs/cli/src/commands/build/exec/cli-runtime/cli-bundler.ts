/**
 * esbuild configuration for the CLI bundle.
 * Bundles the generated CLI entry point with commander.js inlined.
 */

import * as path from 'path';
import { FrontmcpExecConfig } from '../config';

export interface CliBundleResult {
  bundlePath: string;
  bundleSize: number;
}

/**
 * Bundle the generated CLI entry with esbuild.
 * Commander.js and runtime modules are inlined; the server bundle is external.
 */
export async function bundleCliWithEsbuild(
  cliEntryPath: string,
  outDir: string,
  config: FrontmcpExecConfig,
): Promise<CliBundleResult> {
  let esbuild: typeof import('esbuild');
  try {
    esbuild = require('esbuild');
  } catch {
    throw new Error(
      'esbuild is required for CLI builds. Install it: npm install -D esbuild',
    );
  }

  const cliBundleName = `${config.name}-cli.bundle.js`;
  const bundlePath = path.join(outDir, cliBundleName);

  // The server bundle is loaded via require() at runtime — keep external
  const serverBundleName = `${config.name}.bundle.js`;

  await esbuild.build({
    entryPoints: [cliEntryPath],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: config.esbuild?.target || 'node22',
    outfile: bundlePath,
    external: [
      `./${serverBundleName}`,
      '@frontmcp/sdk',
      // Keep native addons external
      'better-sqlite3',
      'fsevents',
      ...(config.dependencies?.nativeAddons || []),
      ...(config.esbuild?.external || []),
    ],
    keepNames: true,
    treeShaking: true,
    minify: config.esbuild?.minify ?? false,
    banner: {
      js: '#!/usr/bin/env node',
    },
    define: config.esbuild?.define,
    sourcemap: false,
    logLevel: 'warning',
  });

  const fs = require('fs');
  const stat = fs.statSync(bundlePath);

  return {
    bundlePath,
    bundleSize: stat.size,
  };
}
