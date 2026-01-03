import { AppEntry, AppRecord, LocalAppMetadata } from '../../common';
import { idFromString } from '../../utils/string.utils';
import ProviderRegistry from '../../provider/provider.registry';
import ToolRegistry from '../../tool/tool.registry';
import ResourceRegistry from '../../resource/resource.registry';
import PromptRegistry from '../../prompt/prompt.registry';
import AdapterRegistry from '../../adapter/adapter.regsitry';
import PluginRegistry, { PluginScopeInfo } from '../../plugin/plugin.registry';
import AgentRegistry from '../../agent/agent.registry';

export class AppLocalInstance extends AppEntry<LocalAppMetadata> {
  override readonly id: string;

  private scopeProviders: ProviderRegistry;
  private appProviders: ProviderRegistry;
  private appPlugins: PluginRegistry;
  private appAdapters: AdapterRegistry;
  private appTools: ToolRegistry;
  private appResources: ResourceRegistry;
  private appPrompts: PromptRegistry;
  private appAgents: AgentRegistry;

  constructor(record: AppRecord, scopeProviders: ProviderRegistry) {
    super(record);
    this.scopeProviders = scopeProviders;
    this.id = this.metadata.id ?? idFromString(this.metadata.name);
    this.ready = this.initialize();
  }

  protected async initialize() {
    this.appProviders = new ProviderRegistry(this.metadata.providers ?? [], this.scopeProviders);
    await this.appProviders.ready; // wait for providers to be ready
    // this.authProviders = new AuthRegistry(this.providers, this.metadata.authProviders ?? []);
    // await this.authProviders.ready; // wait for providers to be ready

    const appOwner = {
      kind: 'app' as const,
      id: this.id,
      ref: this.token,
    };

    // Build scope info for plugin hook registration
    // This determines where plugin hooks are registered based on plugin's scope setting:
    // - scope='app' (default): hooks register to app's own scope
    // - scope='server': hooks register to parent scope (gateway-level)
    //
    // Note: When standalone is undefined, we treat it as standalone (true) for safety.
    // This ensures server-scoped plugins require explicit `standalone: false` to access parent scope.
    const isStandalone = this.metadata.standalone !== false;
    const scopeInfo: PluginScopeInfo = {
      ownScope: this.appProviders.getActiveScope(),
      parentScope: !isStandalone ? this.scopeProviders.getActiveScope() : undefined,
      isStandaloneApp: isStandalone,
    };
    this.appPlugins = new PluginRegistry(this.appProviders, this.metadata.plugins ?? [], appOwner, scopeInfo);
    await this.appPlugins.ready; // wait for plugins and it's providers/adapters/tools/resource/prompts to be ready

    this.appAdapters = new AdapterRegistry(this.appProviders, this.metadata.adapters ?? []);
    await this.appAdapters.ready;

    this.appTools = new ToolRegistry(this.appProviders, this.metadata.tools ?? [], appOwner);
    this.appResources = new ResourceRegistry(this.appProviders, this.metadata.resources ?? [], appOwner);
    this.appPrompts = new PromptRegistry(this.appProviders, this.metadata.prompts ?? [], appOwner);
    this.appAgents = new AgentRegistry(this.appProviders, this.metadata.agents ?? [], appOwner);

    await Promise.all([this.appTools.ready, this.appResources.ready, this.appPrompts.ready, this.appAgents.ready]);
  }

  get providers(): Readonly<ProviderRegistry> {
    return this.appProviders;
  }

  get adapters(): Readonly<AdapterRegistry> {
    return this.appAdapters;
  }

  get plugins(): Readonly<PluginRegistry> {
    return this.appPlugins;
  }

  get tools(): Readonly<ToolRegistry> {
    return this.appTools;
  }

  get resources(): Readonly<ResourceRegistry> {
    return this.appResources;
  }

  get prompts(): Readonly<PromptRegistry> {
    return this.appPrompts;
  }

  get agents(): Readonly<AgentRegistry> {
    return this.appAgents;
  }
}
