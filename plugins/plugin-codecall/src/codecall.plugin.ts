// file: plugins/plugin-codecall/src/codecall.plugin.ts

import CachePlugin from '@frontmcp/plugin-cache';
import {
  DynamicPlugin,
  FrontMcpLogger,
  FrontMcpToolTokens,
  isEntryGatedBy,
  ListToolsHook,
  Plugin,
  resolveToolVisibility,
  ScopeEntry,
  ToolHook,
  ToolNotFoundError,
  type FlowCtxOf,
  type HookGatedEntry,
  type ProviderType,
  type ToolEntry,
  type ToolType,
} from '@frontmcp/sdk';

import {
  codeCallPluginOptionsSchema,
  type CodeCallMode,
  type CodeCallPluginOptions,
  type CodeCallPluginOptionsInput,
  type CodeCallToolMetadata,
} from './codecall.types';
import CodeCallConfig from './providers/code-call.config';
import { isInProcessDispatch } from './security';
import { ToolSearchService } from './services';
import { AuditLoggerService, type AuditEvent } from './services/audit-logger.service';
import EnclaveService from './services/enclave.service';
import { DescribeTool, ExecuteTool, InvokeTool, SearchKnowledgeTool, SearchSkillsTool, SearchTool } from './tools';
import { buildExecuteToolDescription } from './tools/execute.schema';
import { buildSearchToolDescription } from './tools/search.schema';

/**
 * What a CodeCall audit event contributes to a log line.
 *
 * `type` is the message and the logger stamps its own time, so neither is repeated here. Nothing
 * is added to what the service built: it already reduces a script to a hash and a length and
 * accepts no tool arguments or results, and that is the whole reason these lines are safe to emit
 * at info by default.
 */
function auditLogFields(event: AuditEvent): Record<string, unknown> {
  const { executionId, durationMs, data } = event;
  return durationMs === undefined ? { executionId, ...data } : { executionId, durationMs, ...data };
}

/**
 * The call context a `tools:call-tool` run was started with: the MCP handler's request context for
 * a client's `tools/call`, the one an in-process dispatcher built otherwise. The flow's input
 * schema types it as `any`, since its shape is the dispatcher's.
 */
function callContextOf(flowCtx: FlowCtxOf<'tools:call-tool'>): unknown {
  const rawInput: unknown = flowCtx.rawInput;
  return typeof rawInput === 'object' && rawInput !== null ? (rawInput as { ctx?: unknown }).ctx : undefined;
}

@Plugin({
  name: 'codecall',
  description: 'CodeCall plugin: AgentScript-based meta-tools for orchestrating MCP tools',
  providers: [],
  plugins: [CachePlugin],
})
export default class CodeCallPlugin extends DynamicPlugin<CodeCallPluginOptions, CodeCallPluginOptionsInput> {
  options: CodeCallPluginOptions;
  private cachedLogger?: FrontMcpLogger;

  private getLogger(): FrontMcpLogger {
    if (!this.cachedLogger) {
      this.cachedLogger = this.get(FrontMcpLogger).child('CodeCall');
    }
    return this.cachedLogger;
  }

  constructor(options: CodeCallPluginOptionsInput = {}) {
    super();
    // Parse options with Zod schema to apply all defaults
    this.options = codeCallPluginOptionsSchema.parse(options);
  }

  /**
   * Dynamic providers allow you to configure the plugin with custom options
   * without touching the plugin decorator.
   */
  static override dynamicProviders(options: CodeCallPluginOptionsInput): ProviderType[] {
    // Parse options with Zod schema to apply all defaults
    const parsedOptions = codeCallPluginOptionsSchema.parse(options);

    // Create config instance
    const config = new CodeCallConfig(parsedOptions);

    return [
      {
        name: 'codecall:config',
        provide: CodeCallConfig,
        useValue: config,
      },
      {
        name: 'codecall:enclave',
        provide: EnclaveService,
        inject: () => [CodeCallConfig],
        useFactory: async (cfg: CodeCallConfig) => {
          return new EnclaveService(cfg);
        },
      },
      {
        // GHSA-adjacent: production.mdx promised operators these events and nothing emitted them,
        // because the service was never registered. The subscription lives here, in the factory,
        // for a reason: there is no provider teardown hook in the SDK, so subscribing anywhere
        // per-request would grow the listener Set for the life of the process.
        name: 'codecall:audit-logger',
        provide: AuditLoggerService,
        inject: () => [ScopeEntry],
        useFactory: (scope: ScopeEntry) => {
          const audit = new AuditLoggerService();
          const logger = scope.logger.child('codecall:audit');
          audit.subscribe((event) => logger.info(event.type, auditLogFields(event)));
          return audit;
        },
      },
      {
        name: 'codecall:tool-search',
        provide: ToolSearchService,
        inject: () => [ScopeEntry],
        useFactory: async (scope: ScopeEntry) => {
          return new ToolSearchService(
            {
              embeddingOptions: parsedOptions.embedding,
              defaultTopK: parsedOptions.topK,
              mode: parsedOptions.mode,
              includeTools: parsedOptions['includeTools'],
            },
            scope,
          );
        },
      },
    ];
  }

