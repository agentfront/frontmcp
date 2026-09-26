// plugin-registry.ts
import 'reflect-metadata';

import { tokenName, type Ctor, type Token } from '@frontmcp/di';

import AdapterRegistry from '../adapter/adapter.registry';
import {
  FrontMcpLogger,
  isDynamicPluginClass,
  PluginKind,
  type EntryOwnerRef,
  type PluginEntry,
  type PluginRecord,
  type PluginRegistryInterface,
  type PluginType,
  type ProviderEntry,
  type ProviderType,
  type ScopeEntry,
} from '../common';
import { collectDynamicProviders, dedupePluginProviders } from '../common/dynamic/dynamic.utils';
import { installContextExtensions } from '../context/context-extension';
import { InvalidPluginScopeError, InvalidRegistryKindError, RegistryDependencyNotRegisteredError } from '../errors';
import { normalizeHooksFromCls, normalizeHooksFromProviders } from '../hooks/hooks.utils';
import PromptRegistry from '../prompt/prompt.registry';
import ProviderRegistry from '../provider/provider.registry';
import { normalizeProvider } from '../provider/provider.utils';
import { RegistryAbstract, type RegistryBuildMapResult } from '../regsitry';
import ResourceRegistry from '../resource/resource.registry';
import SkillRegistry from '../skill/skill.registry';
import ToolRegistry from '../tool/tool.registry';
import { normalizePlugin, pluginDiscoveryDeps } from './plugin.utils';

/**
 * Scope information for plugin hook registration.
 * Used to determine where plugin hooks should be registered based on
 * the plugin's scope setting and whether the app is standalone.
 */
export interface PluginScopeInfo {
  /** The scope where the plugin is defined (app's own scope) */
  ownScope: ScopeEntry;
  /** Parent scope for non-standalone apps (gateway scope) */
  parentScope?: ScopeEntry;
  /** Whether the app is standalone (standalone: true) */
  isStandaloneApp: boolean;
}

