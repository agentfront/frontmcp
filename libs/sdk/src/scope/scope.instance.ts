import 'reflect-metadata';
import {
  EntryOwnerRef,
  FlowInputOf,
  FlowName,
  FlowOutputOf,
  FlowType,
  FrontMcpAuth,
  FrontMcpLogger,
  FrontMcpServer,
  HookRegistryInterface,
  ProviderScope,
  ScopeEntry,
  ScopeRecord,
  Token,
  Type,
} from '../common';
import { FrontMcpContextStorage, FrontMcpContextProvider } from '../context';
import AppRegistry from '../app/app.registry';
import ProviderRegistry from '../provider/provider.registry';
import { AuthRegistry } from '../auth/auth.registry';
import FlowRegistry from '../flows/flow.registry';
import HttpRequestFlow from './flows/http.request.flow';
import { TransportService } from '../transport/transport.registry';
import ToolRegistry from '../tool/tool.registry';
import ResourceRegistry from '../resource/resource.registry';
import HookRegistry from '../hooks/hook.registry';
import PromptRegistry from '../prompt/prompt.registry';
import AgentRegistry from '../agent/agent.registry';
import SkillRegistry from '../skill/skill.registry';
import { SkillValidationError } from '../skill/errors/skill-validation.error';
import { FlowExitedWithoutOutputError } from '../errors';
import { registerSkillCapabilities } from '../skill/skill-scope.helper';
import { SkillSessionManager, createSkillSessionStore } from '../skill/session';
import { createSkillToolGuardHook } from '../skill/hooks';
import { normalizeHooksFromCls } from '../hooks/hooks.utils';
import { NotificationService } from '../notification';
import SetLevelFlow from '../logging/flows/set-level.flow';
import CompleteFlow from '../completion/flows/complete.flow';
import { ToolUIRegistry, StaticWidgetResourceTemplate, hasUIConfig } from '../tool/ui';
import CallAgentFlow from '../agent/flows/call-agent.flow';
import PluginRegistry, { PluginScopeInfo } from '../plugin/plugin.registry';
import { ElicitationStore, createElicitationStore } from '../elicitation';
import { ElicitationRequestFlow, ElicitationResultFlow } from '../elicitation/flows';
import { ElicitationStoreNotInitializedError } from '../errors/elicitation.error';
import { SendElicitationResultTool } from '../elicitation/send-elicitation-result.tool';
import { normalizeTool } from '../tool/tool.utils';
import { ToolInstance } from '../tool/tool.instance';
import type { EventStore } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createEventStore } from '../transport/event-stores';

export class Scope extends ScopeEntry {
  readonly id: string;
  private readonly globalProviders: ProviderRegistry;
  readonly logger: FrontMcpLogger;

  private readonly scopeProviders: ProviderRegistry;
  private scopeAuth: AuthRegistry;
  private scopeFlows: FlowRegistry;
  private scopeApps: AppRegistry;
  private scopeHooks: HookRegistry;
  private scopeTools: ToolRegistry;
  private scopeResources: ResourceRegistry;
  private scopePrompts: PromptRegistry;
  private scopeAgents: AgentRegistry;
  private scopeSkills: SkillRegistry;
  private scopePlugins?: PluginRegistry;

  transportService: TransportService; // TODO: migrate transport service to transport.registry
  notificationService: NotificationService;
  private toolUIRegistry: ToolUIRegistry;
  readonly entryPath: string;
  readonly routeBase: string;
  readonly orchestrated: boolean = false;

  readonly server: FrontMcpServer;

  /** Lazy-initialized elicitation store for distributed elicitation support */
  private _elicitationStore?: ElicitationStore;

  /** Optional skill session manager for tool authorization enforcement */
  private _skillSession?: SkillSessionManager;

  /** EventStore for SSE resumability support (optional) */
  private _eventStore?: EventStore;

