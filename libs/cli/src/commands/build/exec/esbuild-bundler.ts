/**
 * esbuild bundling for executable builds.
 * Produces a single CJS file for distribution.
 */

import * as path from 'path';
import { type FrontmcpExecConfig } from './config';

// Default packages that must be kept external:
// - native addons that cannot be bundled
// - optional/lazy-required peer dependencies
const DEFAULT_EXTERNALS = [
  'better-sqlite3',
  'fsevents',
  '@swc/core',
  'esbuild',
  '@vercel/kv',
  '@frontmcp/storage-sqlite',
  // NOTE: `@enclave-vm/core` (the Node-only full sandbox) is externalized via
  // `enclaveCoreExactExternalPlugin()` instead of this list, so that its
  // bundle-safe `@enclave-vm/core/worker` subpath still gets BUNDLED. Listing
  // the bare package here would externalize the subpath too.
  // Externalize FrontMCP packages for single-copy semantics
  // (required for schema extraction — bundled copies create separate Symbol tokens)
  '@frontmcp/sdk',
  '@frontmcp/di',
  '@frontmcp/utils',
  '@frontmcp/auth',
  '@frontmcp/adapters',
  '@frontmcp/lazy-zod',
  'reflect-metadata',
];

export interface BundleResult {
  bundlePath: string;
  bundleSize: number;
}

/**
 * esbuild plugin that externalizes the EXACT `@enclave-vm/core` package while
 * leaving `@enclave-vm/core/worker` to be resolved and BUNDLED.
 *
 * `@enclave-vm/core` is the Node-only full sandbox (worker_threads / node:vm
 * adapters) that cannot be bundled; its `/worker` subpath is a dependency-free
 * interpreter that IS safe (and, on isolate/Worker deploys where node_modules is
 * absent, REQUIRED) to bundle. Adding the bare package to esbuild's `external`
 * array would externalize the subpath too — hence this exact-match plugin.
 */
export function enclaveCoreExactExternalPlugin(): import('esbuild').Plugin {
  return {
    name: 'frontmcp-enclave-core-exact-external',
    setup(build) {
      build.onResolve({ filter: /^@enclave-vm\/core$/ }, (args) => ({ path: args.path, external: true }));
    },
  };
}

export async function bundleWithEsbuild(
  entryPath: string,
  outDir: string,
  config: FrontmcpExecConfig,
  options?: { selfContained?: boolean; outputName?: string },
): Promise<BundleResult> {
  // Lazy-load esbuild
  let esbuild: typeof import('esbuild');
  try {

    esbuild = require('esbuild');
  } catch {
    throw new Error(
      'esbuild is required for build targets. Install it: npm install -D esbuild',
    );
  }

  const bundleName = `${options?.outputName || config.name}.bundle.js`;
  const bundlePath = path.join(outDir, bundleName);

  // In self-contained mode (SEA), only keep true native addons external
  const external = options?.selfContained
    ? [
        ...DEFAULT_EXTERNALS,
        ...(config.dependencies?.nativeAddons || []),
      ]
    : [
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
    plugins: [enclaveCoreExactExternalPlugin()],
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
