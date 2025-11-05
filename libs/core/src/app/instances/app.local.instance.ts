import {AppEntry, AppRecord, LocalAppMetadata} from '@frontmcp/sdk';
import {idFromString} from '../../utils/string.utils';
import ProviderRegistry from '../../provider/provider.registry';
import ToolRegistry from '../../tool/tool.registry';
import ResourceRegistry from '../../resource/resource.registry';
import PromptRegistry from '../../prompt/prompt.registry';
import AdapterRegistry from '../../adapter/adapter.regsitry';
import PluginRegistry from '../../plugin/plugin.registry';

export class AppLocalInstance extends AppEntry {
  override readonly metadata: LocalAppMetadata;
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

    this.appPlugins = new PluginRegistry(this.appProviders, this.metadata.plugins ?? []);
    await this.appPlugins.ready; // wait for plugins and it's providers/adapters/tools/resource/prompts to be ready

    this.appAdapters = new AdapterRegistry(this.appProviders, this.metadata.adapters ?? []);
    await this.appAdapters.ready;

    this.appTools = new ToolRegistry(this.appProviders, this.metadata.tools ?? [], {
      kind: 'app',
      id: this.id,
      ref: this.token,
    });
    this.appResources = new ResourceRegistry(this.appProviders, this.metadata.resources ?? []);
    this.appPrompts = new PromptRegistry(this.appProviders, this.metadata.prompts ?? []);

    await Promise.all([
      this.appTools.ready,
      this.appResources.ready,
      this.appPrompts.ready,
    ]);

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