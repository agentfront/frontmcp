/**
 * `@frontmcp/edge` — run a FrontMCP server on a V8-isolate runtime
 * (Cloudflare Workers, Deno Deploy, Bun) from a plain config object.
 *
 * No `@FrontMcp` decorator, no `frontmcp build` step: the edge entry imports
 * this package, passes a config, and exports the returned `fetch` handler. The
 * bundler (wrangler/esbuild) handles the rest.
 *
 * ```ts
 * // worker.ts (~10 lines)
 * import { createEdgeMcp } from '@frontmcp/edge';
 * import { MyApp } from './apps';
 *
 * export default createEdgeMcp({
 *   info: { name: 'my-worker', version: '1.0.0' },
 *   apps: [MyApp],
 *   tasks: { enabled: false }, // edge has no Redis here
 * });
 * ```
 *
 * **Managed mode** (auto-updating): point it at a SaaS endpoint serving a
 * signed skilled-openapi bundle (OpenAPI → skills + tools), pulled on boot and
 * refreshed by polling — no redeploy on capability changes.
 *
 * ```ts
 * export default createEdgeMcp({
 *   info: { name: 'my-worker', version: '1.0.0' },
 *   apps: [],
 *   tasks: { enabled: false },
 *   managed: {
 *     endpoint: 'https://cloud.frontmcp.dev/v1/bundles/acme',
 *     authToken: env.FRONTMCP_PULL_TOKEN,
 *     expectedAudience: 'acme-mcp',
 *     jwksUrl: 'https://cloud.frontmcp.dev/.well-known/jwks.json',
 *     expectedIssuer: 'https://cloud.frontmcp.dev',
 *   },
 * });
 * ```
 */
import { FrontMcpInstance, createWebFetchHandler, type WebFetchHandler } from '@frontmcp/sdk';

import type { EdgeBundleCacheFactory, EdgeBundleCacheStore } from './kv-cache';
import { buildManagedOpenApiPluginOptions, type ManagedEdgeOptions } from './managed';
import { createEdgeSessionDurableObject, createEdgeSessionRouter } from './session-host';

export type { ManagedEdgeOptions } from './managed';
export { buildManagedOpenApiPluginOptions } from './managed';
export {
  createKvBundleCache,
  kvBundleCacheFromEnv,
  type EdgeBundleCacheFactory,
  type EdgeBundleCacheStore,
  type EdgeKvNamespace,
  type KvBundleCacheOptions,
} from './kv-cache';

/**
 * Well-known DI token `@frontmcp/plugin-skilled-openapi` reads to pick up
 * host-injected runtime deps (KV cache + `disablePolling`) and to hand back the
 * live bundle source. Resolved via `Symbol.for(...)` on both sides so the edge
 * needs no static import of the (optional-peer) plugin. Must match
 * `SKILLED_OPENAPI_RUNTIME_DEPS_TOKEN` in the plugin.
 */
const RUNTIME_DEPS_TOKEN = Symbol.for('frontmcp:skilled-openapi:runtime-deps');

/** A bundle source that can be refreshed on demand (Cron/alarm-driven). */
interface RefreshableSource {
  refresh?(): Promise<unknown>;
}

/**
 * Carries the KV cache + `disablePolling` flag into the skilled-openapi plugin
 * and captures the live source so {@link EdgeMcp.scheduled} can refresh it. A
 * Worker has no background timers, so polling is disabled and a Cron Trigger /
 * Durable Object alarm drives refresh instead.
 */
class EdgeRefreshController {
  private source?: RefreshableSource;

  constructor(
    readonly cache?: EdgeBundleCacheStore,
    readonly disablePolling: boolean = true,
  ) {}

  attach(source: RefreshableSource): void {
    this.source = source;
  }

  async refresh(): Promise<unknown> {
    if (!this.source) {
      // The scope built but the skilled-openapi plugin never attached a source
      // — it failed to construct one (see earlier logs). Throw so the Cron run
      // surfaces as a FAILED scheduled invocation instead of silently
      // "succeeding" while the bundle stays stale forever.
      throw new Error(
        'createEdgeMcp(managed): no bundle source attached — the skilled-openapi plugin failed to construct it; Cron refresh cannot run.',
      );
    }
    return this.source.refresh?.();
  }
}

/**
 * Resolve the configured cache against the per-request `env`. A factory form
 * (`(env) => store`) is how a CF KV binding — which lives on `env`, not in
 * module scope — becomes a cache; a plain store is passed through unchanged.
 */
function resolveCache(
  cache: EdgeBundleCacheStore | EdgeBundleCacheFactory | undefined,
  env: unknown,
): EdgeBundleCacheStore | undefined {
  if (!cache) return undefined;
  return typeof cache === 'function' ? cache(env) : cache;
}

