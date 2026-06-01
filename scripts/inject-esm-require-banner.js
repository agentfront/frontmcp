/**
 * inject-esm-require-banner.js
 *
 * Post-build step for ESM bundles produced by `@nx/esbuild:esbuild`.
 *
 * esbuild emits a `__require` shim into `.mjs` bundles that throws
 * "Dynamic require of \"fs\" is not supported" unless a real `require` exists in
 * module scope. In a native ESM module `require` is undefined, so any lazy
 * `require('fs')` (e.g. `@frontmcp/utils` filesystem helpers) or native addon
 * load (e.g. `better-sqlite3`) fails at runtime.
 *
 * The `@nx/esbuild` executor (v22.x) drops the inline `esbuildOptions.banner`
 * key, so we inject the banner here instead. The banner defines a `require`
 * derived from `createRequire(import.meta.url)`, which the shim then picks up
 * (`typeof require !== "undefined"` becomes true) and delegates to. Because the
 * banner is anchored to `import.meta.url`, module resolution is relative to the
 * emitted bundle file — not `process.cwd()`.
 *
 * Usage:
 *   node scripts/inject-esm-require-banner.js <esm-dir> [<esm-dir> ...]
 *
 * Idempotent: re-running is a no-op once the marker is present.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MARKER = '__frontmcpCreateRequire';
const BANNER =
  "import { createRequire as __frontmcpCreateRequire } from 'module';\n" +
  'const require = __frontmcpCreateRequire(import.meta.url);\n';

function injectInto(file) {
  const original = fs.readFileSync(file, 'utf8');
  if (original.includes(MARKER)) {
    return false; // already injected
  }
  fs.writeFileSync(file, BANNER + original, 'utf8');
  return true;
}

function processDir(esmDir) {
  const abs = path.resolve(esmDir);
  if (!fs.existsSync(abs)) {
    // Nothing to do (e.g. ESM build skipped). Don't fail the pipeline.
    console.log(`ℹ️  inject-esm-require-banner: ${abs} does not exist, skipping.`);
    return;
  }

  const targets = fs
    .readdirSync(abs)
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => path.join(abs, f));

  let injected = 0;
  for (const file of targets) {
    if (injectInto(file)) {
      injected += 1;
    }
  }

  console.log(`✅ inject-esm-require-banner: ${abs} — ${targets.length} .mjs file(s), injected ${injected}.`);
}

function main() {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) {
    console.error('inject-esm-require-banner: expected at least one ESM output directory argument.');
    process.exit(1);
  }
  for (const dir of dirs) {
    processDir(dir);
  }
}

main();
