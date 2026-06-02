/**
 * better-sqlite3 loader
 *
 * Resolving `better-sqlite3` is tricky because this package ships in BOTH
 * CommonJS (`dist/index.js`) and ESM (`dist/esm/index.mjs`) flavors via esbuild
 * with `better-sqlite3` marked `external`.
 *
 * In the ESM bundle, a bare `require(...)` is rewritten by esbuild into a
 * `__require` shim that throws **"Dynamic require of \"fs\" is not supported"**
 * the moment better-sqlite3 (a native addon) reaches for `fs`/`path`/`bindings`
 * internally — UNLESS a real `require` exists in module scope for the shim to
 * delegate to. The ESM build therefore injects a banner that defines
 *
 * ```js
 * import { createRequire } from 'module';
 * const require = createRequire(import.meta.url);
 * ```
 *
 * (see `scripts/inject-esm-require-banner.js`). With that banner in place, the
 * plain `require('better-sqlite3')` below resolves the addon **relative to the
 * emitted bundle file** in both the CJS and ESM outputs, and better-sqlite3's
 * own transitive `require('fs')` resolves natively.
 */

import type Database from 'better-sqlite3';

let cached: typeof Database | null = null;

/**
 * Resolve the `better-sqlite3` constructor in a way that works under both the
 * CommonJS and ESM builds of this package.
 *
 * @throws Error if `better-sqlite3` cannot be resolved/loaded.
 */
export function loadBetterSqlite3(): typeof Database {
  if (cached) {
    return cached;
  }

  // In CJS this is the native module `require`. In the ESM bundle this token is
  // satisfied by the `createRequire(import.meta.url)` banner, so resolution is
  // anchored to the bundle's own location (NOT process.cwd()).
  const mod = require('better-sqlite3') as typeof Database;
  cached = mod;
  return mod;
}
