// plugin-registry.ts
import 'reflect-metadata';

import { tokenName, type Ctor, type Token } from '@frontmcp/di';

import AdapterRegistry from '../adapter/adapter.registry';
import {
  FrontMcpLogger,
  isDynamicPluginClass,
  PluginKind,
  type EntryOwnerRef,
  type PluginInstance,
  type PluginRecord,
  type PluginRegistryInterface,
  type PluginType,
  type ProviderEntry,
  type ProviderType,
  type ScopeEntry,
  type ToolType,
} from '../common';
import { initOptionsOf } from '../common/dynamic/dynamic.plugin';
import { collectDynamicProviders, collectDynamicTools, dedupePluginProviders } from '../common/dynamic/dynamic.utils';
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

/** Plugin value instances some registry has installed; a later registry builds its own (#647). */
const installedPluginValues = new WeakSet<object>();

/**
 * Builds a plugin listed as its class (`plugins: [SomePlugin]`, or `{ provide, useClass }`). A plugin
 * configured by options (a `DynamicPlugin`) is built exactly as `SomePlugin.init()` builds it when given
 * none: its constructor, `static dynamicProviders` and `static dynamicTools` all get `{}`, so the
 * class form installs the same providers and tools. Up to 1.9.3 the class form got neither: a plugin
 * whose tools exist only in `dynamicTools` (CodeCall) installed no tools while its hooks still ran,
 * and one whose services come from `dynamicProviders` (Remember, Approval) failed on first use (#803).
 */
function instantiateClassPlugin(
  klass: Ctor<PluginInstance>,
  depsInstances: unknown[],
  recordProviders: ProviderType[] | undefined,
): { pluginInstance: PluginInstance; dynamicProviders: ProviderType[] | undefined; dynamicTools: readonly ToolType[] } {
  if (!isConfiguredByOptions(klass)) {
    return { pluginInstance: new klass(...depsInstances), dynamicProviders: recordProviders, dynamicTools: [] };
  }
  // The order `init()` uses, so a plugin that needs options (`FeatureFlagPlugin`'s `adapter`) fails at
  // startup with its own configuration error.
  const options = {};
  const optionDerived = collectDynamicProviders(klass, options);
  const dynamicTools = collectDynamicTools(klass, options);
  return {
    pluginInstance: new klass(options),
    dynamicProviders:
      optionDerived.length > 0
        ? dedupePluginProviders([...optionDerived, ...(recordProviders ?? [])])
        : recordProviders,
    dynamicTools,
  };
}

/**
 * Whether a plugin class takes options: a `DynamicPlugin`, or a class with its static option hooks
 * (read off the class, so a plugin built against another copy of the SDK is recognised too).
 */
function isConfiguredByOptions(klass: Ctor<PluginInstance>): boolean {
  if (isDynamicPluginClass(klass)) return true;
  const hooks = klass as { dynamicProviders?: unknown; dynamicTools?: unknown };
  return typeof hooks.dynamicProviders === 'function' || typeof hooks.dynamicTools === 'function';
}