  /**
   * The CodeCall meta-tools. `codecall:search` and `codecall:execute` describe the `topK` and the
   * script limits these options give, since the model plans its calls from those descriptions.
   */
  static override dynamicTools(options: CodeCallPluginOptionsInput): ToolType[] {
    const config = new CodeCallConfig(codeCallPluginOptionsSchema.parse(options)).getAll();
    class ConfiguredSearchTool extends SearchTool {}
    class ConfiguredExecuteTool extends ExecuteTool {}
    Reflect.defineMetadata(
      FrontMcpToolTokens.description,
      buildSearchToolDescription(config.topK),
      ConfiguredSearchTool,
    );
    Reflect.defineMetadata(
      FrontMcpToolTokens.description,
      buildExecuteToolDescription(config.resolvedVm),
      ConfiguredExecuteTool,
    );
    return [
      ConfiguredSearchTool,
      SearchSkillsTool,
      SearchKnowledgeTool,
      DescribeTool,
      ConfiguredExecuteTool,
      InvokeTool,
    ];
  }

  /**
   * Hook into list_tools to enforce CodeCall modes:
   *
   * Modes:
   * - codecall_only: Hide all tools from list_tools except CodeCall meta-tools.
   *                  All other tools must be discovered via codecall:search.
   * - codecall_opt_in: Show tools in list_tools unless they set visibleInListTools: false. Tools opt-in to CodeCall via metadata.
   * - metadata_driven: Use per-tool metadata.codecall to control visibility in list_tools.
   *
   * CodeCall meta-tools (codecall:search, codecall:describe, codecall:execute, codecall:invoke)
   * are ALWAYS visible regardless of mode.
   *
   * List hooks run for every app's tools; each instance judges only the tools its direct-call gate judges.
   */
  @ListToolsHook.Did('resolveConflicts', { priority: 1000 })
  async adjustListTools(flowCtx: FlowCtxOf<'tools:list-tools'>) {
    const logger = this.getLogger();
    const { resolvedTools } = flowCtx.state;
    logger.verbose('adjustListTools hook called', { mode: this.options.mode });
    logger.verbose('adjustListTools: tools before filter', { count: resolvedTools?.length ?? 0 });

    if (!resolvedTools || resolvedTools.length === 0) {
      logger.verbose('adjustListTools: no tools to filter, returning early');
      return;
    }

    const scope = this.tryGetScope();
    const filteredTools = resolvedTools.filter(
      ({ tool }) => !this.judges(scope, { tool }) || this.shouldShowInListTools(tool, this.options.mode),
    );

    logger.verbose('adjustListTools: tools after filter', { count: filteredTools.length });

    // Update the state with filtered tools
    flowCtx.state.set('resolvedTools', filteredTools);
  }

  /**
   * Refuse a client's direct `tools/call` of a tool CodeCall hides from `tools/list` (#678).
   *
   * Such a tool is reached through CodeCall, which applies its policy (`includeTools`, the blocked
   * namespaces, `enabledInCodeCall`, `directCalls`). Hiding it from the listing is not access
   * control on its own: a client that knew the name called it directly, past that policy. The
   * refusal is the one an unknown tool gets, so it does not reveal that the tool exists.
   *
   * Calls dispatched in process still reach it: CodeCall's own (`codecall:execute`,
   * `codecall:invoke`) and a tool, agent or job composing with it through `this.callTool()`. The
   * server's own system tools (owned by the scope, e.g. `sendElicitationResult`), which clients are
   * told to call by name, are never refused. Runs as soon as the tool is found, where the SDK refuses
   * an `internal` tool, so nothing after it (input validation, authorization, a task, the approval
   * gate, a cache hit) can reveal the tool; and, like the listing, for the tools of every app that
   * has no CodeCall plugin of its own.
   */
  @ToolHook.Did('findTool', { priority: 10, appliesTo: 'uncovered-apps' })
  async refuseDirectCallOfHiddenTool(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    const { tool } = flowCtx.state;
    if (!tool || tool.owner?.kind === 'scope') return;
    if (this.isDirectlyCallable(tool)) return;
    if (isInProcessDispatch(callContextOf(flowCtx))) return;

    this.getLogger().verbose('refused a direct tools/call of a tool CodeCall hides', { tool: tool.fullName });
    throw new ToolNotFoundError(flowCtx.state.input?.name ?? tool.name);
  }

