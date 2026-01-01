import { AppEntry, AppRecord, LocalAppMetadata } from '../../common';
import { idFromString } from '../../utils/string.utils';
import ProviderRegistry from '../../provider/provider.registry';
import ToolRegistry from '../../tool/tool.registry';
import ResourceRegistry from '../../resource/resource.registry';
import PromptRegistry from '../../prompt/prompt.registry';
import AdapterRegistry from '../../adapter/adapter.regsitry';
import PluginRegistry from '../../plugin/plugin.registry';

export class AppLocalInstance extends AppEntry<LocalAppMetadata> {
  override readonly id: string;

  private scopeProviders: ProviderRegistry;
  private appProviders: ProviderRegistry;
  private appPlugins: PluginRegistry;
  private appAdapters: AdapterRegistry;
  private appTools: ToolRegistry;
  private appResources: ResourceRegistry;
  private appPrompts: PromptRegistry;

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

    // When app is not standalone, pass parent scope for hook registration
    // This allows HTTP hooks from app plugins to be triggered at the gateway level
    const hookScope = this.metadata.standalone === false ? this.scopeProviders.getActiveScope() : undefined;
    this.appPlugins = new PluginRegistry(this.appProviders, this.metadata.plugins ?? [], appOwner, hookScope);
    await this.appPlugins.ready; // wait for plugins and it's providers/adapters/tools/resource/prompts to be ready

    this.appAdapters = new AdapterRegistry(this.appProviders, this.metadata.adapters ?? []);
    await this.appAdapters.ready;

    this.appTools = new ToolRegistry(this.appProviders, this.metadata.tools ?? [], appOwner);
    this.appResources = new ResourceRegistry(this.appProviders, this.metadata.resources ?? [], appOwner);
    this.appPrompts = new PromptRegistry(this.appProviders, this.metadata.prompts ?? [], appOwner);

    await Promise.all([this.appTools.ready, this.appResources.ready, this.appPrompts.ready]);
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
}