  constructor(rec: ScopeRecord, globalProviders: ProviderRegistry) {
    super(rec, rec.provide);
    this.id = rec.metadata.id;
    this.logger = globalProviders.get(FrontMcpLogger).child('FrontMcp.MultiAppScope');
    this.globalProviders = globalProviders;
    this.server = this.globalProviders.get(FrontMcpServer);
    this.entryPath = rec.metadata.http?.entryPath ?? '';

    if (rec.kind === 'SPLIT_BY_APP') {
      this.routeBase = `/${rec.metadata.id}`;
    } else {
      this.routeBase = '';
    }

    // Pass distributed config to ProviderRegistry for serverless/multi-instance support
    const distributedMode = rec.metadata.transport?.distributedMode;
    const providerCaching = rec.metadata.transport?.providerCaching;
    this.scopeProviders = new ProviderRegistry(this.defaultScopeProviders, globalProviders, {
      distributedMode,
      providerCaching,
    });
    this.ready = this.initialize();
  }

  protected async initialize(): Promise<void> {
    await this.scopeProviders.ready;

    const scopeRef: EntryOwnerRef = { kind: 'scope', id: this.id, ref: Scope };
    const scopeProviders = this.scopeProviders;

    this.scopeHooks = new HookRegistry(scopeProviders, []);
    await this.scopeHooks.ready;
    this.logger.verbose('HookRegistry initialized');

    this.scopeFlows = new FlowRegistry(scopeProviders, [HttpRequestFlow]);
    await this.scopeFlows.ready;
    this.logger.verbose('FlowRegistry initialized');

    // Pass transport persistence config to TransportService
    const transportConfig = this.metadata.transport;
    this.transportService = new TransportService(this, transportConfig?.persistence);
    this.logger.verbose('TransportService initialized');

    // Initialize EventStore for SSE resumability support (optional)
    // Disabled by default because Claude.ai's client doesn't handle priming events correctly
    const eventStoreConfig = transportConfig?.eventStore;
    if (eventStoreConfig?.enabled) {
      const { eventStore } = createEventStore(eventStoreConfig, this.logger);
      this._eventStore = eventStore;
      this.logger.info('EventStore initialized for SSE resumability', {
        provider: eventStoreConfig.provider ?? 'memory',
      });
    }

    // Initialize elicitation store for distributed elicitation support
    // Only initialize if elicitation is explicitly enabled (default: false)
    const elicitationEnabled = this.metadata.elicitation?.enabled === true;
    if (elicitationEnabled) {
      // Use elicitation-specific redis config, or fall back to global redis
      const elicitationRedis = this.metadata.elicitation?.redis ?? this.metadata.redis;
      const { store: elicitStore } = await createElicitationStore({
        redis: elicitationRedis,
        keyPrefix: elicitationRedis?.keyPrefix ?? 'mcp:elicit:',
        logger: this.logger,
        isEdgeRuntime: this.isEdgeRuntime(),
      });
      this._elicitationStore = elicitStore;
    }

    this.scopeAuth = new AuthRegistry(this, scopeProviders, [], scopeRef, this.metadata.auth);
    await this.scopeAuth.ready;
    this.logger.verbose('AuthRegistry initialized');

    this.scopeApps = new AppRegistry(this.scopeProviders, this.metadata.apps, scopeRef);
    const appCount = this.metadata.apps.length;
    this.logger.info(`Initializing ${appCount} app(s)...`);
    await this.scopeApps.ready;

    // Initialize server-level plugins (from @FrontMcp decorator)
    // Each scope gets its own instance of these plugins
    const serverPlugins = this.metadata.plugins ?? [];
    if (serverPlugins.length > 0) {
      const serverPluginScopeInfo: PluginScopeInfo = {
        ownScope: this,
        parentScope: undefined, // Server plugins are already at top level
        isStandaloneApp: false,
      };

      this.scopePlugins = new PluginRegistry(this.scopeProviders, serverPlugins, scopeRef, serverPluginScopeInfo);
      await this.scopePlugins.ready;
      const pluginNames = this.scopePlugins.getPluginNames();
      this.logger.verbose(`PluginRegistry initialized (${pluginNames.length} plugin(s): [${pluginNames.join(', ')}])`);
    }

    this.scopeTools = new ToolRegistry(this.scopeProviders, [], scopeRef);
    await this.scopeTools.ready;
    const toolNames = this.scopeTools.getTools(true).map((t) => t.metadata.name);
    this.logger.verbose(`ToolRegistry initialized (${toolNames.length} tool(s): [${toolNames.join(', ')}])`);

    // Register sendElicitationResult system tool (hidden by default)
    // This tool is used for fallback elicitation with non-supporting clients
    // Only register if elicitation is enabled
    if (elicitationEnabled) {
      this.registerSendElicitationResultTool(scopeRef);
    }

    this.toolUIRegistry = new ToolUIRegistry();

    this.scopeResources = new ResourceRegistry(this.scopeProviders, [], scopeRef);
    await this.scopeResources.ready;
    this.logger.verbose(`ResourceRegistry initialized (${this.scopeResources.getResources().length} resource(s))`);

    // Register UI resource templates if any tools have UI configs
    // This enables resource capabilities to be advertised when tools have UI
    const toolsWithUI = this.scopeTools.getTools(true).filter((t) => hasUIConfig(t.metadata));
    if (toolsWithUI.length > 0) {
      // Register static widget template for OpenAI discovery (ui://widget/{toolName}.html)
      this.scopeResources.registerDynamicResource(StaticWidgetResourceTemplate);
      this.logger.verbose(`Registered UI resource template for ${toolsWithUI.length} tool(s) with UI configs`);

      // Pre-compile static widgets for tools with servingMode: 'static'
      // This is done at server startup so that the static widget HTML is immediately
      // available when OpenAI fetches it via resources/read (at tools/list time).
      // The static widget reads data from the FrontMCP Bridge at runtime.
      const staticModeTools = toolsWithUI.filter(
        (t) => t.metadata.ui && t.metadata.ui.servingMode === 'static' && t.metadata.ui.template,
      );

      if (staticModeTools.length > 0) {
        // Compile all static widgets in parallel
        let staticCompiledCount = 0;
        await Promise.all(
          staticModeTools.map(async (tool) => {
            const uiConfig = tool.metadata.ui;
            if (!uiConfig?.template) {
              this.logger.warn(
                `Skipping static widget pre-compile for tool "${tool.metadata.name}" due to missing ui.template`,
              );
              return;
            }
            try {
              await this.toolUIRegistry.compileStaticWidgetAsync({
                toolName: tool.metadata.name,
                template: uiConfig.template,
                uiConfig,
              });
              staticCompiledCount++;
              this.logger.verbose(`Compiled static widget for tool: ${tool.metadata.name}`);
            } catch (error) {
              // Log error but don't fail server startup
              const errorMessage = error instanceof Error ? error.message : String(error);
              this.logger.error(`Failed to compile static widget for tool "${tool.metadata.name}": ${errorMessage}`);
            }
          }),
        );
        this.logger.info(
          `Pre-compiled ${staticCompiledCount}/${staticModeTools.length} static widget(s) for static mode tools`,
        );
      }

      // Pre-compile lean widget shells for inline mode tools
      // These are minimal HTML shells (no React/JS) that OpenAI caches at discovery
      // The actual React widget comes in each tool response with embedded data
      const inlineTools = toolsWithUI.filter(
        (t) =>
          t.metadata.ui &&
          (t.metadata.ui.servingMode === 'inline' || !t.metadata.ui.servingMode) &&
          t.metadata.ui.template,
      );

      if (inlineTools.length > 0) {
        let inlineCompiledCount = 0;
        await Promise.all(
          inlineTools.map(async (tool) => {
            const uiConfig = tool.metadata.ui;
            if (!uiConfig) {
              this.logger.warn(
                `Skipping lean widget pre-compile for tool "${tool.metadata.name}" due to missing ui config`,
              );
              return;
            }
            try {
              await this.toolUIRegistry.compileLeanWidgetAsync({
                toolName: tool.metadata.name,
                uiConfig,
              });
              inlineCompiledCount++;
              this.logger.verbose(`Compiled lean widget shell for tool: ${tool.metadata.name}`);
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              this.logger.error(
                `Failed to compile lean widget shell for tool "${tool.metadata.name}": ${errorMessage}`,
              );
            }
          }),
        );
        this.logger.info(
          `Pre-compiled ${inlineCompiledCount}/${inlineTools.length} lean widget shell(s) for inline mode tools`,
        );
      }

      // Pre-compile hybrid widget shells for hybrid mode tools
      // These contain React runtime + Bridge + dynamic renderer, but NO component code
      // The component code is delivered per-request in _meta['ui/component']
      const hybridTools = toolsWithUI.filter(
        (t) => t.metadata.ui && t.metadata.ui.servingMode === 'hybrid' && t.metadata.ui.template,
      );

      if (hybridTools.length > 0) {
        let hybridCompiledCount = 0;
        await Promise.all(
          hybridTools.map(async (tool) => {
            const uiConfig = tool.metadata.ui;
            if (!uiConfig) {
              this.logger.warn(
                `Skipping hybrid widget pre-compile for tool "${tool.metadata.name}" due to missing ui config`,
              );
              return;
            }
            try {
              await this.toolUIRegistry.compileHybridWidgetAsync({
                toolName: tool.metadata.name,
                uiConfig,
              });
              hybridCompiledCount++;
              this.logger.verbose(`Compiled hybrid widget shell for tool: ${tool.metadata.name}`);
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              this.logger.error(
                `Failed to compile hybrid widget shell for tool "${tool.metadata.name}": ${errorMessage}`,
              );
            }
          }),
        );
        this.logger.info(
          `Pre-compiled ${hybridCompiledCount}/${hybridTools.length} hybrid widget shell(s) for hybrid mode tools`,
        );
      }
    }

    this.scopePrompts = new PromptRegistry(this.scopeProviders, [], scopeRef);
    await this.scopePrompts.ready;
    this.logger.verbose(`PromptRegistry initialized (${this.scopePrompts.getPrompts().length} prompt(s))`);

    // Initialize agent registry (scope-level agents, typically none but allows for scope-wide agents)
    this.scopeAgents = new AgentRegistry(this.scopeProviders, [], scopeRef);
    await this.scopeAgents.ready;
    this.logger.verbose(`AgentRegistry initialized (${this.scopeAgents.getAgents().length} agent(s))`);

    // Initialize skill registry (scope-level skills from @FrontMcp metadata)
    this.scopeSkills = new SkillRegistry(this.scopeProviders, this.metadata.skills ?? [], scopeRef);
    await this.scopeSkills.ready;
    this.logger.verbose(`SkillRegistry initialized (${this.scopeSkills.getSkills().length} skill(s))`);

    // Initialize skill session manager if skills are available
    // Skill sessions enable tool authorization enforcement at runtime
    // The session manager is always initialized when skills exist, but
    // session activation is opt-in via LoadSkillFlow's activateSession parameter
    if (this.scopeSkills.hasAny()) {
      // Use in-memory store for now (Redis support can be added later)
      const store = createSkillSessionStore({ type: 'memory' });

      this._skillSession = new SkillSessionManager(
        {
          defaultPolicyMode: 'permissive', // Default to permissive for backwards compatibility
        },
        this.logger,
        store,
      );

      // Register skill tool authorization guard hook
      // This hook intercepts tool calls and enforces skill-based allowlists
      const GuardHookClass = createSkillToolGuardHook(this._skillSession, {
        logger: this.logger,
        trackToolCalls: true,
      });
      const guardHookInstance = new GuardHookClass();
      const hookRecords = normalizeHooksFromCls(guardHookInstance);
      if (hookRecords.length > 0) {
        await this.scopeHooks.registerHooks(true, ...hookRecords);
        this.logger.verbose('Skill tool authorization guard hook registered');
      }

      this.logger.verbose('Skill session manager initialized', {
        storeType: store.type,
      });
    }

    // Validate all skills after everything is initialized
    // This ensures tools from plugins/adapters are also available for validation
    if (this.scopeSkills.hasAny()) {
      try {
        const report = await this.scopeSkills.validateAllTools();
        if (report.warningCount > 0) {
          this.logger.verbose('Skill validation completed with warnings', {
            totalSkills: report.totalSkills,
            warningCount: report.warningCount,
          });
        }
      } catch (error) {
        if (error instanceof SkillValidationError) {
          this.logger.error('Skill validation failed', {
            failedSkills: error.failedSkills.map((s) => ({
              name: s.skillName,
              missingTools: s.missingTools,
            })),
          });
          throw error;
        }
        throw error;
      }
    }

    // Register skill flows and tools if any skills are available
    await registerSkillCapabilities({
      skillRegistry: this.scopeSkills,
      flowRegistry: this.scopeFlows,
      toolRegistry: this.scopeTools,
      providers: this.scopeProviders,
      skillsConfig: this.metadata.skillsConfig,
      logger: this.logger,
    });

    // Initialize notification service after all registries are ready
    this.notificationService = new NotificationService(this);
    await this.notificationService.initialize();
    this.logger.verbose('NotificationService initialized');

    // Register logging, completion, agent, and elicitation flows
    await this.scopeFlows.registryFlows([
      SetLevelFlow,
      CompleteFlow,
      CallAgentFlow,
      ElicitationRequestFlow,
      ElicitationResultFlow,
    ]);

    await this.auth.ready;

    // Build a concise summary with only non-zero counts
    const counts: string[] = [];
    const appsCount = this.scopeApps.getApps().length;
    const toolsCount = this.scopeTools.getTools(true).length;
    const resourcesCount = this.scopeResources.getResources().length;
    const promptsCount = this.scopePrompts.getPrompts().length;
    const agentsCount = this.scopeAgents.getAgents().length;
    const skillsCount = this.scopeSkills.getSkills().length;
    if (appsCount > 0) counts.push(`${appsCount} app${appsCount !== 1 ? 's' : ''}`);
    if (toolsCount > 0) counts.push(`${toolsCount} tool${toolsCount !== 1 ? 's' : ''}`);
    if (resourcesCount > 0) counts.push(`${resourcesCount} resource${resourcesCount !== 1 ? 's' : ''}`);
    if (promptsCount > 0) counts.push(`${promptsCount} prompt${promptsCount !== 1 ? 's' : ''}`);
    if (agentsCount > 0) counts.push(`${agentsCount} agent${agentsCount !== 1 ? 's' : ''}`);
    if (skillsCount > 0) counts.push(`${skillsCount} skill${skillsCount !== 1 ? 's' : ''}`);
    this.logger.info(`Scope ready — ${counts.join(', ')}`);
  }

