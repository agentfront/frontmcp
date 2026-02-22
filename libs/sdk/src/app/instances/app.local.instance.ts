import { AppEntry, AppRecord, FrontMcpLogger, LocalAppMetadata } from '../../common';
import { idFromString } from '@frontmcp/utils';
import ProviderRegistry from '../../provider/provider.registry';
import ToolRegistry from '../../tool/tool.registry';
import ResourceRegistry from '../../resource/resource.registry';
import PromptRegistry from '../../prompt/prompt.registry';
import AdapterRegistry from '../../adapter/adapter.registry';
import PluginRegistry, { PluginScopeInfo } from '../../plugin/plugin.registry';
import AgentRegistry from '../../agent/agent.registry';
import SkillRegistry from '../../skill/skill.registry';

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
  private appSkills: SkillRegistry;
  private logger?: FrontMcpLogger;

  constructor(record: AppRecord, scopeProviders: ProviderRegistry) {
    super(record);
    this.scopeProviders = scopeProviders;
    this.id = this.metadata.id ?? idFromString(this.metadata.name);
    try {
      this.logger = scopeProviders.get(FrontMcpLogger)?.child('AppLocalInstance');
    } catch {
      // Logger not available yet
    }
    this.ready = this.initialize();
  }

  protected async initialize() {
    this.logger?.verbose(`Initializing app: ${this.metadata.name} (id: ${this.id})`);

    this.appProviders = new ProviderRegistry(this.metadata.providers ?? [], this.scopeProviders);
    await this.appProviders.ready; // wait for providers to be ready

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
    this.logger?.verbose(`App ${this.metadata.name}: ${this.appPlugins.getPlugins().length} plugin(s) registered`);

    this.appAdapters = new AdapterRegistry(this.appProviders, this.metadata.adapters ?? []);
    await this.appAdapters.ready;
    this.logger?.verbose(`App ${this.metadata.name}: ${this.appAdapters.getAdapters().length} adapter(s) found`);

    // Initialize tools FIRST to ensure they're available when skills validate tool references
    this.appTools = new ToolRegistry(this.appProviders, this.metadata.tools ?? [], appOwner);
    await this.appTools.ready;
    const toolNames = this.appTools.getTools(true).map((t) => t.metadata.name);
    this.logger?.verbose(
      `App ${this.metadata.name}: ${toolNames.length} tool(s) registered: [${toolNames.join(', ')}]`,
    );

    // Initialize remaining registries in parallel (skills can now access tools)
    this.appResources = new ResourceRegistry(this.appProviders, this.metadata.resources ?? [], appOwner);
    this.appPrompts = new PromptRegistry(this.appProviders, this.metadata.prompts ?? [], appOwner);
    this.appAgents = new AgentRegistry(this.appProviders, this.metadata.agents ?? [], appOwner);
    this.appSkills = new SkillRegistry(this.appProviders, this.metadata.skills ?? [], appOwner);

    await Promise.all([this.appResources.ready, this.appPrompts.ready, this.appAgents.ready, this.appSkills.ready]);
    this.logger?.verbose(
      `App ${this.metadata.name}: ${this.appResources.getResources().length} resource(s) registered`,
    );
    this.logger?.verbose(`App ${this.metadata.name}: ${this.appPrompts.getPrompts().length} prompt(s) registered`);

    // Emit a single info-level summary line with only non-zero counts
    const parts: string[] = [];
    const toolCount = this.appTools.getTools(true).length;
    const resourceCount = this.appResources.getResources().length;
    const promptCount = this.appPrompts.getPrompts().length;
    const adapterCount = this.appAdapters.getAdapters().length;
    const pluginCount = this.appPlugins.getPlugins().length;
    if (toolCount > 0) parts.push(`${toolCount} tool${toolCount !== 1 ? 's' : ''}`);
    if (resourceCount > 0) parts.push(`${resourceCount} resource${resourceCount !== 1 ? 's' : ''}`);
    if (promptCount > 0) parts.push(`${promptCount} prompt${promptCount !== 1 ? 's' : ''}`);
    if (adapterCount > 0) parts.push(`${adapterCount} adapter${adapterCount !== 1 ? 's' : ''}`);
    if (pluginCount > 0) parts.push(`${pluginCount} plugin${pluginCount !== 1 ? 's' : ''}`);
    this.logger?.info(`${this.metadata.name}: ${parts.length > 0 ? parts.join(', ') : 'no entries'}`);
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

  get skills(): Readonly<SkillRegistry> {
    return this.appSkills;
  }
}