let envBridged = false;
/**
 * Bridge the Worker `env` (vars + secrets) into `process.env` once, so
 * FrontMCP's `getEnv()` — which reads `process.env` — sees configuration the
 * flow needs at runtime (e.g. `MCP_SESSION_SECRET` for session-id encryption,
 * auth provider settings). On Cloudflare these live on the per-request `env`,
 * not `process.env`; without this the `http:request` flow's `session:verify`
 * stage throws `SessionSecretRequiredError` on a production isolate. Only copies
 * string values that aren't already set, so wrangler `[vars]`/secrets win
 * without clobbering anything pre-existing.
 */
function bridgeEnvToProcessEnv(env: unknown): void {
  if (envBridged || !env || typeof env !== 'object') return;
  const proc = (globalThis as { process?: { env?: Record<string, string> } }).process;
  if (!proc?.env) return;
  for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
    if (typeof value === 'string' && proc.env[key] === undefined) proc.env[key] = value;
  }
  envBridged = true;
}

/** The plain FrontMCP config the SDK accepts (same shape `@FrontMcp(...)` takes). */
type BaseConfig = Parameters<typeof FrontMcpInstance.createForGraph>[0];

/**
 * Config accepted by {@link createEdgeMcp} — the FrontMCP config plus an
 * optional `managed` block for the auto-updating skilled-openapi path.
 */
export type EdgeMcpConfig = BaseConfig & {
  /**
   * Managed mode — pull an auto-updating skilled-openapi bundle from a SaaS
   * endpoint. Requires the optional peer `@frontmcp/plugin-skilled-openapi`.
   */
  managed?: ManagedEdgeOptions;
  /**
   * Enable **stateful MCP sessions** via a Cloudflare Durable Object, so the
   * Streamable HTTP standalone GET notification stream stays open across
   * requests and a `tools/call`'s notifications reach it (the stateless worker
   * can't do this). Export the returned {@link EdgeMcp.SessionDurableObject} and
   * bind it in `wrangler.toml` under this `binding` name (default
   * `FRONTMCP_SESSIONS`). When omitted, the worker is stateless.
   */
  sessions?: { binding?: string };
};

// The Scope shape `createWebFetchHandler` expects (not re-exported from the SDK
// root; derived to avoid widening the SDK's public surface).
type Scope = Parameters<typeof createWebFetchHandler>[0];

/** Default DurableObject binding name when `sessions` is enabled without an explicit one. */
const DEFAULT_SESSION_BINDING = 'FRONTMCP_SESSIONS';

/** An edge module: `export default createEdgeMcp(config)`. */
export interface EdgeMcp {
  fetch: (request: Request, env?: unknown, ctx?: unknown) => Promise<Response>;
  /**
   * Cloudflare **Cron Trigger** entrypoint — present only in managed mode.
   * Wire a `[triggers] crontabs = ["*&#47;5 * * * *"]` in `wrangler.toml` and
   * the runtime calls this on schedule; it pulls a fresh bundle and hot-swaps
   * it (Workers have no background timers, so this replaces internal polling).
   */
  scheduled?: (event?: unknown, env?: unknown, ctx?: unknown) => Promise<void>;
  /**
   * The **Durable Object class** for stateful sessions. Always present; re-export
   * it from the worker entry and bind it in `wrangler.toml` (with a migration)
   * to enable stateful sessions:
   *
   * ```ts
   * const mcp = createEdgeMcp({ ..., sessions: {} });
   * export default mcp;
   * export const FrontMcpSession = mcp.SessionDurableObject;
   * ```
   */
  SessionDurableObject: new (state: unknown, env: unknown) => { fetch(request: Request): Promise<Response> };
}

/**
 * Build an edge module (`{ fetch }`) from a FrontMCP config.
 *
 * The FrontMCP scope is built **lazily on the first request** and memoized —
 * V8 isolates forbid timers / random / I-O at module-eval (global) scope, and
 * scope initialization legitimately does those; deferring to the first `fetch`
 * runs that work inside a request context, where it is allowed.
 *
 * Durable Object classes (sessions/event store) are not part of this skeleton
 * yet — the handler is stateless. They arrive with `@frontmcp/adapters/cloudflare`.
 */