  private get defaultScopeProviders() {
    return [
      {
        scope: ProviderScope.GLOBAL,
        name: 'ScopeEntry',
        provide: ScopeEntry,
        useValue: this,
      },
      {
        scope: ProviderScope.GLOBAL,
        name: 'Scope',
        provide: Scope,
        useValue: this,
      },
      {
        scope: ProviderScope.GLOBAL,
        name: 'FrontMcpLogger',
        provide: FrontMcpLogger,
        useValue: this.logger,
      },
      // FrontMcpContextStorage is GLOBAL because it manages the AsyncLocalStorage,
      // not the per-request data. Access the actual FrontMcpContext via FRONTMCP_CONTEXT token.
      {
        scope: ProviderScope.GLOBAL,
        name: 'FrontMcpContextStorage',
        provide: FrontMcpContextStorage,
        useClass: FrontMcpContextStorage,
      },
      // FrontMcpContextProvider is a factory that retrieves from AsyncLocalStorage
      FrontMcpContextProvider,
    ];
  }

  get auth(): FrontMcpAuth {
    return this.scopeAuth.getPrimary();
  }

  get hooks(): HookRegistryInterface {
    return this.scopeHooks;
  }

  get authProviders(): AuthRegistry {
    return this.scopeAuth;
  }

  get providers() {
    return this.scopeProviders;
  }