export default class PluginRegistry
  extends RegistryAbstract<PluginEntry, PluginRecord, PluginType[]>
  implements PluginRegistryInterface
{
  /** providers by token */
  private readonly pProviders: Map<Token, ProviderRegistry> = new Map();
  /** providers by token */
  private readonly pPlugins: Map<Token, PluginRegistry> = new Map();
  /** adapters by token */
  private readonly pAdapters: Map<Token, AdapterRegistry> = new Map();
  /** tools by token */
  private readonly pTools: Map<Token, ToolRegistry> = new Map();
  /** resources by token */
  private readonly pResources: Map<Token, ResourceRegistry> = new Map();
  /** prompts by token */
  private readonly pPrompts: Map<Token, PromptRegistry> = new Map();
  /** skills by token */
  private readonly pSkills: Map<Token, SkillRegistry> = new Map();

  private readonly scope: ScopeEntry;
  private readonly scopeInfo?: PluginScopeInfo;
  private readonly owner?: EntryOwnerRef;
  private readonly logger?: FrontMcpLogger;

  constructor(
    providers: ProviderRegistry,
    list: PluginType[],
    owner?: EntryOwnerRef,
    /**
     * Scope information for hook registration. Determines where plugin hooks
     * are registered based on the plugin's scope setting ('app' or 'server').
     * - scope='app' (default): hooks register to ownScope
     * - scope='server': hooks register to parentScope (if available)
     */
    scopeInfo?: PluginScopeInfo,
  ) {
    super('PluginRegistry', providers, list);
    this.scope = providers.getActiveScope();
    this.scopeInfo = scopeInfo;
    this.owner = owner;
    try {
      this.logger = providers.get(FrontMcpLogger)?.child('PluginRegistry');
    } catch {
      // Logger provider not available — proceed without logging
    }
  }

  getPlugins(): PluginEntry[] {
    return [...this.instances.values()];
  }

  /**
   * Returns the names of all registered plugins from their definition records.
   * Unlike getPlugins().map(p => p.metadata.name), this is safe because
   * raw plugin instances (e.g. DynamicPlugin subclasses) may not carry a .metadata property.
   */
  getPluginNames(): string[] {
    return [...this.defs.values()].map((rec) => rec.metadata.name);
  }

  /**
   * Returns all ToolRegistries created by plugins in this registry.
   * Used for propagating server-level plugin tools to the scope.
   */
  getToolRegistries(): ToolRegistry[] {
    return [...this.pTools.values()];
  }

  protected override buildMap(list: PluginType[]): RegistryBuildMapResult<PluginRecord> {
    const tokens = new Set<Token>();
    const defs = new Map<Token, PluginRecord>();
    const graph = new Map<Token, Set<Token>>();

    for (const raw of list) {
      const rec = normalizePlugin(raw);
      const provide = rec.provide;
      tokens.add(provide);
      defs.set(provide, rec);
      graph.set(provide, new Set());
    }

    return { tokens, defs, graph };
  }

  protected buildGraph() {
    for (const token of this.tokens) {
      const rec = this.defs.get(token);
      if (!rec) throw new RegistryDependencyNotRegisteredError('Plugin', tokenName(token), 'self');
      const deps = pluginDiscoveryDeps(rec);

      for (const d of deps) {
        if (!this.providers.get(d)) {
          throw new RegistryDependencyNotRegisteredError('Plugin', tokenName(token), tokenName(d));
        }
        const edges = this.graph.get(token);
        if (edges) edges.add(d);
      }
    }
  }

  protected async initialize() {
    this.logger?.verbose(`PluginRegistry: initializing ${this.tokens.size} plugin(s)`);
    for (const token of this.tokens) {
      const rec = this.defs.get(token);
      if (!rec) continue;
      const deps = this.graph.get(token) ?? new Set<Token>();

      const providers = new ProviderRegistry(rec.metadata.providers ?? [], this.providers);
      await providers.ready;
      // Collected before nested plugins copy their exports in, since those register their own hooks.
      const providerHooks = normalizeHooksFromProviders(providers);

      // Registered before nested plugins so they can inject the providers this plugin derives from its options.
      const { pluginInstance, dynamicProviders } = await this.instantiatePlugin(rec, deps);
      if (dynamicProviders) {
        await providers.addDynamicProviders(dynamicProviders);
      }

      // Create a plugin-specific owner (NOT the parent's owner)
      // This ensures plugin tools have kind='plugin' for proper filtering in adoption
      const pluginOwner = {
        kind: 'plugin' as const,
        id: rec.metadata.name,
        ref: token,
      };

      // Nested plugins' hooks belong to the app or scope that installed this plugin, not to the plugin.
      const nestedHookOwner = this.owner?.kind === 'app' || this.owner?.kind === 'scope' ? this.owner : pluginOwner;
      const plugins = new PluginRegistry(providers, rec.metadata.plugins ?? [], nestedHookOwner, this.scopeInfo);
      await plugins.ready;

      const adapters = new AdapterRegistry(providers, rec.metadata.adapters ?? []);
      await adapters.ready;

      const tools = new ToolRegistry(providers, rec.metadata.tools ?? [], pluginOwner);
      const resources = new ResourceRegistry(providers, rec.metadata.resources ?? [], pluginOwner);
      const prompts = new PromptRegistry(providers, rec.metadata.prompts ?? [], pluginOwner);
      const skills = new SkillRegistry(providers, rec.metadata.skills ?? [], pluginOwner);

      await Promise.all([tools.ready, resources.ready, prompts.ready, skills.ready]);

      // Register plugin registries with parent provider registry (app's providers)
      // This makes plugin tools discoverable during app's ToolRegistry adoption (Path 2)
      // Note: We don't add to scope-level providers to maintain app isolation
      this.providers.addRegistry('ToolRegistry', tools);
      this.providers.addRegistry('ResourceRegistry', resources);
      this.providers.addRegistry('PromptRegistry', prompts);
      this.providers.addRegistry('SkillRegistry', skills);

      this.pProviders.set(token, providers);
      this.pPlugins.set(token, plugins);
      this.pAdapters.set(token, adapters);
      this.pTools.set(token, tools);
      this.pResources.set(token, resources);
      this.pPrompts.set(token, prompts);
      this.pSkills.set(token, skills);

      /**
       * Register exported providers to the parent providers registry.
       */
      const exported = (rec.metadata.exports ?? []).map((rawToken) => {
        const token = normalizeProvider(rawToken);
        return providers.getProviderInfo(token.provide);
      });
      this.providers.mergeFromRegistry(providers, exported);

      // Determine the plugin's scope setting (defaults to 'app')
      const pluginScope = rec.metadata.scope ?? 'app';

      // Validate: standalone apps cannot have server-scoped plugins
      // This validation runs regardless of whether the plugin has hooks,
      // to catch configuration errors early
      if (this.scopeInfo?.isStandaloneApp && pluginScope === 'server') {
        throw new InvalidPluginScopeError(
          `Plugin "${rec.metadata.name}" has scope='server' but is used in a standalone app. ` +
            `Server-scoped plugins can only be used in non-standalone apps.`,
        );
      }

      const hooks = [...normalizeHooksFromCls(pluginInstance), ...providerHooks];
      if (hooks.length > 0) {
        // Determine which scope to use for hook registration:
        // - scope='app' (default): register hooks to own scope (app-level)
        // - scope='server': register hooks to parent scope (gateway-level) if available
        let targetHookScope: ScopeEntry;
        if (pluginScope === 'server' && this.scopeInfo?.parentScope) {
          targetHookScope = this.scopeInfo.parentScope;
        } else {
          targetHookScope = this.scope;
          // Warn if server scope was requested but no parent scope is available
          if (pluginScope === 'server' && !this.scopeInfo?.parentScope) {
            this.scope.logger.warn(
              `Plugin "${rec.metadata.name}" has scope='server' but no parent scope is available. ` +
                `Hooks will be registered to the current scope instead. ` +
                `This may happen for server-level plugins or standalone apps.`,
            );
          }
        }

        // Add owner information to each hook before registering
        const hooksWithOwner = hooks.map((hook) => ({
          ...hook,
          metadata: {
            ...hook.metadata,
            owner: this.owner,
          },
        }));
        // Register hooks to the determined target scope
        await targetHookScope.hooks.registerHooks(false, ...hooksWithOwner);
      }

      pluginInstance.get = providers.get.bind(providers) as any;

      // Install context extensions declared by the plugin
      // This adds properties like `this.remember` to ExecutionContextBase
      const contextExtensions = rec.metadata.contextExtensions;
      if (contextExtensions && contextExtensions.length > 0) {
        installContextExtensions(rec.metadata.name, contextExtensions);
      }

      if (dynamicProviders) {
        // Register dynamic provider DEFINITIONS in both:
        // 1. The parent registry (this.providers) - for tool/resource/prompt creation
        // 2. The scope's registry (this.scope.providers) - for flow buildViews() resolution
        //
        // This is necessary because:
        // - Tools/resources/prompts resolve providers from the app's provider hierarchy
        // - Flows use scope.providers.buildViews() to build context-scoped providers
        // - App providers (this.providers) are a CHILD of scope providers, not a parent
        // - So we need to merge to both to ensure providers are found in both paths
        // The scope copy is whichever app merged last; entries build their own hierarchy's definition instead.
        const normalized = dynamicProviders.map((p) => normalizeProvider(p));
        const singletons = providers.getAllSingletons();
        const exported = normalized.map((def) => ({
          token: def.provide,
          def,
          // For CONTEXT-scoped providers, instance may not exist yet (built per-request).
          // mergeFromRegistry only uses instance for GLOBAL-scoped providers.
          // The singletons map stores ProviderEntry values, so this cast is safe.
          instance: singletons.get(def.provide) as ProviderEntry | undefined,
        }));

        // Merge to app's registry (for tool context creation)
        this.providers.mergeFromRegistry(providers, exported);

        // Also merge to scope's registry (for flow buildViews to find them)
        // This enables CONTEXT-scoped providers from plugins to be built during flows.
        // The scope.providers is a ProviderRegistryInterface but the actual implementation
        // is ProviderRegistry which has mergeFromRegistry. We check at runtime to be safe.
        const scopeProviders = this.scope.providers;
        if (
          scopeProviders !== this.providers &&
          'mergeFromRegistry' in scopeProviders &&
          typeof (scopeProviders as ProviderRegistry).mergeFromRegistry === 'function'
        ) {
          (scopeProviders as ProviderRegistry).mergeFromRegistry(providers, exported);
        }
      }
      this.instances.set(token, pluginInstance);
      this.logger?.verbose(
        `PluginRegistry: registered plugin '${rec.metadata.name}' (${hooks.length} hook(s), ${contextExtensions?.length ?? 0} context extension(s))`,
      );
    }
  }

  /** Builds the plugin instance and the providers it contributes; a factory's options exist only once it has run. */
  private async instantiatePlugin(
    rec: PluginRecord,
    deps: Set<Token>,
  ): Promise<{ pluginInstance: PluginEntry; dynamicProviders: ProviderType[] | undefined }> {
    const depsInstances = await Promise.all([...deps].map((t) => this.providers.resolveBootstrapDep(t)));

    switch (rec.kind) {
      case PluginKind.CLASS:
        return {
          pluginInstance: new (rec.useClass as Ctor<PluginEntry>)(...depsInstances),
          dynamicProviders: rec.providers,
        };
      case PluginKind.CLASS_TOKEN:
        return {
          pluginInstance: new (rec.provide as Ctor<PluginEntry>)(...depsInstances),
          dynamicProviders: rec.providers,
        };
      case PluginKind.VALUE:
        return { pluginInstance: rec.useValue as PluginEntry, dynamicProviders: rec.providers };
      case PluginKind.FACTORY: {
        const args: unknown[] = [];
        for (const d of rec.inject()) args.push(await this.providers.resolveBootstrapDep(d));
        const produced: unknown = rec.useFactory(...args);
        // DynamicPlugin.init({ useFactory }) factories return options; a hand-written factory may return the instance.
        if (isDynamicPluginClass(rec.provide) && !(produced instanceof rec.provide)) {
          const optionDerived = collectDynamicProviders(rec.provide, produced);
          return {
            pluginInstance: new rec.provide(produced) as PluginEntry,
            dynamicProviders:
              optionDerived.length > 0
                ? dedupePluginProviders([...optionDerived, ...(rec.providers ?? [])])
                : rec.providers,
          };
        }
        return { pluginInstance: produced as PluginEntry, dynamicProviders: rec.providers };
      }
      default:
        throw new InvalidRegistryKindError('plugin', (rec as { kind?: string }).kind);
    }
  }
}
