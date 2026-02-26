#!/usr/bin/env node
/**
 * Build browser UMD (IIFE) bundle using esbuild directly.
 *
 * The @nx/esbuild executor only supports 'esm' and 'cjs' formats.
 * This script uses the esbuild JS API directly for IIFE (UMD) builds.
 *
 * Usage:
 *   node scripts/build-browser-umd.mjs <entry> <outfile> <globalName> [flags...]
 *
 * Flags:
 *   --external=<pkg>        Add an external package (repeatable)
 *   --alias:<from>=<to>     Add a custom alias (repeatable, merged with defaults)
 *
 * Common Node.js shim aliases are included automatically.
 */
import { build } from 'esbuild';

const [entry, outfile, globalName, ...rest] = process.argv.slice(2);

if (!entry || !outfile || !globalName) {
  console.error('Usage: node scripts/build-browser-umd.mjs <entry> <outfile> <globalName> [--external=pkg ...] [--alias:from=to ...]');
  process.exit(1);
}

const externals = [];
const extraAliases = {};

for (const arg of rest) {
  if (arg.startsWith('--external=')) {
    externals.push(arg.slice('--external='.length));
  } else if (arg.startsWith('--alias:')) {
    const eqIdx = arg.indexOf('=', 8);
    if (eqIdx !== -1) {
      const key = arg.slice(8, eqIdx);
      const value = arg.slice(eqIdx + 1);
      extraAliases[key] = value;
    }
  }
}

// Common aliases for all browser builds — redirect Node.js built-ins to shims
const commonAliases = {
  // Node.js built-ins (node: prefix)
  'node:async_hooks': './libs/sdk/src/browser/shims/async-hooks.ts',
  'node:crypto': './libs/sdk/src/browser/shims/crypto.ts',
  'node:fs': './libs/sdk/src/browser/shims/fs.ts',
  'node:fs/promises': './libs/sdk/src/browser/shims/fs.ts',
  'node:path': './libs/sdk/src/browser/shims/path.ts',
  'node:os': './libs/sdk/src/browser/shims/os.ts',
  'node:http': './libs/sdk/src/browser/shims/http.ts',
  'node:stream': './libs/sdk/src/browser/shims/stream.ts',
  'node:buffer': './libs/sdk/src/browser/shims/empty.ts',
  'node:process': './libs/sdk/src/browser/shims/empty.ts',
  'node:child_process': './libs/sdk/src/browser/shims/empty.ts',
  'node:events': './libs/sdk/src/browser/shims/events.ts',
  'node:url': './libs/sdk/src/browser/shims/empty.ts',
  'node:util': './libs/sdk/src/browser/shims/empty.ts',
  // Node.js built-ins (bare)
  'async_hooks': './libs/sdk/src/browser/shims/async-hooks.ts',
  'assert': './libs/sdk/src/browser/shims/empty.ts',
  'child_process': './libs/sdk/src/browser/shims/empty.ts',
  'crypto': './libs/sdk/src/browser/shims/crypto.ts',
  'events': './libs/sdk/src/browser/shims/events.ts',
  'fs': './libs/sdk/src/browser/shims/fs.ts',
  'fs/promises': './libs/sdk/src/browser/shims/fs.ts',
  'http': './libs/sdk/src/browser/shims/http.ts',
  'http2': './libs/sdk/src/browser/shims/empty.ts',
  'os': './libs/sdk/src/browser/shims/os.ts',
  'path': './libs/sdk/src/browser/shims/path.ts',
  'stream': './libs/sdk/src/browser/shims/stream.ts',
  'tty': './libs/sdk/src/browser/shims/empty.ts',
  'url': './libs/sdk/src/browser/shims/empty.ts',
  'util': './libs/sdk/src/browser/shims/empty.ts',
  // Third-party packages
  'ioredis': './libs/sdk/src/browser/shims/empty.ts',
  'express': './libs/sdk/src/browser/shims/empty.ts',
  'cors': './libs/sdk/src/browser/shims/empty.ts',
  'raw-body': './libs/sdk/src/browser/shims/empty.ts',
  'content-type': './libs/sdk/src/browser/shims/empty.ts',
  '@vercel/kv': './libs/sdk/src/browser/shims/empty.ts',
  '@swc/wasm': './libs/sdk/src/browser/shims/empty.ts',
  '@swc/core': './libs/sdk/src/browser/shims/empty.ts',
  '@swc/core-darwin-arm64': './libs/sdk/src/browser/shims/empty.ts',
};

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'iife',
  globalName,
  minify: true,
  sourcemap: true,
  platform: 'browser',
  external: externals,
  alias: { ...commonAliases, ...extraAliases },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  logLevel: 'warning',
});

console.log(`Built ${outfile} (IIFE, globalName: ${globalName})`);
