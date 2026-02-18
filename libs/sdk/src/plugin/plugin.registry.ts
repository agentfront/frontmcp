// plugin-registry.ts
import 'reflect-metadata';
import { Token, tokenName, Ctor } from '@frontmcp/di';
import {
  EntryOwnerRef,
  PluginEntry,
  PluginKind,
  PluginRecord,
  PluginRegistryInterface,
  PluginType,
  ProviderEntry,
} from '../common';
import { normalizePlugin, pluginDiscoveryDeps } from './plugin.utils';
import ProviderRegistry from '../provider/provider.registry';
import AdapterRegistry from '../adapter/adapter.registry';
import ToolRegistry from '../tool/tool.registry';
import ResourceRegistry from '../resource/resource.registry';
import PromptRegistry from '../prompt/prompt.registry';
import SkillRegistry from '../skill/skill.registry';
import { normalizeProvider } from '../provider/provider.utils';
import { RegistryAbstract, RegistryBuildMapResult } from '../regsitry';
import { Scope } from '../scope';
import { normalizeHooksFromCls } from '../hooks/hooks.utils';
import { InvalidPluginScopeError, RegistryDependencyNotRegisteredError, InvalidRegistryKindError } from '../errors';
import { installContextExtensions } from '../context';

/**
 * Scope information for plugin hook registration.
 * Used to determine where plugin hooks should be registered based on
 * the plugin's scope setting and whether the app is standalone.
 */
export interface PluginScopeInfo {
  /** The scope where the plugin is defined (app's own scope) */
  ownScope: Scope;
  /** Parent scope for non-standalone apps (gateway scope) */
  parentScope?: Scope;
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

  private readonly scope: Scope;
  private readonly scopeInfo?: PluginScopeInfo;
  private readonly owner?: EntryOwnerRef;

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
  }

  getPlugins(): PluginEntry[] {
    return [...this.instances.values()];
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
      const rec = this.defs.get(token)!;
      const deps = pluginDiscoveryDeps(rec);

      for (const d of deps) {
        if (!this.providers.get(d)) {
          throw new RegistryDependencyNotRegisteredError('Plugin', tokenName(token), tokenName(d));
        }
        this.graph.get(token)!.add(d);
      }
    }
  }

  protected async initialize() {
    for (const token of this.tokens) {
      const rec = this.defs.get(token)!;
      const deps = this.graph.get(token)!;

      const providers = new ProviderRegistry(rec.metadata.providers ?? [], this.providers);
      await providers.ready;

      // Create a plugin-specific owner (NOT the parent's owner)
      // This ensures plugin tools have kind='plugin' for proper filtering in adoption
      const pluginOwner = {
        kind: 'plugin' as const,
        id: rec.metadata.name,
        ref: token,
      };

      // Pass scopeInfo to nested plugins to ensure scope validation is consistent
      // throughout the plugin hierarchy
      const plugins = new PluginRegistry(providers, rec.metadata.plugins ?? [], pluginOwner, this.scopeInfo);
      await plugins.ready;

      const adapters = new AdapterRegistry(providers, rec.metadata.adapters ?? []);
      await adapters.ready;

      const tools = new ToolRegistry(providers, rec.metadata.tools ?? [], pluginOwner);
      const allResources = [...(rec.metadata.resources ?? []), ...(rec.resources ?? [])];
      const resources = new ResourceRegistry(providers, allResources, pluginOwner);
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

      const depsTokens = [...deps];
      const depsInstances = await Promise.all(depsTokens.map((t) => this.providers.resolveBootstrapDep(t)));

      let pluginInstance: PluginEntry;
      if (rec.kind === PluginKind.CLASS) {
        const klass = rec.useClass as any;
        pluginInstance = new klass(...depsInstances);
      } else if (rec.kind === PluginKind.CLASS_TOKEN) {
        const klass = rec.provide as any;
        pluginInstance = new (klass as Ctor<any>)(...depsInstances);
      } else if (rec.kind === PluginKind.FACTORY) {
        const deps = [...rec.inject()];
        const args: any[] = [];
        for (const d of deps) args.push(await this.providers.resolveBootstrapDep(d));
        pluginInstance = rec.useFactory(...args);
      } else if (rec.kind === PluginKind.VALUE) {
        pluginInstance = (rec as any).useValue;
      } else {
        throw new InvalidRegistryKindError('plugin', (rec as { kind?: string }).kind);
      }

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

      const hooks = normalizeHooksFromCls(pluginInstance);
      if (hooks.length > 0) {
        // Determine which scope to use for hook registration:
        // - scope='app' (default): register hooks to own scope (app-level)
        // - scope='server': register hooks to parent scope (gateway-level) if available
        let targetHookScope: Scope;
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

      const dynamicProviders = rec.providers;
      if (dynamicProviders) {
        await providers.addDynamicProviders(dynamicProviders);

        // Register dynamic provider DEFINITIONS in both:
        // 1. The parent registry (this.providers) - for tool/resource/prompt creation
        // 2. The scope's registry (this.scope.providers) - for flow buildViews() resolution
        //
        // This is necessary because:
        // - Tools/resources/prompts resolve providers from the app's provider hierarchy
        // - Flows use scope.providers.buildViews() to build context-scoped providers
        // - App providers (this.providers) are a CHILD of scope providers, not a parent
        // - So we need to merge to both to ensure providers are found in both paths
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
    }
  }
}
