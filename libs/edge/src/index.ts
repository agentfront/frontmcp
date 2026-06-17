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
    return this.source?.refresh?.();
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
};

// The Scope shape `createWebFetchHandler` expects (not re-exported from the SDK
// root; derived to avoid widening the SDK's public surface).
type Scope = Parameters<typeof createWebFetchHandler>[0];

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

  // `env` from the first request (fetch or scheduled) is what build() uses to
  // resolve the cache; build is memoized via `handlerPromise`, so it runs once.
  const build = async (env: unknown): Promise<WebFetchHandler> => {
    const { managed, ...base } = config;
    let frontmcpConfig = base as BaseConfig;

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
    return createWebFetchHandler(scope);
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
    async fetch(request: Request, env?: unknown): Promise<Response> {
      const handler = await ensureHandler(env);
      return handler(request);
    },
  };

  if (config.managed) {
    mcp.scheduled = async (_event?: unknown, env?: unknown): Promise<void> => {
      // Ensure the scope is built (which resolves the cache from `env` and
      // attaches the live source to the controller), then pull + hot-swap.
      await ensureHandler(env);
      await controller?.refresh();
    };
  }

  return mcp;
}
