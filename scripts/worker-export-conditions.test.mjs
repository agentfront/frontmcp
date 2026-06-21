// Guards the `worker` export-condition invariant on the @frontmcp packages that
// split Node-only vs portable implementations via `imports` subpath maps.
//
// WHY THIS EXISTS: Cloudflare Workers (wrangler) and other workerd bundlers
// activate the `worker` AND `browser` resolution conditions. workerd is NOT a
// browser — it provides node builtins via `nodejs_compat` and needs the
// web-fetch MCP transport, but it must NOT pull the Node-only host transports
// (stdio/SSE/Express -> node:child_process / raw-body / express). Before the fix,
// these maps only had {browser, default}; bundlers picked `browser`, which
// resolves to THROWING STUBS (utils #env getEnvFlag()->false; protocol
// #mcp-streamable-http ctor throws) and the worker 500'd at boot / transport.
//
// The fix adds a `worker` condition LISTED FIRST (so it wins when both `worker`
// and `browser` are active) pointing at the impl that actually runs on workerd.
// The monorepo's demo-e2e-cloudflare CANNOT catch a regression here because it
// consumes workspace `src` via the `development` condition, masking the bug —
// hence this dedicated guard over the real condition-resolution algorithm.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
const WORKER = new Set(['worker', 'browser']); // wrangler / workerd bundlers
const BROWSER = new Set(['browser']); // real web bundlers
const NODE = new Set(); // plain Node.js / jest

// For each package: which impl a WORKER bundler MUST resolve to.
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
  },
  'libs/sdk': {
    '#sse-transport': 'stub',
    '#express-host': 'stub',
  },
};

const isBrowserPath = (p) => /(^|\/)browser[-/]|\/browser\.ts$/.test(p);

for (const [pkgDir, splits] of Object.entries(EXPECT)) {
  const pkg = readPkg(pkgDir);

  test(`${pkgDir}: imports map carries a worker condition for every split`, () => {
    for (const imp of Object.keys(splits)) {
      const entry = pkg.imports?.[imp];
      assert.ok(entry, `${pkgDir} #${imp} missing from imports`);
      assert.ok('worker' in entry, `${pkgDir} ${imp} must declare a "worker" condition`);
      // `worker` MUST precede `browser`, else a worker bundler (both active) picks browser.
      const keys = Object.keys(entry);
      assert.ok(
        !keys.includes('browser') || keys.indexOf('worker') < keys.indexOf('browser'),
        `${pkgDir} ${imp}: "worker" must be listed before "browser"`,
      );
    }
  });

  test(`${pkgDir}: a worker bundler resolves to the workerd-correct impl`, () => {
    for (const [imp, want] of Object.entries(splits)) {
      const resolved = resolveCondition(pkg.imports[imp], WORKER);
      if (want === 'node') {
        assert.ok(
          !isBrowserPath(resolved),
          `${pkgDir} ${imp}: worker must NOT resolve to a browser stub (got ${resolved})`,
        );
        assert.equal(resolved, pkg.imports[imp].default, `${pkgDir} ${imp}: worker should match the node/default impl`);
      } else {
        assert.ok(
          isBrowserPath(resolved),
          `${pkgDir} ${imp}: worker must resolve to the browser stub (got ${resolved})`,
        );
      }
    }
  });

  test(`${pkgDir}: browser + node resolution are unchanged by the worker key`, () => {
    for (const imp of Object.keys(splits)) {
      const entry = pkg.imports[imp];
      assert.equal(
        resolveCondition(entry, BROWSER),
        entry.browser,
        `${pkgDir} ${imp}: browser builds must still get the browser impl`,
      );
      assert.equal(
        resolveCondition(entry, NODE),
        entry.default,
        `${pkgDir} ${imp}: Node must still get the default impl`,
      );
    }
  });
}