  get apps(): AppRegistry {
    return this.scopeApps;
  }

  get tools(): ToolRegistry {
    return this.scopeTools;
  }

  get toolUI(): ToolUIRegistry {
    return this.toolUIRegistry;
  }

  get resources(): ResourceRegistry {
    return this.scopeResources;
  }

  get prompts(): PromptRegistry {
    return this.scopePrompts;
  }

  get agents(): AgentRegistry {
    return this.scopeAgents;
  }

  get skills(): SkillRegistry {
    return this.scopeSkills;
  }

  /**
   * Get the skill session manager for tool authorization enforcement.
   * Returns undefined if skill sessions are not enabled.
   *
   * Skill sessions provide:
   * - Tool allowlists: Only tools declared in the active skill can be called
   * - Policy modes: strict (block), approval (prompt), or permissive (warn)
   * - Rate limiting: Optional per-session tool call limits
   *
   * Enable via @FrontMcp metadata: `skills: { sessions: { enabled: true, defaultPolicyMode: 'strict' } }`
   */
  get skillSession(): SkillSessionManager | undefined {
    return this._skillSession;
  }

  get plugins(): PluginRegistry | undefined {
    return this.scopePlugins;
  }

  get notifications(): NotificationService {
    return this.notificationService;
  }

  /**
   * Get the elicitation store for distributed elicitation support.
   *
   * Lazily initializes the store using the elicitation store factory:
   * - Redis: Uses RedisElicitationStore for distributed deployments
   * - In-memory: Uses InMemoryElicitationStore for single-node/dev
   * - Edge runtime without Redis: Throws error (Edge functions are stateless)
   *
   * @see createElicitationStore for factory implementation details
   */
  get elicitationStore(): ElicitationStore {
    if (!this._elicitationStore) {
      throw new ElicitationStoreNotInitializedError();
    }
    return this._elicitationStore;
  }