  /**
   * Whether a client may call the tool directly: it is listed, and a tool the SDK keeps out of `tools/list`
   * (`visibility: 'hidden'`) also opts in with `visibleInListTools: true`, in every mode.
   */
  private isDirectlyCallable(tool: ToolEntry<any, any, any, any>): boolean {
    if (!this.managesApp(tool)) return true;
    if (!this.shouldShowInListTools(tool, this.options.mode)) return false;
    if (resolveToolVisibility(tool.metadata) !== 'hidden') return true;
    return this.getCodeCallMetadata(tool)?.visibleInListTools === true;
  }

  /** Whether the tool's app is one `appIds` puts under `codecall_only`; every app is, without `appIds`. */
  private managesApp(tool: ToolEntry<any, any, any, any>): boolean {
    const managedAppIds = this.options.appIds;
    if (this.options.mode !== 'codecall_only' || !managedAppIds || managedAppIds.length === 0) return true;
    const toolOwnerAppId = tool.owner?.kind === 'app' ? tool.owner.id : undefined;
    return toolOwnerAppId !== undefined && managedAppIds.includes(toolOwnerAppId);
  }

  /** Whether this instance's direct-call gate runs for the tool, so the listing hides only what that gate refuses. */
  private judges(scope: ScopeEntry | undefined, entry: HookGatedEntry): boolean {
    return !scope?.hooks || isEntryGatedBy(scope, entry, this);
  }

  private tryGetScope(): ScopeEntry | undefined {
    try {
      return this.get(ScopeEntry) as ScopeEntry | undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Determine if a tool should be visible in list_tools based on mode.
   *
   * When `appIds` is configured, `codecall_only` mode only hides tools from
   * those specific apps — tools from other apps remain visible.
   *
   * @param tool - The tool entry to check
   * @param mode - The current CodeCall mode
   * @returns true if tool should be visible
   */

  private shouldShowInListTools(tool: ToolEntry<any, any, any, any>, mode: CodeCallMode): boolean {
    // CodeCall meta-tools are ALWAYS visible
    if (this.isCodeCallTool(tool)) {
      return true;
    }

    // Get tool's CodeCall metadata
    const codecallMeta = this.getCodeCallMetadata(tool);

    switch (mode) {
      case 'codecall_only':
        // Tools of apps outside appIds stay visible; otherwise only tools with visibleInListTools=true are shown
        return !this.managesApp(tool) || codecallMeta?.visibleInListTools === true;

      case 'codecall_opt_in':
      case 'metadata_driven':
        // Shown unless the tool sets visibleInListTools: false
        return codecallMeta?.visibleInListTools !== false;

      default:
        // Unknown mode - default to showing the tool (fail-open for UX)
        return true;
    }
  }

  /**
   * Check if a tool is a CodeCall meta-tool.
   * CodeCall meta-tools always remain visible.
   */

  private isCodeCallTool(tool: ToolEntry<any, any, any, any>): boolean {
    // Guard against missing/non-string names — tool entries from external
    // sources can have either field absent, and calling `.startsWith` on a
    // falsy value would throw inside the list_tools filter (taking down
    // the whole listing instead of returning false for this single tool).
    const name = tool.name || tool.fullName;
    return typeof name === 'string' && name.startsWith('codecall:');
  }

  /**
   * Extract CodeCall-specific metadata from a tool.
   */

  private getCodeCallMetadata(tool: ToolEntry<any, any, any, any>): CodeCallToolMetadata | undefined {
    return (tool.metadata as unknown as Record<string, unknown>)?.['codecall'] as CodeCallToolMetadata | undefined;
  }
}
