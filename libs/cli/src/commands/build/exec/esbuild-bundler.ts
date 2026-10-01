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

// Runtime packages that are normally externalized for single-copy semantics.
// Self-contained outputs (SEA binaries, the mcpb server) have no node_modules
// to resolve them from and must inline them instead.
export const RUNTIME_PACKAGE_EXTERNALS = [
  '@frontmcp/sdk',
  '@frontmcp/di',
  '@frontmcp/utils',
  '@frontmcp/auth',
  '@frontmcp/adapters',
  '@frontmcp/lazy-zod',
  'reflect-metadata',
];

// Optional peers the SDK `require()`s lazily. A fresh project does not have them
// installed, and inlining the SDK (SEA / mcpb) made esbuild fail with
// `Could not resolve "@frontmcp/observability"`. They are bundled when installed
// and left as a guarded runtime `require()` when they are not.
const OPTIONAL_PEER_PACKAGES = ['@frontmcp/observability', '@opentelemetry/sdk-trace-base'];

export function missingOptionalPeers(
  cwd: string = process.cwd(),
  resolve: (request: string, options: { paths: string[] }) => string = require.resolve,
): string[] {
  return OPTIONAL_PEER_PACKAGES.filter((pkg) => {
    try {
      resolve(pkg, { paths: [cwd] });
      return false;
    } catch {
      return true;
    }
  });
}

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
  options?: {
    /**
     * The output runs with no node_modules next to it (an SEA binary, the mcpb
     * server): the FrontMCP runtime and `reflect-metadata` are inlined, and only
     * native addons and optional peers stay external. An SEA binary resolves a
     * bare `require()` against Node's built-in modules only, so anything left
     * external there fails with `No such built-in module` (#679).
     */
    selfContained?: boolean;
    outputName?: string;
    /** JavaScript placed ahead of every bundled module (runs before the user's entry). */
    banner?: string;
  },
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

  // In self-contained mode, only keep true native addons and optional peers external
  const baseExternals = options?.selfContained
    ? DEFAULT_EXTERNALS.filter((e) => !RUNTIME_PACKAGE_EXTERNALS.includes(e))
    : DEFAULT_EXTERNALS;
  const external = options?.selfContained
    ? [
        ...baseExternals,
        ...missingOptionalPeers(),
        ...(config.dependencies?.nativeAddons || []),
      ]
    : [
        ...baseExternals,
        ...missingOptionalPeers(),
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
    ...(options?.banner ? { banner: { js: options.banner } } : {}),
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
