// file: plugins/plugin-skilled-openapi/src/skilled-openapi.plugin.ts

import {
  BundleStore,
  createBundleSource,
  type BundleSourceDeps,
  type BundleStoreCounter,
  type BundleStoreSpan,
  type BundleStoreTelemetry,
  type SkillBundleSource,
} from '@frontmcp/adapters/skills';
import {
  buildSkillsCatalogSummary,
  DynamicPlugin,
  FlowHooksOf,
  FrontMcpContextStorage,
  FrontMcpLogger,
  ListToolsHook,
  Plugin,
  ScopeEntry,
  type FlowCtxOf,
  type ProviderRegistry,
  type ProviderType,
  type SkillRegistryInterface,
  type ToolRegistry,
} from '@frontmcp/sdk';

import { MemoryCredentialResolver } from './executor/credential-resolver';
import { HiddenOpRegistry } from './registry/hidden-op.registry';
import { AuthorityGuard } from './security/authority-guard';
import { bundleSkillPolicies, SkillVisibility } from './security/skill-visibility';
import { SkilledOpenApiConfig, SkilledOpenApiCredentialResolver } from './skilled-openapi.symbols';
import {
  skilledOpenApiPluginOptionsSchema,
  type SkilledOpenApiPluginOptions,
  type SkilledOpenApiPluginOptionsInput,
} from './skilled-openapi.types';
import { BundleSyncService } from './sync/bundle-sync.service';
import LoadSkillTool from './tools/load-skill.tool';
import { OperationToolFactory } from './tools/operation-tool.factory';
import RunWorkflowTool from './tools/run-workflow.tool';
import { searchSkillDescription } from './tools/search-skill.schema';
import SearchSkillTool from './tools/search-skill.tool';

/**
 * Symbol used by `@frontmcp/observability` to register the GLOBAL-scoped
 * TelemetryFactory in the DI container. Unlike `TELEMETRY_ACCESSOR` (which
 * is CONTEXT-scoped and needs an active request), `TELEMETRY_FACTORY` is
 * resolvable at scope-init time — so it works for scope-lifetime singletons
 * like `BundleStore` whose `swap()` may be invoked from a source's onChange
 * callback before any request arrives. Mirrored here so we can probe for it
 * without taking a hard dependency on the optional observability peer.
 */
const TELEMETRY_FACTORY_TOKEN = Symbol.for('frontmcp:observability:telemetry-factory');

/** The `skills:filter` flow every SDK skill surface runs (skills/list, skills/load, skill:// resources, /skills). */
const FilterSkillsHook = FlowHooksOf('skills:filter');

/**
 * Well-known DI token a host can use to inject runtime dependencies into the
 * plugin's bundle source — without taking a hard dependency on this plugin (the
 * host just provides a value under `Symbol.for(...)`). This is the same
 * cross-package wiring pattern as {@link TELEMETRY_FACTORY_TOKEN}.
 *
 * `@frontmcp/edge` uses it to (a) swap the on-disk last-good cache for a
 * KV-backed store and disable background polling (no filesystem / no background
 * execution on a Worker), and (b) receive the live source so a Cron Trigger /
 * Durable Object alarm can drive {@link SkillBundleSource.refresh}.
 */
export const SKILLED_OPENAPI_RUNTIME_DEPS_TOKEN = Symbol.for('frontmcp:skilled-openapi:runtime-deps');

/**
 * Runtime dependencies a host injects under {@link
 * SKILLED_OPENAPI_RUNTIME_DEPS_TOKEN}. Extends the generic {@link
 * BundleSourceDeps} (pluggable cache + `disablePolling`) with an `attach`
 * callback that hands back the live source for external refresh scheduling.
 */
export interface SkilledOpenApiRuntimeDeps extends BundleSourceDeps {
  /**
   * Invoked once with the live bundle source right after it's constructed, so
   * an external scheduler (Cloudflare Cron Trigger / DO alarm) can call
   * `source.refresh()` on a runtime with no background timers.
   */
  attach?(source: SkillBundleSource): void;
}

