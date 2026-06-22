/**
 * E2E: `@frontmcp/edge` managed auto-update on real workerd (via miniflare).
 *
 * Proves the worker-safe auto-update path end-to-end in a V8 isolate:
 *   1. `createEdgeMcp({ managed })` bundles + boots in workerd (`nodejs_compat`),
 *      including the lazily-imported `@frontmcp/plugin-skilled-openapi`.
 *   2. It serves MCP (initialize + the skilled-openapi meta-tools) over the
 *      Web-standard fetch handler.
 *   3. The Cron `scheduled` handler pulls a fresh bundle from the SaaS endpoint
 *      and persists the last-good copy to a **Cloudflare KV namespace** (no
 *      filesystem), resolved from the per-request `env`.
 *   4. A second `scheduled` after the endpoint changes hot-swaps to the new
 *      bundle — capabilities update without a redeploy.
 *
 * Nothing is mocked: esbuild produces the real worker bundle, miniflare runs it
 * in workerd, and the bundle is pulled over real HTTP from a local server.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * IMPORTANT — miniflare is STRICTER than production Cloudflare. Deploying the
 * edge package to a REAL Cloudflare account (see `cloudflare-sandbox/`, the
 * `edge` variant) showed that production `nodejs_compat` PROVIDES `node:http2` /
 * `node:fs` / buffer — the modules this miniflare harness rejects. On real CF the
 * `@frontmcp/edge` `createEdgeMcp` worker boots + serves MCP once you (a) set
 * `serve: false` (now the default in createEdgeMcp — it was eagerly constructing
 * the Node Express host) and (b) stub three statically-bundled-but-unused Node
 * transports: express (node:tty), raw-body (safer-buffer), cross-spawn
 * (node:child_process). So this skip reflects miniflare strictness, NOT a hard
 * production blocker. The worker-conditioned build below would remove the stubs.
 * ──────────────────────────────────────────────────────────────────────────
 * STATUS: skipped — gated on the "strip Node-only imports from the SDK/adapters
 * hot path" ROADMAP item (Cloudflare Worker Runtime / V8-isolate-compatible
 * build). The auto-update *mechanism* is fully verified elsewhere by unit +
 * integration tests:
 *   - libs/adapters/.../saas-pull.source.edge.spec.ts (pluggable cache, refresh,
 *     disablePolling)
 *   - plugins/.../runtime-deps-injection.spec.ts (REAL plugin + source + store:
 *     KV-fallback on boot, Cron refresh() pulls + persists + hot-swaps)
 *   - libs/edge/.../kv-cache.spec.ts + index.spec.ts (KV cache, env factory,
 *     scheduled wiring)
 *
 * Progress so far (the infrastructure here — esbuild bundle + miniflare KV +
 * fake bundle server — all works; it now gets past bundling and module loading):
 *   ✓ Computed dynamic-import hazards fixed so the bundle is statically
 *     analyzable: esm-module-loader.ts + npm.source.ts route runtime-computed
 *     `import()` through a lazily-built indirection.
 *   ✓ Both FIRST-PARTY static `fs` imports eliminated (were the `No such module
 *     "node:fs"` load failure): libs/utils/src/env/provider.ts and
 *     libs/sdk/src/logger/instances/instance.file-logger.ts now lazy-`require`
 *     fs. With esbuild `conditions: ['worker','browser']`, the bundle has ZERO
 *     static `node:fs` imports.
 *
 * Progress (cont'd): the express server adapter is now lazy-`require`d in
 * `server.instance.ts` (was a top-level static import), so its module-eval
 * `node:fs` no longer runs at bundle load — the boot now gets PAST express.
 * `@anthropic-ai/sdk` is aliased to an empty stub here (never executed on the
 * edge path) to drop its + transitive `@opentelemetry`'s Node-only eval.
 *
 * What still blocks the full workerd boot — the "dedicated worker build" item:
 *   The remaining offenders are Node-server / Node-only modules statically
 *   reachable from the package barrels that import `node:http2` (@hono/node-server
 *   via `@frontmcp/protocol`'s node MCP server) and `node:dns` (the OpenAPI
 *   adapter). Crucially, BOTH `@frontmcp/protocol` and `@frontmcp/sdk` already
 *   ship browser variants behind conditional imports (e.g. protocol's
 *   `browser-mcp-server` / `browser-mcp-streamable-http`; the SDK's `#express-host`
 *   / `#sse-transport`). They're baked to the node variant because each package
 *   is built with esbuild `bundle:true` under default (node) conditions. The fix
 *   is therefore a single build-pipeline change — a worker-conditioned dist build
 *   (esbuild `conditions: ['worker','browser']`) exposed via a `worker` export
 *   condition, consumed by this bundle with `conditions: ['worker']` — which
 *   activates those existing browser variants across the board, NOT per-module
 *   lazy patching. Tracked under the ROADMAP "V8-isolate-compatible SDK build"
 *   item. Once it lands, flip `describe.skip` → `describe`.
 * ──────────────────────────────────────────────────────────────────────────
 */
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import * as path from 'node:path';

