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
  SessionProvider,
  Token,
  Type,
} from '../common';
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
import { NotificationService } from '../notification';
import SetLevelFlow from '../logging/flows/set-level.flow';
import CompleteFlow from '../completion/flows/complete.flow';
import { ToolUIRegistry, StaticWidgetResourceTemplate, hasUIConfig } from '../tool/ui';

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

  transportService: TransportService; // TODO: migrate transport service to transport.registry
  notificationService: NotificationService;
  private toolUIRegistry: ToolUIRegistry;
  readonly entryPath: string;
  readonly routeBase: string;
  readonly orchestrated: boolean = false;

  readonly server: FrontMcpServer;

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

    this.scopeProviders = new ProviderRegistry(this.defaultScopeProviders, globalProviders);
    this.ready = this.initialize();
  }

  protected async initialize(): Promise<void> {
    await this.scopeProviders.ready;

    const scopeRef: EntryOwnerRef = { kind: 'scope', id: this.id, ref: Scope };
    const scopeProviders = this.scopeProviders;

    this.scopeHooks = new HookRegistry(scopeProviders, []);
    await this.scopeHooks.ready;

    this.scopeFlows = new FlowRegistry(scopeProviders, [HttpRequestFlow]);
    await this.scopeFlows.ready;

    // Pass transport persistence config to TransportService
    const transportConfig = this.metadata.transport;
    this.transportService = new TransportService(this, transportConfig?.persistence);

    this.scopeAuth = new AuthRegistry(this, scopeProviders, [], scopeRef, this.metadata.auth);
    await this.scopeAuth.ready;

    this.scopeApps = new AppRegistry(this.scopeProviders, this.metadata.apps, scopeRef);
    await this.scopeApps.ready;

    this.scopeTools = new ToolRegistry(this.scopeProviders, [], scopeRef);
    await this.scopeTools.ready;

    this.toolUIRegistry = new ToolUIRegistry();

    this.scopeResources = new ResourceRegistry(this.scopeProviders, [], scopeRef);
    await this.scopeResources.ready;

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

    // Initialize notification service after all registries are ready
    this.notificationService = new NotificationService(this);
    await this.notificationService.initialize();

    // Register logging and completion flows
    await this.scopeFlows.registryFlows([SetLevelFlow, CompleteFlow]);

    await this.auth.ready;
    this.logger.info('Initializing multi-app scope', this.metadata);
    if (!this.metadata.auth) {
      // log a large warning about using FrontMcp without authentication
      this.logger.warn(
        `\n\n*******************************\n  WARNING: FrontMcp is running without authentication. \n  This is a security risk and should only be used in development environments. \n*******************************\n\n`,
      );
    }
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
      {
        scope: ProviderScope.SESSION,
        name: 'SessionProvider',
        provide: SessionProvider,
        useClass: SessionProvider,
      },
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

  get notifications(): NotificationService {
    return this.notificationService;
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
    throw new Error(`flow exist without output`);
  }
}