/**
 * Resolve host-injected {@link SkilledOpenApiRuntimeDeps} from the scope's
 * provider registry. Returns `undefined` when nothing is registered (the normal
 * Node path) — mirrors {@link resolveBundleTelemetry}'s try/catch probe so the
 * plugin takes no hard dependency on the injecting host.
 */
function resolveRuntimeDeps(scope: ScopeEntry): SkilledOpenApiRuntimeDeps | undefined {
  const providers = scope?.providers;
  if (!providers || typeof providers.get !== 'function') return undefined;
  try {
    const deps = providers.get<SkilledOpenApiRuntimeDeps>(SKILLED_OPENAPI_RUNTIME_DEPS_TOKEN as never);
    return deps && typeof deps === 'object' ? deps : undefined;
  } catch {
    // Token not registered — no host injection (standard Node runtime).
    return undefined;
  }
}

/**
 * A stand-in for one of the scope's registries (`scope.skills`, `scope.tools`) that reads the
 * registry on every access. The plugin's providers are built while the server's plugins
 * initialize, before the scope creates those registries; an access before they exist throws.
 */
function lazyScopeRegistry<T extends object>(scope: ScopeEntry, name: 'skills' | 'tools'): T {
  return new Proxy({} as T, {
    get(_target, prop: string | symbol) {
      const registry = scope[name] as unknown as Record<string | symbol, unknown> | undefined;
      if (!registry) {
        throw new Error(`[skilled-openapi] scope.${name} not available when accessing "${String(prop)}"`);
      }
      const value = registry[prop];
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(registry) : value;
    },
  });
}

/**
 * Resolve a `BundleStoreTelemetry` from the scope's provider registry.
 *
 * Returns `undefined` when ObservabilityPlugin is not installed — in which
 * case `BundleStore` falls through its zero-cost no-telemetry path. We avoid
 * a hard dependency on `@frontmcp/observability` because it is optional.
 */
function resolveBundleTelemetry(scope: ScopeEntry): BundleStoreTelemetry | undefined {
  // Defensive: in narrowly-mocked test scopes `scope.providers` may be missing
  // entirely. `ProviderRegistryInterface` exposes only `get()`, which throws
  // when a token is unregistered, so we wrap it in a try/catch to detect the
  // ObservabilityPlugin-not-installed case without taking a hard dependency
  // on the optional peer.
  const providers = scope?.providers;
  if (!providers || typeof providers.get !== 'function') return undefined;
  interface FactoryLike {
    createCounter(name: string, description?: string): BundleStoreCounter;
    startSpan(name: string, attributes?: Record<string, string | number | boolean>): BundleStoreSpan;
  }
  let factory: FactoryLike | undefined;
  try {
    factory = providers.get<FactoryLike>(TELEMETRY_FACTORY_TOKEN as never);
  } catch {
    // Token not registered — observability disabled or plugin not installed.
    return undefined;
  }
  if (!factory || typeof factory.createCounter !== 'function') return undefined;
  return {
    createCounter: (name, description) => factory.createCounter(name, description),
    startSpan: (name, attributes) => factory.startSpan(name, attributes),
  };
}

/**
 * `@frontmcp/plugin-skilled-openapi`
 *
 * Consumes signed skill bundles (OpenAPI spec + Overlay) from a configured
 * source (static, npm, or SaaS-pull) and serves them as FrontMCP skills with
 * three meta-tools (`search_skill`, `load_skill`, `run_workflow`). Per-op
 * REST tools stay hidden from `tools/list`.
 *
 * Lifecycle: `BundleSyncService` is a useFactory provider that starts the
 * configured bundle source on first injection (lazy-boot). The meta-tools
 * inject it implicitly via `BundleStore` / `HiddenOpRegistry`, so the first
 * call to any meta-tool kicks off ingestion.
 */
@Plugin({
  name: 'skilled-openapi',
  description:
    "Serve a customer's OpenAPI spec as signed skill bundles with hidden per-operation tools mediated by 3 meta-tools.",
  providers: [],
  tools: [SearchSkillTool, LoadSkillTool, RunWorkflowTool],
  // The bundle's skills are registered after startup: serve the skills capability and methods from
  // startup, answering with the skills loaded so far.
  dynamicSkills: true,
})
export default class SkilledOpenApiPlugin extends DynamicPlugin<
  SkilledOpenApiPluginOptions,
  SkilledOpenApiPluginOptionsInput