import * as esbuild from 'esbuild';
import { Miniflare } from 'miniflare';

const ROOT_DIR = path.resolve(__dirname, '../../../..');
const WORKER_SRC = path.resolve(__dirname, '..', 'fixture-managed', 'worker.ts');
const EDGE_DIST = path.join(ROOT_DIR, 'libs', 'edge', 'dist', 'index.js');
const STUB_EMPTY = path.resolve(__dirname, '..', 'fixture-managed', 'stub-empty.mjs');
const KV_KEY = 'frontmcp:bundle:last-good';

// createRequire banner — esbuild's `__require` shim throws on a lazy
// `require('node:*')` unless a real `require` exists in module scope (none in
// native ESM). Mirrors `scripts/inject-esm-require-banner.js`.
const BANNER =
  "import { createRequire as __frontmcpCreateRequire } from 'module';\n" +
  "const require = __frontmcpCreateRequire(import.meta.url || 'file:///');\n";

function makeBundle(version: string) {
  return {
    schemaVersion: 1,
    bundleId: 'e2e:managed',
    version,
    generatedAt: '2026-06-17T00:00:00Z',
    sourceDigest: 'a'.repeat(64),
    services: [{ id: 'svc', baseUrl: 'https://api.example.com' }],
    authBindings: { def: { kind: 'none' } },
    skills: [{ id: 'demo', name: 'Demo', description: 'demo skill', instructions: '# Demo', operationIds: [] }],
    operations: {},
  };
}

const MCP_HEADERS = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

/** Minimal JSON-RPC envelope covering exactly the fields these tests read. */
type JsonRpcResponse = {
  jsonrpc?: string;
  id?: number | string | null;
  result?: {
    serverInfo?: { name?: string; version?: string };
    capabilities?: { tools?: unknown };
    tools?: Array<{ name: string }>;
    content?: Array<{ text?: string }>;
  };
  error?: { code: number; message: string };
};

