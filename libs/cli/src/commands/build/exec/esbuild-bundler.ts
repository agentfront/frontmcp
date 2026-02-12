/**
 * esbuild bundling for executable builds.
 * Produces a single CJS file for distribution.
 */

import * as path from 'path';
import { FrontmcpExecConfig } from './config';

// Default native addons that must be kept external
const DEFAULT_EXTERNALS = [
  'better-sqlite3',
  'fsevents',
  '@swc/core',
  'esbuild',
];

export interface BundleResult {
  bundlePath: string;
  bundleSize: number;
}

export async function bundleWithEsbuild(
  entryPath: string,
  outDir: string,
  config: FrontmcpExecConfig,
): Promise<BundleResult> {
  // Lazy-load esbuild
  let esbuild: typeof import('esbuild');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    esbuild = require('esbuild');
  } catch {
    throw new Error(
      'esbuild is required for --exec builds. Install it: npm install -D esbuild',
    );
  }

  const bundleName = `${config.name}.bundle.js`;
  const bundlePath = path.join(outDir, bundleName);

  const external = [
    ...DEFAULT_EXTERNALS,
    ...(config.dependencies?.nativeAddons || []),
    ...(config.esbuild?.external || []),
  ];

  await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: config.esbuild?.target || 'node22',
    outfile: bundlePath,
    external,
    keepNames: true, // preserve class names for decorator metadata
    treeShaking: true,
    minify: config.esbuild?.minify ?? false,
    define: config.esbuild?.define,
    sourcemap: false,
    metafile: true,
    logLevel: 'warning',
  });

  // Calculate bundle size
  const fs = require('fs');
  const stat = fs.statSync(bundlePath);

  return {
    bundlePath,
    bundleSize: stat.size,
  };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