> {
  options: SkilledOpenApiPluginOptions;
  private cachedLogger?: FrontMcpLogger;

  constructor(options: SkilledOpenApiPluginOptionsInput) {
    super();
    this.options = skilledOpenApiPluginOptionsSchema.parse(options);
    this.warnIfInsecureConfig();
  }

  private getLogger(): FrontMcpLogger {
    if (!this.cachedLogger) {
      this.cachedLogger = this.get(FrontMcpLogger).child('skilled-openapi');
    }
    return this.cachedLogger;
  }

  /**
   * Make the always-loaded `search_skill` tool description carry a live catalog
   * of the available skills (name + short description). Because tools/list is
   * always in the agent's context (unlike the initialize `instructions` a client
   * may not inject), embedding the catalog here tells the agent WHEN to call
   * `search_skill` — it can see what this server can do without searching first.
   *
   * Runs at every `tools:list-tools`, so the catalog reflects the currently
   * loaded bundle (hot-swaps included). Idempotent: the description is rebuilt
   * from the static base each time, never appended onto a prior catalog.
   */
  @ListToolsHook.Did('findTools', { priority: 50 })
  async injectSkillCatalogIntoSearchTool(flowCtx: FlowCtxOf<'tools:list-tools'>): Promise<void> {
    const { tools } = flowCtx.state;
    if (!tools || tools.length === 0) return;
    const target = tools.find((item) => item.tool?.metadata?.name === 'search_skill');
    if (!target) return;

    // Ensure the bundle source has booted AND its first bundle is applied so the
    // injected catalog reflects loaded skills — on a stateless worker this is the
    // only thing that drives the sync to completion within the request.
    try {
      await this.get(BundleSyncService).ensureReady();
    } catch {
      // sync service not available yet — fall back to whatever is registered
    }

    const scope = this.get(ScopeEntry);
    // Only the skills this caller may see, so the catalog names no skill it can't use.
    const visible = await this.skillVisibility(scope, flowCtx.state.authInfo).filterVisibleEntries(
      scope.skills?.getSkills({ visibility: 'mcp' }) ?? [],
    );
    const catalog = buildSkillsCatalogSummary(scope.skills, {
      mcpResources: scope.metadata?.skillsConfig?.mcpResources,
      skills: visible,
    });
    const description = catalog ? `${searchSkillDescription}\n\n---\n\n${catalog}` : searchSkillDescription;
    // The catalog is per caller: answer this list with a per-request view of the tool
    // instead of writing the description onto the shared tool metadata, where a
    // concurrent list for another caller could read it.
    const perRequestTool = Object.create(target.tool, {
      metadata: { value: { ...target.tool.metadata, description }, enumerable: true },
    }) as typeof target.tool;
    flowCtx.state.set(
      'tools',
      tools.map((item) => (item === target ? { ...item, tool: perRequestTool } : item)),
    );
  }

  /**
   * Hide a bundle skill from a caller who doesn't satisfy its `requiredAuthorities`
   * on every SDK skill surface (skills/list, skills/search, skills/load, the
   * `skill://` resources, the HTTP /skills API): a skill this flow drops is absent
   * there and not found when named. The plugin's own meta-tools apply the same rule.
   */
  @FilterSkillsHook.Did('filterSkills', { priority: 50 })
  async hideBundleSkillsFromCaller(flowCtx: FlowCtxOf<'skills:filter'>): Promise<void> {
    const { skills } = flowCtx.state;
    if (!skills || skills.length === 0) return;
    const bundle = this.get(BundleStore).current();
    const policies = bundleSkillPolicies(bundle);
    if (policies.size === 0) return;

    const visibility = new SkillVisibility({
      scope: this.get(ScopeEntry),
      guard: this.get(AuthorityGuard),
      bundle,
      unprotectedOps: this.options.unprotectedOps,
      authInfo: this.currentAuthInfo(),
    });
    const kept: typeof skills = [];
    for (const skill of skills) {
      if (await visibility.passesBundleSkillRule(skill.metadata.id ?? skill.name)) kept.push(skill);
    }
    if (kept.length !== skills.length) flowCtx.state.set('skills', kept);
  }

  private skillVisibility(scope: ScopeEntry, authInfo: unknown): SkillVisibility {
    return new SkillVisibility({
      scope,
      guard: this.get(AuthorityGuard),
      bundle: this.get(BundleStore).current(),
      unprotectedOps: this.options.unprotectedOps,
      authInfo,
    });
  }

  /** The AuthInfo of the request being served; an anonymous caller when there is none. */
  private currentAuthInfo(): unknown {
    try {
      return this.get(FrontMcpContextStorage)?.getStore()?.authInfo ?? {};
    } catch {
      return {};
    }
  }

  private warnIfInsecureConfig(): void {
    if (this.options.dev) {
      const signing = this.options.requireSignature
        ? 'signature verification kept (requireSignature=true)'
        : 'signature verification BYPASSED';
      console.warn(`[skilled-openapi] dev=true: ${signing} and http:// URLs allowed. NEVER use this in production.`);
    }
    if (!this.options.requireSignature && !this.options.dev) {
      console.warn(
        '[skilled-openapi] requireSignature=false without dev=true: bundle signing is OFF. This violates the v1.2 security baseline.',
      );
    }
  }

  static override dynamicProviders(options: SkilledOpenApiPluginOptionsInput): ProviderType[] {
    const parsed = skilledOpenApiPluginOptionsSchema.parse(options);
    const config = new SkilledOpenApiConfig(parsed);

    return [
      { name: 'skilled-openapi:config', provide: SkilledOpenApiConfig, useValue: config },
      { name: 'skilled-openapi:hidden-ops', provide: HiddenOpRegistry, useValue: new HiddenOpRegistry() },
      {
        name: 'skilled-openapi:bundle-store',
        provide: BundleStore,
        // Resolve TelemetryAccessor from the scope's provider registry so the
        // bundle-pulls counter and `skill.bundle.swap` span actually export.
        // The accessor is structurally compatible with `BundleStoreTelemetry`.
        // ObservabilityPlugin is an optional peer dep — when it isn't installed
        // we resolve `undefined` and the BundleStore falls through its zero-cost
        // no-telemetry path.
        inject: () => [ScopeEntry],
        useFactory: (scope: ScopeEntry) => new BundleStore({ telemetry: resolveBundleTelemetry(scope) }),
      },
      {
        name: 'skilled-openapi:credential-resolver',
        provide: SkilledOpenApiCredentialResolver,
        useValue: new MemoryCredentialResolver(parsed.credentials ?? {}) as unknown as SkilledOpenApiCredentialResolver,
      },
      {
        name: 'skilled-openapi:authority-guard',
        provide: AuthorityGuard,
        inject: () => [ScopeEntry],
        useFactory: (scope: ScopeEntry) =>
          new AuthorityGuard({
            logger: scope.logger.child('skilled-openapi:authority'),
            // Bundle rules follow the server's authorities settings (claimsMapping,
            // claimsResolver, relationshipResolver, evaluators) when it has them. Read per check:
            // the server may register its engine after this provider is built.
            serverAuthorities: () => {
              const engine = scope.authoritiesEngine;
              const contextBuilder = scope.authoritiesContextBuilder;
              return engine && contextBuilder ? { engine, contextBuilder } : undefined;
            },
          }),
      },
      {
        name: 'skilled-openapi:bundle-sync',
        provide: BundleSyncService,
        inject: () => [ScopeEntry, HiddenOpRegistry, BundleStore],
        useFactory: async (scope: ScopeEntry, hiddenOps: HiddenOpRegistry, bundleStore: BundleStore) => {
          const logger = scope.logger.child('skilled-openapi:sync');
          // Resolve scope.skills and scope.tools lazily: this factory runs while the
          // server's plugins initialize, BEFORE the scope creates its skill and tool
          // registries. Reads through these proxies happen later (when the bundle
          // source's first notification arrives or a meta-tool first calls into
          // BundleSyncService.apply()), once the registries exist.
          const lazySkillRegistry = lazyScopeRegistry<SkillRegistryInterface>(scope, 'skills');
          // Build the OperationToolFactory when the host opted in. Reading
          // `scope.tools` here would find no registry yet and silently register no
          // operation tool, so the factory gets the lazy registry too.
          let opToolFactory: OperationToolFactory | undefined;
          if (parsed.exposeOperationsAsInternalTools) {
            opToolFactory = new OperationToolFactory({
              toolRegistry: lazyScopeRegistry<ToolRegistry>(scope, 'tools'),
              // ScopeEntry exposes a ProviderRegistryInterface; the factory
              // needs the concrete ProviderRegistry to construct ToolInstance.
              // The runtime is the same class — the cast is safe by construction.
              providers: scope.providers as unknown as ProviderRegistry,
              logger: logger.child('op-tool'),
            });
          }

          const sync = new BundleSyncService(
            lazySkillRegistry,
            hiddenOps,
            bundleStore,
            {
              requireSignature: parsed.requireSignature,
              trustedKeys: parsed.trustedKeys,
              exposeOperationsAsInternalTools: parsed.exposeOperationsAsInternalTools,
              // Reuse the same telemetry adapter the BundleStore uses so the
              // signature verification counters are wired through the same
              // optional ObservabilityPlugin lookup. When observability isn't
              // installed this is `undefined` and verifyBundleSignature skips
              // the counter lookup entirely.
              telemetry: resolveBundleTelemetry(scope),
            },
            logger,
            opToolFactory,
          );
          // Host-injected runtime deps (e.g. `@frontmcp/edge` supplies a
          // KV-backed cache + `disablePolling` on a Worker). `undefined` on the
          // standard Node path — createBundleSource then keeps its fs cache and
          // internal poll loop.
          const runtimeDeps = resolveRuntimeDeps(scope);
          let source;
          try {
            source = createBundleSource(parsed.source, parsed.bundleCacheDir, logger, runtimeDeps);
          } catch (e) {
            logger.error(`failed to construct bundle source: ${(e as Error).message}`);
            return sync;
          }
          // Hand the live source back to the host so an external scheduler
          // (Cron Trigger / DO alarm) can drive refresh() where there are no
          // background timers. Best-effort: a throwing attach must not abort
          // sync wiring.
          if (runtimeDeps?.attach) {
            try {
              runtimeDeps.attach(source);
            } catch (e) {
              logger.warn(`runtime-deps attach threw: ${(e as Error).message}`);
            }
          }
          // Hand the source to the service. The service starts it + awaits the
          // first apply LAZILY, on the first `ensureReady()` (driven by the
          // meta-tools / list-tools hook at REQUEST time). The factory must NOT
          // start it or wire its onChange here:
          //   - this factory can run during scope-init (eager provider
          //     instantiation), when `scope.skills` is not yet wired — a
          //     premature apply would throw via the lazy registry proxy;
          //   - on a stateless worker, promise continuations created in this
          //     (scope-init) context are canceled when later awaited from a
          //     request context, and there is no background event loop to finish
          //     a deferred apply. Driving start+apply from inside `ensureReady`
          //     (request context) is what makes the catalog load on workerd.
          // (This replaces the old `setImmediate(source.start())` + fire-and-
          // forget `onChange` apply, which never completed on a stateless worker.)
          sync.attachSource(source);
          // Proactively boot on runtimes WITH a background event loop (Node) so
          // the catalog is ready without an explicit meta-tool call (preserves
          // startup-time sync + skill:// resources). Deferred via setImmediate so
          // scope.skills is wired first. SKIPPED on stateless workers
          // (`disablePolling`): setImmediate never fires there, and a promise
          // created in this scope-init context is canceled when later awaited from
          // a request context — the meta-tools / list-tools hook drive
          // `ensureReady()` in-request instead.
          if (!runtimeDeps?.disablePolling) {
            setImmediate(() => {
              void sync.ensureReady();
            });
          }
          return sync;
        },
      },
    ];
  }
}
