// file: plugins/plugin-skilled-openapi/src/skilled-openapi.plugin.ts

import { BundleStore, createBundleSource } from '@frontmcp/adapters/skills';
import {
  DynamicPlugin,
  FrontMcpLogger,
  Plugin,
  ScopeEntry,
  type ProviderRegistry,
  type ProviderType,
} from '@frontmcp/sdk';

import { MemoryCredentialResolver } from './executor/credential-resolver';
import { HiddenOpRegistry } from './registry/hidden-op.registry';
import { AuthorityGuard } from './security/authority-guard';
import { SkilledOpenApiConfig, SkilledOpenApiCredentialResolver } from './skilled-openapi.symbols';
import {
  skilledOpenApiPluginOptionsSchema,
  type SkilledOpenApiPluginOptions,
  type SkilledOpenApiPluginOptionsInput,
} from './skilled-openapi.types';
import { BundleSyncService } from './sync/bundle-sync.service';
import ExecuteActionTool from './tools/execute-action.tool';
import LoadSkillTool from './tools/load-skill.tool';
import { OperationToolFactory } from './tools/operation-tool.factory';
import SearchSkillTool from './tools/search-skill.tool';

/**
 * `@frontmcp/plugin-skilled-openapi`
 *
 * Consumes signed skill bundles (OpenAPI spec + Overlay) from a configured
 * source (static, npm, or SaaS-pull) and serves them as FrontMCP skills with
 * three meta-tools (`search_skill`, `load_skill`, `execute_action`). Per-op
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
  tools: [SearchSkillTool, LoadSkillTool, ExecuteActionTool],
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

  private warnIfInsecureConfig(): void {
    if (this.options.dev) {
      console.warn(
        '[skilled-openapi] dev=true: signature verification BYPASSED and http:// URLs allowed. NEVER use this in production.',
      );
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
      { name: 'skilled-openapi:bundle-store', provide: BundleStore, useValue: new BundleStore() },
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
          new AuthorityGuard({ logger: scope.logger.child('skilled-openapi:authority') }),
      },
      {
        name: 'skilled-openapi:bundle-sync',
        provide: BundleSyncService,
        inject: () => [ScopeEntry, HiddenOpRegistry, BundleStore],
        useFactory: async (scope: ScopeEntry, hiddenOps: HiddenOpRegistry, bundleStore: BundleStore) => {
          const logger = scope.logger.child('skilled-openapi:sync');
          // Resolve scope.skills lazily — at scope-init time the registry may
          // not be wired yet; reads through the proxy happen later (when the
          // bundle source's first notification arrives or when a meta-tool
          // first calls into BundleSyncService.apply()).
          const lazySkillRegistry = new Proxy({} as never, {
            get(_t, prop: string | symbol) {
              const reg = scope.skills as unknown as Record<string | symbol, unknown> | undefined;
              if (!reg) {
                throw new Error(`[skilled-openapi] scope.skills not available when accessing "${String(prop)}"`);
              }
              const v = reg[prop];
              return typeof v === 'function' ? (v as (...args: unknown[]) => unknown).bind(reg) : v;
            },
          });
          // Build the OperationToolFactory only when the host opted in AND
          // a tool registry is reachable from scope. The factory is wired
          // lazily — like the skill registry above — so scope-init ordering
          // doesn't matter.
          let opToolFactory: OperationToolFactory | undefined;
          if (parsed.exposeOperationsAsInternalTools) {
            try {
              const toolRegistry = scope.tools;
              if (toolRegistry) {
                opToolFactory = new OperationToolFactory({
                  toolRegistry,
                  // ScopeEntry exposes a ProviderRegistryInterface; the factory
                  // needs the concrete ProviderRegistry to construct ToolInstance.
                  // The runtime is the same class — the cast is safe by construction.
                  providers: scope.providers as unknown as ProviderRegistry,
                  logger: logger.child('op-tool'),
                });
              } else {
                logger.warn(
                  'exposeOperationsAsInternalTools=true but scope.tools is unavailable; per-op internal tools disabled',
                );
              }
            } catch (e) {
              logger.warn(
                `failed to build OperationToolFactory: ${(e as Error).message}; per-op internal tools disabled`,
              );
            }
          }

          const sync = new BundleSyncService(
            lazySkillRegistry,
            hiddenOps,
            bundleStore,
            {
              requireSignature: parsed.requireSignature,
              trustedKeys: parsed.trustedKeys,
              exposeOperationsAsInternalTools: parsed.exposeOperationsAsInternalTools,
            },
            logger,
            opToolFactory,
          );
          let source;
          try {
            source = createBundleSource(parsed.source, parsed.bundleCacheDir, logger);
          } catch (e) {
            logger.error(`failed to construct bundle source: ${(e as Error).message}`);
            return sync;
          }
          // BundleSourceListener is invoked synchronously by the source, so any
          // rejection from sync.apply() must be caught here — passing an async
          // arrow directly would surface failures as unhandled promise
          // rejections instead of structured warn/error log lines.
          source.onChange((bundle) => {
            void sync
              .apply(bundle)
              .then((result) => {
                if (!result.applied) {
                  logger.warn(`bundle ${bundle.bundleId}@${bundle.version} not applied: ${result.reason}`);
                }
              })
              .catch((e: unknown) => {
                logger.error(`bundle ${bundle.bundleId}@${bundle.version} apply threw: ${(e as Error).message}`);
              });
          });
          // Defer source.start() to a microtask so scope-init can finish
          // wiring scope.skills before the first bundle apply runs.
          const startedSource = source;
          setImmediate(() => {
            startedSource.start().catch((e: unknown) => {
              logger.error(`bundle source failed to start: ${(e as Error).message}`);
            });
          });
          return sync;
        },
      },
    ];
  }
}
