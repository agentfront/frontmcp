// file: plugins/plugin-skilled-openapi/src/skilled-openapi.plugin.ts

import { DynamicPlugin, FrontMcpLogger, Plugin, ScopeEntry, type ProviderType } from '@frontmcp/sdk';

import { BundleStore } from './bundle/bundle.store';
import { MemoryCredentialResolver } from './executor/credential-resolver';
import { HiddenOpRegistry } from './registry/hidden-op.registry';
import { AuthorityGuard } from './security/authority-guard';
import { SkilledOpenApiConfig, SkilledOpenApiCredentialResolver } from './skilled-openapi.symbols';
import {
  skilledOpenApiPluginOptionsSchema,
  type SkilledOpenApiPluginOptions,
  type SkilledOpenApiPluginOptionsInput,
} from './skilled-openapi.types';
import { createBundleSource } from './sources';
import { BundleSyncService } from './sync/bundle-sync.service';
import ExecuteActionTool from './tools/execute-action.tool';
import LoadSkillTool from './tools/load-skill.tool';
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
      { name: 'skilled-openapi:authority-guard', provide: AuthorityGuard, useValue: new AuthorityGuard() },
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
          const sync = new BundleSyncService(
            lazySkillRegistry,
            hiddenOps,
            bundleStore,
            { requireSignature: parsed.requireSignature, trustedKeys: parsed.trustedKeys },
            logger,
          );
          let source;
          try {
            source = createBundleSource(parsed.source, parsed.bundleCacheDir, logger);
          } catch (e) {
            logger.error(`failed to construct bundle source: ${(e as Error).message}`);
            return sync;
          }
          source.onChange(async (bundle) => {
            const result = await sync.apply(bundle);
            if (!result.applied) {
              logger.warn(`bundle ${bundle.bundleId}@${bundle.version} not applied: ${result.reason}`);
            }
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