  /**
   * Get the EventStore for SSE resumability support.
   *
   * Returns undefined if EventStore is not enabled.
   * When enabled, clients can reconnect and resume missed SSE messages
   * using the Last-Event-ID header per the MCP protocol.
   *
   * Enable via @FrontMcp metadata:
   * ```typescript
   * transport: {
   *   eventStore: {
   *     enabled: true,
   *     provider: 'memory',  // or 'redis'
   *   }
   * }
   * ```
   */
  get eventStore(): EventStore | undefined {
    return this._eventStore;
  }

  /**
   * Register the sendElicitationResult system tool.
   * This tool is hidden by default and only shown to clients that don't support elicitation.
   */
  private registerSendElicitationResultTool(scopeRef: EntryOwnerRef): void {
    try {
      const toolRecord = normalizeTool(SendElicitationResultTool);
      const systemToolEntry = new ToolInstance(toolRecord, this.scopeProviders, {
        kind: 'scope',
        id: '_system',
        ref: SendElicitationResultTool,
      });
      this.scopeTools.registerToolInstance(systemToolEntry);
      this.logger.verbose('Registered sendElicitationResult system tool');
    } catch (error) {
      // Log error but don't fail scope initialization
      this.logger.warn(
        `Failed to register sendElicitationResult tool: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Detect if running on Edge runtime (Vercel Edge, Cloudflare Workers).
   * Edge functions are stateless and require external storage for elicitation.
   */
  private isEdgeRuntime(): boolean {
    // Check for Vercel Edge Runtime
    if (typeof globalThis !== 'undefined' && 'EdgeRuntime' in globalThis) {
      return true;
    }
    // Check for Cloudflare Workers
    if (typeof globalThis !== 'undefined' && 'caches' in globalThis && !('window' in globalThis)) {
      return true;
    }
    // Check for common environment variables (guarded for Edge runtimes where process may not exist)
    if (
      typeof process !== 'undefined' &&
      typeof process.env !== 'undefined' &&
      process.env['VERCEL_ENV'] !== undefined &&
      process.env['EDGE_RUNTIME'] !== undefined
    ) {
      return true;
    }
    return false;
  }

  /**
   * Get pagination configuration for list operations.
   * Returns the parsed pagination config from @FrontMcp metadata.
   */
  get pagination() {
    return this.metadata.pagination;
  }

  registryFlows(...flows: FlowType[]) {
    return this.scopeFlows.registryFlows(flows);
  }

  runFlow<Name extends FlowName>(
    name: Name,
    input: FlowInputOf<Name>,
    deps?: Map<Token, Type>,
  ): Promise<FlowOutputOf<Name> | undefined> {
    return this.scopeFlows.runFlow(name, input, deps);
  }

  async runFlowForOutput<Name extends FlowName>(
    name: Name,
    input: FlowInputOf<Name>,
    deps?: Map<Token, Type>,
  ): Promise<FlowOutputOf<Name>> {
    const result = await this.scopeFlows.runFlow(name, input, deps);
    if (result) {
      return result;
    }
    throw new FlowExitedWithoutOutputError();
  }
}