// NOTE: still skipped, but the blocker has MOVED. The original gate (the
// worker-conditioned SDK build) landed in 1.5.0 (the `worker` export condition on
// @frontmcp/protocol + @frontmcp/utils) and is no longer the problem. What blocks
// it now is a MINIFLARE limitation: its in-process `ModuleLocator` rejects the
// bundle's dynamic `import()` (the lazy plugin / enclave imports) at
// `#visitModule` → `ImportExpression`. Real workerd via `wrangler dev` handles
// these fine — the worker boots and serves the full skilled-openapi mechanism
// (search_skill → load_skill → run_workflow) end-to-end; only Miniflare's bundler
// chokes. Re-enable when Miniflare supports dynamic import in the entry module, or
// migrate this suite to a `wrangler dev` subprocess (as cloudflare-worker.e2e does).
describe.skip('managed edge auto-update on workerd (miniflare)', () => {
  let server: Server;
  let mf: Miniflare;
  let served = '1'; // version the fake endpoint currently serves
  let pullCount = 0;

  beforeAll(async () => {
    // 1. Fake SaaS bundle endpoint — serves the current bundle version,
    //    authenticated by the pinned bearer token.
    server = createServer((req, res) => {
      if (req.url?.endsWith('/jwks')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ keys: [] }));
        return;
      }
      if (req.headers.authorization !== 'Bearer test-token') {
        res.writeHead(401).end('unauthorized');
        return;
      }
      pullCount++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(makeBundle(served)));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const endpoint = `http://127.0.0.1:${port}/bundle`;

    // 2. Bundle the worker for workerd — single ESM file (esbuild inlines the
    //    lazy plugin import), endpoint baked in via `define`, edge resolved from
    //    its built dist (not yet symlinked in node_modules).
    const bundlePath = path.resolve(__dirname, '..', 'fixture-managed', 'dist', 'worker.mjs');
    await esbuild.build({
      entryPoints: [WORKER_SRC],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'es2022',
      mainFields: ['module', 'main'],
      outfile: bundlePath,
      banner: { js: BANNER },
      define: { __E2E_BUNDLE_ENDPOINT__: JSON.stringify(endpoint) },
      // Worker/browser conditions → @frontmcp/utils resolves its `#`-subpath
      // imports (fs/path/crypto/env) to non-Node variants, keeping `node:fs` out
      // of the bundle.
      conditions: ['worker', 'browser'],
      // Node-only optional deps referenced behind lazy `import()` but never
      // executed on the edge path: alias to an empty stub so their Node-only
      // module-eval (require('fs')/child_process + transitive @opentelemetry) is
      // dropped, while staying resolvable (unlike `external`, which leaves an
      // unresolvable runtime specifier miniflare rejects).
      alias: {
        '@frontmcp/edge': EDGE_DIST,
        '@anthropic-ai/sdk': STUB_EMPTY,
      },
      logLevel: 'silent',
    });

    // 3. Boot it in workerd with a KV namespace binding.
    mf = new Miniflare({
      scriptPath: bundlePath,
      modules: true,
      kvNamespaces: ['BUNDLE_CACHE'],
      compatibilityDate: '2024-09-23',
      compatibilityFlags: ['nodejs_compat'],
    });
    await mf.ready;
  }, 170000);

  afterAll(async () => {
    await mf?.dispose();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  const fetchWorker = async (url: string, init?: RequestInit) => {
    const worker = await mf.getWorker();
    return worker.fetch(new Request(url, init));
  };

  const mcp = async (body: unknown) => {
    const res = await fetchWorker('http://localhost/mcp', {
      method: 'POST',
      headers: MCP_HEADERS,
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await readMcp(res) };
  };

  // The worker streams SSE by default (legacy protocol); read either shape.
  const readMcp = async (res: Response): Promise<JsonRpcResponse> => {
    const text = await res.text();
    if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
      const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
      return dataLine ? (JSON.parse(dataLine.slice('data:'.length).trim()) as JsonRpcResponse) : {};
    }
    return text ? (JSON.parse(text) as JsonRpcResponse) : {};
  };

  const triggerCron = async () => {
    const worker = await mf.getWorker();
    return worker.scheduled({ cron: '*/5 * * * *' });
  };

  const kvVersion = async (): Promise<string | undefined> => {
    const ns = await mf.getKVNamespace('BUNDLE_CACHE');
    const raw = await ns.get(KV_KEY);
    return raw ? (JSON.parse(raw).version as string) : undefined;
  };

  const pollKvVersion = async (expected: string, ms = 8000): Promise<string | undefined> => {
    const deadline = Date.now() + ms;
    let last: string | undefined;
    while (Date.now() < deadline) {
      last = await kvVersion();
      if (last === expected) return last;
      await new Promise((r) => setTimeout(r, 200));
    }
    return last;
  };

  it('boots in workerd and answers a liveness probe', async () => {
    const res = await fetchWorker('http://localhost/healthz');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; transport: string };
    expect(body.status).toBe('ok');
    expect(body.transport).toBe('web-fetch');
  });

  it('serves MCP initialize from the managed edge', async () => {
    const { status, json } = await mcp({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1.0.0' } },
    });
    expect(status).toBe(200);
    expect(json.result?.serverInfo?.name).toBe('cf-managed-fixture');
  });

  it('exposes the skilled-openapi meta-tools (plugin wired + bundled)', async () => {
    const { json } = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const names = (json.result?.tools ?? []).map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(['search_skill', 'load_skill', 'run_workflow']));
  });

  it('Cron scheduled() pulls the bundle and persists it to KV', async () => {
    await triggerCron();
    expect(await pollKvVersion('1')).toBe('1');
    expect(pullCount).toBeGreaterThan(0);
  });

  it('hot-swaps to a new bundle on the next Cron without redeploy', async () => {
    served = '2'; // endpoint now serves a newer bundle
    await triggerCron();
    expect(await pollKvVersion('2')).toBe('2');
  });
});
