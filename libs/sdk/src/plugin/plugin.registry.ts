// plugin-registry.ts
import 'reflect-metadata';
import {
  FlowName,
  PluginEntry,
  PluginKind,
  PluginRecord,
  PluginRegistryInterface,
  PluginType,
  Token,
} from '../common';
import {normalizePlugin, pluginDiscoveryDeps} from './plugin.utils';
import ProviderRegistry from '../provider/provider.registry';
import {tokenName} from '../utils/token.utils';
import AdapterRegistry from '../adapter/adapter.regsitry';
import ToolRegistry from '../tool/tool.registry';
import ResourceRegistry from '../resource/resource.registry';
import PromptRegistry from '../prompt/prompt.registry';
import {Ctor} from '../types/token.types';
import {normalizeProvider} from '../provider/provider.utils';
import {RegistryAbstract, RegistryBuildMapResult} from '../regsitry';
import {Scope} from "../scope";
import {normalizeHooksFromCls} from "../hooks/hooks.utils";

export default class PluginRegistry extends RegistryAbstract<PluginEntry, PluginRecord, PluginType[]> implements PluginRegistryInterface {
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

  private readonly scope: Scope

  constructor(providers: ProviderRegistry, list: PluginType[]) {
    super('PluginRegistry', providers, list);
    this.scope = providers.getActiveScope();
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

    return {tokens, defs, graph};
  }

  protected buildGraph() {
    for (const token of this.tokens) {
      const rec = this.defs.get(token)!;
      const deps = pluginDiscoveryDeps(rec);

      for (const d of deps) {
        if (!this.providers.get(d)) {
          throw new Error(`Adapter ${tokenName(token)} depends on ${tokenName(d)}, which is not registered.`);
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

      const plugins = new PluginRegistry(providers, rec.metadata.plugins ?? []);
      await plugins.ready;

      const adapters = new AdapterRegistry(providers, rec.metadata.adapters ?? []);
      await adapters.ready;

      const tools = new ToolRegistry(providers, rec.metadata.tools ?? [], {
        kind: 'plugin',
        id: rec.metadata.name,
        ref: token,
      });
      const resources = new ResourceRegistry(providers, rec.metadata.resources ?? []);
      const prompts = new PromptRegistry(providers, rec.metadata.prompts ?? []);

      await Promise.all([
        tools.ready,
        resources.ready,
        prompts.ready,
      ]);

      this.pProviders.set(token, providers);
      this.pPlugins.set(token, plugins);
      this.pAdapters.set(token, adapters);
      this.pTools.set(token, tools);
      this.pResources.set(token, resources);
      this.pPrompts.set(token, prompts);

      /**
       * Register exported providers to the parent providers registry.
       */
      const exported = (rec.metadata.exports ?? []).map(rawToken => {
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
        throw Error('Invalid plugin kind');
      }

      const hooks = normalizeHooksFromCls(pluginInstance);
      if (hooks.length > 0) {
        await this.scope.hooks.registerHooks(false, ...hooks);
      }
      pluginInstance.get = providers.get.bind(providers) as any;
      let dynamicProviders = rec.providers;
      if (dynamicProviders) {
        await providers.addDynamicProviders(dynamicProviders)
      }
      this.instances.set(token, pluginInstance);
    }
  }


}