export default class PluginRegistry
  extends RegistryAbstract<PluginInstance, PluginRecord, PluginType[]>
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

  getPlugins(): PluginInstance[] {
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

      // Registered before nested plugins so they can inject the providers this plugin derives from its options.
      const { pluginInstance, dynamicProviders, dynamicTools } = await this.instantiatePlugin(rec, deps);
      if (dynamicProviders) {
        await providers.addDynamicProviders(dynamicProviders);
      }
      // Collected after the option-derived providers join and before nested plugins copy in their own hooked exports.
      const providerHooks = normalizeHooksFromProviders(providers);

      // Create a plugin-specific owner (NOT the parent's owner)
      // This ensures plugin tools have kind='plugin' for proper filtering in adoption
      const pluginOwner = {
        kind: 'plugin' as const,
        id: rec.metadata.name,
        ref: token,
      };

      // Nested plugins' hooks belong to the app, agent or scope that installed this plugin, not to the plugin.
      const nestedHookOwner =
        this.owner?.kind === 'app' || this.owner?.kind === 'agent' || this.owner?.kind === 'scope'
          ? this.owner
          : pluginOwner;
      const plugins = new PluginRegistry(providers, rec.metadata.plugins ?? [], nestedHookOwner, this.scopeInfo);
      await plugins.ready;

      const adapters = new AdapterRegistry(providers, rec.metadata.adapters ?? []);
      await adapters.ready;
      if (adapters.getAdapters().length > 0) this.scope.onDispose(() => adapters.dispose());

      const tools = new ToolRegistry(providers, [...(rec.metadata.tools ?? []), ...dynamicTools], pluginOwner);
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
        let hookOwner = this.owner;
        if (pluginScope === 'server' && this.scopeInfo?.parentScope) {
          targetHookScope = this.scopeInfo.parentScope;
          // Owned by the plugin, not the app that installed it, so they run for every app's entries.
          hookOwner = pluginOwner;
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
            owner: hookOwner,
          },
        }));
        // Register hooks to the determined target scope
        await targetHookScope.hooks.registerHooks(false, ...hooksWithOwner);
      }

      const getFromPluginProviders = providers.get.bind(providers);
      pluginInstance.get = getFromPluginProviders;
      // A `Plugin.init()` record outlives the server: leave no reference to this one on its instance.
      this.scope.onDispose(() => {
        if (pluginInstance.get === getFromPluginProviders) Reflect.deleteProperty(pluginInstance, 'get');
      });

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
        // A plugin installed below the scope (on an app or agent) keeps the copy out of reach of
        // the scope's other apps: only its own subtree resolves it (#678).
        const scopeProviders = this.scope.providers;
        if (scopeProviders !== this.providers && scopeProviders instanceof ProviderRegistry) {
          const installedOnScope = !this.owner || this.owner.kind === 'scope';
          const visibleBelow = installedOnScope
            ? undefined
            : (this.providers.subtreeBelow(scopeProviders) ?? this.providers);
          scopeProviders.mergeFromRegistry(providers, exported, visibleBelow);
        }
      }
      this.instances.set(token, pluginInstance);
      this.logger?.verbose(
        `PluginRegistry: registered plugin '${rec.metadata.name}' (${hooks.length} hook(s), ${contextExtensions?.length ?? 0} context extension(s))`,
      );
    }
  }

  /**
   * Builds the plugin instance and the providers it contributes; a factory's options exist only once
   * it has run, so the providers and tools a plugin derives from them are collected here (#678).
   * `init(options)` records already carry theirs (`dynamicTools` is then empty). A plugin listed as
   * its class gets the ones its default options give (#803).
   */
  private async instantiatePlugin(
    rec: PluginRecord,
    deps: Set<Token>,
  ): Promise<{
    pluginInstance: PluginInstance;
    dynamicProviders: ProviderType[] | undefined;
    dynamicTools: readonly ToolType[];
  }> {
    const depsInstances = await Promise.all([...deps].map((t) => this.providers.resolveBootstrapDep(t)));

    switch (rec.kind) {
      case PluginKind.CLASS:
        return instantiateClassPlugin(rec.useClass as Ctor<PluginInstance>, depsInstances, rec.providers);
      case PluginKind.CLASS_TOKEN:
        return instantiateClassPlugin(rec.provide as Ctor<PluginInstance>, depsInstances, rec.providers);
      case PluginKind.VALUE: {
        // One `SomePlugin.init(options)` record can be installed by several registries (an app class
        // used by two servers). The first keeps the configured instance; each later one builds its own
        // from the same options, so `get`, fields (ES `#private` ones too) and state belong to that
        // registry, not to whichever installed the record last (#647). A hand-written value record
        // names its instance, so it stays that instance everywhere.
        const value = rec.useValue as PluginInstance;
        const init = installedPluginValues.has(value) ? initOptionsOf(value) : undefined;
        installedPluginValues.add(value);
        if (init && isDynamicPluginClass(rec.provide)) {
          return {
            pluginInstance: new rec.provide(init.options) as PluginInstance,
            dynamicProviders: rec.providers,
            dynamicTools: [],
          };
        }
        return { pluginInstance: value, dynamicProviders: rec.providers, dynamicTools: [] };
      }
      case PluginKind.FACTORY: {
        const args: unknown[] = [];
        for (const d of rec.inject()) args.push(await this.providers.resolveBootstrapDep(d));
        const produced: unknown = await rec.useFactory(...args);
        // DynamicPlugin.init({ useFactory }) factories return options; a hand-written factory may return the instance.
        if (isDynamicPluginClass(rec.provide) && !(produced instanceof rec.provide)) {
          const optionDerived = collectDynamicProviders(rec.provide, produced);
          return {
            pluginInstance: new rec.provide(produced) as PluginInstance,
            dynamicProviders:
              optionDerived.length > 0
                ? dedupePluginProviders([...optionDerived, ...(rec.providers ?? [])])
                : rec.providers,
            // `static dynamicTools` reads the options the factory returned, as `init(options)` reads its own.
            dynamicTools: collectDynamicTools(rec.provide, produced),
          };
        }
        return { pluginInstance: produced as PluginInstance, dynamicProviders: rec.providers, dynamicTools: [] };
      }
      default:
        throw new InvalidRegistryKindError('plugin', (rec as { kind?: string }).kind);
    }
  }
}
