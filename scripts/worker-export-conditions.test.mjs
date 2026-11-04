// Guards which variant each runtime resolves from the `imports` and `exports` maps of the @frontmcp packages.
//
// Cloudflare's bundlers resolve `workerd`, `worker` and `browser`. workerd provides the Node built-ins through
// `nodejs_compat` and needs the web-fetch MCP transport, so a `workerd` condition listed before `browser` gives it the
// Node variants, while the Node-only host transports (stdio, SSE, Express) stay stubs. A browser Web Worker (webpack's
// `target: 'webworker'`, Parcel, or esbuild and Rollup given `worker`) resolves `worker` and `browser` and has no Node
// built-ins, so it gets the browser variants, as a page does (#1031). demo-e2e-cloudflare consumes workspace `src`
// through the `development` condition, so this guard runs the condition-resolution algorithm itself.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const readPkg = (rel) => JSON.parse(readFileSync(path.join(repoRoot, rel, 'package.json'), 'utf8'));

// Mimic Node/esbuild conditional-`imports` resolution: walk the entry's keys in
// declared order, return the first whose condition is active (or `default`).
function resolveCondition(entry, active) {
  for (const key of Object.keys(entry)) {
    if (key === 'default' || active.has(key)) return entry[key];
  }
  return undefined;
}

// Active named conditions per consumer (`default` is always the fallback).
const CLOUDFLARE = new Set(['workerd', 'worker', 'browser']); // wrangler and @cloudflare/vite-plugin
const BROWSER_WORKER = new Set(['worker', 'browser']); // webpack target: 'webworker', Parcel workers
const VERCEL_EDGE = new Set(['edge-light', 'browser']); // Next.js (webpack, Turbopack) and @vercel/node
const BROWSER = new Set(['browser']); // real web bundlers, Vite (pages and workers)
const NODE = new Set(); // plain Node.js / jest

// For each package: which impl Cloudflare MUST resolve to.
// 'node' = the Node/default impl (workerd-safe via nodejs_compat / web-fetch);
// 'stub' = the browser stub (host transport never used on a worker).
const EXPECT = {
  'libs/utils': {
    '#crypto-provider': 'node',
    '#async-context': 'node',
    '#event-emitter': 'node',
    '#env': 'node',
    '#runtime-context': 'node',
    '#path': 'node',
  },
  'libs/protocol': {
    '#mcp-streamable-http': 'node',
    '#mcp-server': 'node',
    '#server-types': 'node',
    '#stdio-client': 'stub',
    '#stdio-server': 'stub',
    '#client': 'node',
  },
  'libs/sdk': {
    '#sse-transport': 'stub',
    '#express-host': 'stub',
    '#shared-server': 'stub',
    '#enclave-core': 'stub',
  },
};

const isBrowserPath = (p) => /(^|\/)browser[-/]|\/browser\.ts$/.test(p);

for (const [pkgDir, splits] of Object.entries(EXPECT)) {
  const pkg = readPkg(pkgDir);

  test(`${pkgDir}: Cloudflare resolves the workerd-correct impl`, () => {
    for (const [imp, want] of Object.entries(splits)) {
      const entry = pkg.imports?.[imp];
      assert.ok(entry, `${pkgDir} ${imp} missing from imports`);
      const resolved = resolveCondition(entry, CLOUDFLARE);
      if (want === 'node') {
        assert.ok(
          !isBrowserPath(resolved),
          `${pkgDir} ${imp}: Cloudflare must NOT resolve to a browser stub (got ${resolved})`,
        );
        assert.equal(resolved, entry.default, `${pkgDir} ${imp}: Cloudflare should match the node/default impl`);
      } else {
        assert.ok(
          isBrowserPath(resolved),
          `${pkgDir} ${imp}: Cloudflare must resolve to the browser stub (got ${resolved})`,
        );
      }
    }
  });

  test(`${pkgDir}: a browser Web Worker, Vercel Edge, a browser and Node resolve their impl`, () => {
    for (const imp of Object.keys(splits)) {
      const entry = pkg.imports[imp];
      assert.equal(resolveCondition(entry, BROWSER_WORKER), entry.browser, `${pkgDir} ${imp}: a browser Web Worker`);
      assert.equal(resolveCondition(entry, VERCEL_EDGE), entry.browser, `${pkgDir} ${imp}: Vercel Edge`);
      assert.equal(resolveCondition(entry, BROWSER), entry.browser, `${pkgDir} ${imp}: a browser`);
      assert.equal(resolveCondition(entry, NODE), entry.default, `${pkgDir} ${imp}: Node`);
    }
  });
}

function resolveNested(target, active) {
  if (typeof target !== 'object' || target === null) return target;
  for (const [key, value] of Object.entries(target)) {
    if (key !== 'default' && !active.has(key)) continue;
    const resolved = resolveNested(value, active);
    if (resolved !== undefined) return resolved;
  }
  return undefined;
}

const workspacePackages = ['libs', 'plugins']
  .flatMap((dir) => readdirSync(path.join(repoRoot, dir)).map((name) => `${dir}/${name}`))
  .filter((pkgDir) => existsSync(path.join(repoRoot, pkgDir, 'package.json')));

test('every workspace package gives a browser Web Worker the files it gives a page', () => {
  for (const pkgDir of workspacePackages) {
    const { imports = {}, exports = {} } = readPkg(pkgDir);
    const entries = { ...imports, ...(typeof exports === 'object' ? exports : {}) };
    for (const [specifier, entry] of Object.entries(entries)) {
      for (const kind of [['import'], ['require'], ['import', 'module'], ['require', 'module']]) {
        assert.equal(
          resolveNested(entry, new Set([...BROWSER_WORKER, ...kind])),
          resolveNested(entry, new Set([...BROWSER, ...kind])),
          `${pkgDir} ${specifier} (${kind.join(' + ')})`,
        );
      }
    }
  }
});

// A browser bundler gets the per-module build of utils and auth; Cloudflare and Node keep the single-file ESM
for (const pkgDir of ['libs/utils', 'libs/auth']) {
  test(`${pkgDir}: the root export gives a browser the per-module build and Cloudflare the ESM bundle`, () => {
    const root = readPkg(pkgDir).exports['.'];
    const resolveAs = (kind, active) =>
      resolveCondition(resolveCondition(root, new Set([...active, kind])), new Set([kind]));

    assert.equal(resolveAs('import', BROWSER), './dist/browser/index.mjs');
    assert.equal(resolveAs('import', BROWSER_WORKER), './dist/browser/index.mjs');
    assert.equal(resolveAs('import', VERCEL_EDGE), './dist/browser/index.mjs');
    assert.deepEqual(resolveAs('import', CLOUDFLARE), root.import);
    assert.equal(resolveCondition(root, new Set(['import'])), root.import);
    // A require() with the browser condition and without `module` (jest-environment-jsdom) keeps the CommonJS build
    assert.equal(resolveAs('require', BROWSER), './dist/index.js');
    assert.equal(resolveAs('require', BROWSER_WORKER), './dist/index.js');
    assert.deepEqual(resolveAs('require', CLOUDFLARE), root.require);
  });
}