export function createEdgeMcp(config: EdgeMcpConfig): EdgeMcp {
  let handlerPromise: Promise<WebFetchHandler> | undefined;

  // In managed mode a controller carries the KV cache + `disablePolling` into
  // the plugin and captures the live source for Cron-driven refresh. It's
  // created inside `build(env)` — not here — because the cache may be a factory
  // that resolves a binding from the per-request `env` (CF bindings don't exist
  // at module-eval). Shared between `fetch` and `scheduled` via this closure.
  let controller: EdgeRefreshController | undefined;

  // `env` from the first request (fetch or scheduled) is what buildScope() uses
  // to resolve the cache; the handler is memoized via `handlerPromise`, so it
  // runs once. `buildScope` is ALSO called by the Durable Object (in its own
  // isolate) to build a session-local scope.
  const buildScope = async (env: unknown): Promise<Scope> => {
    const { managed, sessions: _sessions, ...rest } = config;
    // The edge serves via the web-fetch handler, NOT an HTTP listen server, so
    // tell the scope `serve: false`. That selects the no-op `FrontMcpServer`
    // provider instead of `FrontMcpServerInstance` — which would otherwise be
    // eagerly constructed during scope build and pull in the Node Express host
    // (not worker-safe). The web-fetch handler doesn't need it.
    const base = { ...rest, serve: false } as BaseConfig;
    let frontmcpConfig = base;

    if (managed) {
      controller = new EdgeRefreshController(resolveCache(managed.cache, env));
      // Wire the skilled-openapi plugin (SaaS source) so the bundle is pulled
      // on boot and auto-refreshed. Lazy-imported so non-managed edges never
      // pay for it. The literal specifier stays bundlable by wrangler.
      const mod = await import('@frontmcp/plugin-skilled-openapi');
      const SkilledOpenApiPlugin = (mod as { default: { init(options: unknown): unknown } }).default;
      const plugin = SkilledOpenApiPlugin.init(buildManagedOpenApiPluginOptions(managed));
      const existingPlugins = ((base as { plugins?: unknown[] }).plugins ?? []) as unknown[];
      // Provide the controller under the well-known token. Config-level
      // providers register (and instantiate) before plugin dynamicProviders, so
      // the plugin's bundle-source factory sees it — supplying the KV cache +
      // `disablePolling` and attaching the live source back onto the controller.
      const existingProviders = ((base as { providers?: unknown[] }).providers ?? []) as unknown[];
      frontmcpConfig = {
        ...base,
        plugins: [...existingPlugins, plugin],
        providers: [
          ...existingProviders,
          { name: 'edge:skilled-openapi-runtime-deps', provide: RUNTIME_DEPS_TOKEN, useValue: controller },
        ],
      } as BaseConfig;
    }

    const instance = await FrontMcpInstance.createForGraph(frontmcpConfig);
    const scope = instance.getScopes()[0] as Scope | undefined;
    if (!scope) {
      throw new Error('createEdgeMcp: the config produced no scope — declare an app/tool or `managed`.');
    }
    return scope;
  };

  // Stateful sessions (Durable Object): when configured, MCP requests are routed
  // to a per-session DO so the GET notification stream + server push work. The
  // router falls back to stateless handling if the binding isn't bound in `env`.
  const sessionRouter = config.sessions
    ? createEdgeSessionRouter(config.sessions.binding ?? DEFAULT_SESSION_BINDING)
    : undefined;

  const build = async (env: unknown): Promise<WebFetchHandler> => {
    const scope = await buildScope(env);
    // The web-fetch handler derives entryPath / cors / sse from the scope's
    // `http` + `transport` config (same surface the decorator path uses). The
    // sessionRouter (if any) routes MCP requests to the Durable Object.
    return createWebFetchHandler(scope, sessionRouter ? { sessionRouter } : {});
  };

  // Build (memoized) on the first request, resolving the cache from that
  // request's `env`. A FAILED build clears the memo so the next request/cron
  // retries — a transient blip during the boot pull shouldn't permanently brick
  // the worker (a request-handler error, by contrast, is per-request and does
  // not invalidate the built scope).
  const ensureHandler = async (env: unknown): Promise<WebFetchHandler> => {
    if (!handlerPromise) handlerPromise = build(env);
    try {
      return await handlerPromise;
    } catch (e) {
      handlerPromise = undefined;
      throw e;
    }
  };

  const mcp: EdgeMcp = {
    async fetch(request: Request, env?: unknown, ctx?: unknown): Promise<Response> {
      bridgeEnvToProcessEnv(env);
      const handler = await ensureHandler(env);
      // Forward the Worker ExecutionContext (for `waitUntil` on SSE bodies) and
      // `env` (so the session router can resolve its Durable Object binding).
      return handler(request, ctx as { waitUntil?(p: Promise<unknown>): void } | undefined, env);
    },
    // The DO builds its own session-local scope (in its isolate) via buildScope,
    // and bridges `env`→`process.env` the same way the worker does.
    SessionDurableObject: createEdgeSessionDurableObject(buildScope, bridgeEnvToProcessEnv),
  };

  if (config.managed) {
    mcp.scheduled = async (_event?: unknown, env?: unknown): Promise<void> => {
      bridgeEnvToProcessEnv(env);
      // Ensure the scope is built (which resolves the cache from `env` and
      // attaches the live source to the controller), then pull + hot-swap.
      await ensureHandler(env);
      await controller?.refresh();
    };
  }

  return mcp;
}
