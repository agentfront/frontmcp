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
import { getEnvFlag, isEdgeRuntime } from '@frontmcp/utils';
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
import type { EventStore } from '@frontmcp/protocol';
import { createEventStore } from '../transport/event-stores';
import JobRegistry from '../job/job.registry';
import WorkflowRegistry from '../workflow/workflow.registry';
import { JobExecutionManager } from '../job/execution/job-execution.manager';
import { registerJobCapabilities, JobsConfig } from '../job/job-scope.helper';
import type { JobType } from '../common/interfaces/job.interface';
import type { WorkflowType } from '../common/interfaces/workflow.interface';
import type { JobStateStore } from '../job/store/job-state.interface';
import type { JobDefinitionStore } from '../job/store/job-definition.interface';

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

  /** Job/workflow registries and execution (optional) */
  private _scopeJobs?: JobRegistry;
  private _scopeWorkflows?: WorkflowRegistry;
  private _jobExecutionManager?: JobExecutionManager;
  private _jobStateStore?: JobStateStore;
  private _jobDefinitionStore?: JobDefinitionStore;

  /** CLI mode flag — skips non-essential initialization for faster startup */
  private readonly cliMode: boolean;

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

    // Check if CLI mode was requested (set by FrontMcpInstance.createForCli)
    this.cliMode = !!(rec.metadata as unknown as Record<string, unknown>)['__cliMode'];

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
    const perf = getEnvFlag('FRONTMCP_PERF');
    const t0 = perf ? performance.now() : 0;
    const mark = perf
      ? (label: string) => this.logger.info(`[PERF] ${label}: ${(performance.now() - t0).toFixed(1)}ms`)
      : () => {};

    // ═══ BATCH 1: Independent registries (parallel) ═══
    // These only depend on scopeProviders — no cross-registry dependencies.
    this.scopeHooks = new HookRegistry(scopeProviders, []);
    this.scopeFlows = new FlowRegistry(scopeProviders, [HttpRequestFlow]);
    this.scopeAuth = new AuthRegistry(this, scopeProviders, [], scopeRef, this.metadata.auth);
    this.scopeApps = new AppRegistry(this.scopeProviders, this.metadata.apps, scopeRef);
    this.logger.info(`Initializing ${this.metadata.apps.length} app(s)...`);

    // TransportService is synchronous — no await needed
    const transportConfig = this.metadata.transport;
    this.transportService = new TransportService(this, transportConfig?.persistence);

    // EventStore (conditional, skipped in CLI mode)
    const eventStoreConfig = transportConfig?.eventStore;
    if (eventStoreConfig?.enabled && !this.cliMode) {
      const { eventStore } = createEventStore(eventStoreConfig, this.logger);
      this._eventStore = eventStore;
      this.logger.info('EventStore initialized for SSE resumability', {
        provider: eventStoreConfig.provider ?? 'memory',
      });
    }

    // Elicitation store (conditional, skipped in CLI mode)
    const elicitationEnabled = this.metadata.elicitation?.enabled === true && !this.cliMode;
    const elicitationPromise = elicitationEnabled
      ? (async () => {
          const elicitationRedis = this.metadata.elicitation?.redis ?? this.metadata.redis;
          const { store: elicitStore } = await createElicitationStore({
            redis: elicitationRedis,
            keyPrefix: elicitationRedis?.keyPrefix ?? 'mcp:elicit:',
            logger: this.logger,
            isEdgeRuntime: isEdgeRuntime(),
          });
          this._elicitationStore = elicitStore;
        })()
      : undefined;

    // Await batch 1: hooks, flows, auth, apps + optional elicitation — all in parallel
    const batch1: Promise<void>[] = [
      this.scopeHooks.ready,
      this.scopeFlows.ready,
      this.scopeAuth.ready,
      this.scopeApps.ready,
    ];
    if (elicitationPromise) batch1.push(elicitationPromise);
    await Promise.all(batch1);
    this.logger.verbose('HookRegistry initialized');
    this.logger.verbose('FlowRegistry initialized');
    this.logger.verbose('TransportService initialized');
    this.logger.verbose('AuthRegistry initialized');
    mark('batch1:parallel (hooks+flows+auth+apps)');

    // ═══ BATCH 2: App-dependent registries (parallel) ═══
    // These call providers.getRegistries('AppRegistry') during initialize(),
    // so AppRegistry must be fully ready before they start.
    const serverPlugins = this.metadata.plugins ?? [];
    if (serverPlugins.length > 0) {
      const serverPluginScopeInfo: PluginScopeInfo = {
        ownScope: this,
        parentScope: undefined,
        isStandaloneApp: false,
      };
      this.scopePlugins = new PluginRegistry(this.scopeProviders, serverPlugins, scopeRef, serverPluginScopeInfo);
    }

    this.scopeTools = new ToolRegistry(this.scopeProviders, [], scopeRef);
    this.scopeResources = new ResourceRegistry(this.scopeProviders, [], scopeRef);
    this.scopePrompts = new PromptRegistry(this.scopeProviders, [], scopeRef);
    this.scopeAgents = new AgentRegistry(this.scopeProviders, [], scopeRef);
    this.scopeSkills = new SkillRegistry(this.scopeProviders, this.metadata.skills ?? [], scopeRef);

    const batch2: Promise<void>[] = [
      this.scopeTools.ready,
      this.scopeResources.ready,
      this.scopePrompts.ready,
      this.scopeAgents.ready,
      this.scopeSkills.ready,
    ];
    if (this.scopePlugins) batch2.push(this.scopePlugins.ready);
    await Promise.all(batch2);

    if (this.scopePlugins) {
      const pluginNames = this.scopePlugins.getPluginNames();
      this.logger.verbose(`PluginRegistry initialized (${pluginNames.length} plugin(s): [${pluginNames.join(', ')}])`);
    }
    const toolNames = this.scopeTools.getTools(true).map((t) => t.metadata.name);
    this.logger.verbose(`ToolRegistry initialized with initial ${toolNames.length} tool(s): [${toolNames.join(', ')}]`);
    this.logger.verbose(`ResourceRegistry initialized (${this.scopeResources.getResources().length} resource(s))`);
    this.logger.verbose(`PromptRegistry initialized (${this.scopePrompts.getPrompts().length} prompt(s))`);
    this.logger.verbose(`AgentRegistry initialized (${this.scopeAgents.getAgents().length} agent(s))`);
    this.logger.verbose(`SkillRegistry initialized (${this.scopeSkills.getSkills().length} skill(s))`);
    mark('batch2:parallel (tools+resources+prompts+agents+skills+plugins)');

    // ═══ BATCH 3: Cross-registry finalization (sequential) ═══

    // Register sendElicitationResult system tool if elicitation is enabled
    if (elicitationEnabled) {
      this.registerSendElicitationResultTool(scopeRef);
    }

    // Create UI import resolver with CDN overrides if configured
    // In CLI mode, skip UI widget compilation entirely — not needed for tool calls
    let uiResolver: import('@frontmcp/uipack/resolver').ImportResolver | undefined;
    if (!this.cliMode) {
      const cdnOverrides = this.metadata.ui?.cdnOverrides;
      if (cdnOverrides && Object.keys(cdnOverrides).length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { createResolverWithOverrides } = require('@frontmcp/uipack/resolver');
        uiResolver = createResolverWithOverrides(cdnOverrides);
        this.logger.verbose('Created UI resolver with CDN overrides', { overrides: Object.keys(cdnOverrides) });
      }
    }

    this.toolUIRegistry = new ToolUIRegistry(uiResolver);

    // Register UI resource templates if any tools have UI configs
    // Skipped in CLI mode — UI widgets are not needed for CLI tool execution
    if (!this.cliMode) {
      await this.compileUIWidgets();
    }

    // Initialize skill session manager if skills are available
    if (this.scopeSkills.hasAny()) {
      const store = createSkillSessionStore({ type: 'memory' });

      this._skillSession = new SkillSessionManager(
        {
          defaultPolicyMode: 'permissive',
        },
        this.logger,
        store,
      );

      // Register skill tool authorization guard hook
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

    // Initialize jobs and workflows if enabled
    const jobsConfig = this.metadata.jobs as JobsConfig | undefined;
    if (jobsConfig?.enabled) {
      const metaRecord = this.metadata as unknown as Record<string, unknown>;
      const jobsList = (metaRecord['jobTypes'] as JobType[] | undefined) ?? [];
      const workflowsList = (metaRecord['workflowTypes'] as WorkflowType[] | undefined) ?? [];

      // Collect jobs/workflows from apps
      const appJobs: JobType[] = [];
      const appWorkflows: WorkflowType[] = [];
      for (const app of this.scopeApps.getApps()) {
        const appMeta = app.metadata as unknown as Record<string, unknown>;
        if (Array.isArray(appMeta['jobs'])) appJobs.push(...(appMeta['jobs'] as JobType[]));
        if (Array.isArray(appMeta['workflows'])) appWorkflows.push(...(appMeta['workflows'] as WorkflowType[]));
      }

      const notifyFn = async (data: Record<string, unknown>) => {
        if (this.notificationService) {
          this.logger.debug('Job notification', data);
        }
      };

      const result = await registerJobCapabilities({
        providers: this.scopeProviders,
        owner: scopeRef,
        jobsList: [...jobsList, ...appJobs],
        workflowsList: [...workflowsList, ...appWorkflows],
        jobsConfig,
        logger: this.logger,
        notifyFn,
      });

      this._scopeJobs = result.jobRegistry as JobRegistry;
      this._scopeWorkflows = result.workflowRegistry as WorkflowRegistry;
      this._jobExecutionManager = result.executionManager;
      this._jobStateStore = result.stateStore;
      this._jobDefinitionStore = result.definitionStore;

      // Register job/workflow management tools
      for (const toolCls of result.managementTools) {
        try {
          const toolRecord = normalizeTool(toolCls);
          const toolInstance = new ToolInstance(toolRecord, this.scopeProviders, {
            kind: 'scope',
            id: '_jobs',
            ref: toolCls,
          });
          this.scopeTools.registerToolInstance(toolInstance);
        } catch (error) {
          this.logger.warn(
            `Failed to register job management tool: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      this.logger.info(
        `Jobs system initialized: ${this._scopeJobs.getJobs().length} jobs, ${this._scopeWorkflows.getWorkflows().length} workflows`,
      );
    }

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

    mark('batch3:finalization');
    this.logger.info(`Scope ready — ${this.formatScopeSummary()}`);
  }

  /**
   * Pre-compile UI widgets for tools with UI configs.
   * Extracted from initialize() for readability.
   */
  private async compileUIWidgets(): Promise<void> {
    const toolsWithUI = this.scopeTools.getTools(true).filter((t) => hasUIConfig(t.metadata));
    if (toolsWithUI.length === 0) return;

    // Register static widget template for OpenAI discovery (ui://widget/{toolName}.html)
    this.scopeResources.registerDynamicResource(StaticWidgetResourceTemplate);
    this.logger.verbose(`Registered UI resource template for ${toolsWithUI.length} tool(s) with UI configs`);

    // Pre-compile static widgets for tools with servingMode: 'static'
    const staticModeTools = toolsWithUI.filter(
      (t) => t.metadata.ui && t.metadata.ui.servingMode === 'static' && t.metadata.ui.template,
    );

    if (staticModeTools.length > 0) {
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
            this.logger.error(`Failed to compile lean widget shell for tool "${tool.metadata.name}": ${errorMessage}`);
          }
        }),
      );
      this.logger.info(
        `Pre-compiled ${inlineCompiledCount}/${inlineTools.length} lean widget shell(s) for inline mode tools`,
      );
    }

    // Pre-compile hybrid widget shells for hybrid mode tools
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
              template: uiConfig.template,
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

  private formatScopeSummary(): string {
    const entries: string[] = [];
    const add = (count: number, label: string) => {
      if (count > 0) entries.push(`${count} ${label}${count !== 1 ? 's' : ''}`);
    };
    add(this.scopeApps.getApps().length, 'app');
    add(this.scopeTools.getTools(true).length, 'tool');
    add(this.scopeResources.getResources().length, 'resource');
    add(this.scopePrompts.getPrompts().length, 'prompt');
    add(this.scopeAgents.getAgents().length, 'agent');
    add(this.scopeSkills.getSkills().length, 'skill');
    if (this._scopeJobs) add(this._scopeJobs.getJobs().length, 'job');
    if (this._scopeWorkflows) add(this._scopeWorkflows.getWorkflows().length, 'workflow');
    return entries.length > 0 ? entries.join(', ') : 'empty';
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

  get jobs(): JobRegistry | undefined {
    return this._scopeJobs;
  }

  get workflows(): WorkflowRegistry | undefined {
    return this._scopeWorkflows;
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
