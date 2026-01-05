// tools/flows/call-tool.flow.ts
import { randomUUID } from '@frontmcp/utils';
import {
  Flow,
  FlowBase,
  FlowHooksOf,
  FlowPlan,
  FlowRunOptions,
  ToolContext,
  ToolCtorArgs,
  ToolEntry,
  isOrchestratedMode,
} from '../../common';
import { z } from 'zod';
import { CallToolRequestSchema, CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  InvalidMethodError,
  ToolNotFoundError,
  InvalidInputError,
  InvalidOutputError,
  ToolExecutionError,
  AuthorizationRequiredError,
} from '../../errors';
import { hasUIConfig } from '../ui';
import { Scope } from '../../scope';
import { resolveServingMode, buildToolResponseContent, type ToolResponseContent } from '@frontmcp/uipack/adapters';
import { isUIRenderFailure } from '@frontmcp/uipack/registry';

const inputSchema = z.object({
  request: CallToolRequestSchema,
  // z.any() used because ctx is the MCP SDK's ToolCallExtra type which varies by SDK version
  ctx: z.any(),
});

const outputSchema = CallToolResultSchema;

const stateSchema = z.object({
  input: z.looseObject({
    name: z.string().min(1).max(64),
    arguments: z.looseObject({}).optional(),
  }),
  authInfo: z.any().optional() as z.ZodType<AuthInfo>,
  tool: z.instanceof(ToolEntry),
  toolContext: z.instanceof(ToolContext),
  // Store the raw executed output for plugins to see
  rawOutput: z.any().optional(),
  output: outputSchema,
  // Tool owner ID for hook filtering (set during parseInput)
  _toolOwnerId: z.string().optional(),
  // UI result from applyUI stage (if UI config exists)
  uiResult: z.any().optional() as z.ZodType<ToolResponseContent | undefined>,
  // UI metadata from rendering (merged into _meta)
  uiMeta: z.record(z.string(), z.unknown()).optional(),
});

const plan = {
  pre: [
    'parseInput',
    'findTool',
    'checkToolAuthorization',
    'createToolCallContext',
    'acquireQuota',
    'acquireSemaphore',
  ],
  execute: ['validateInput', 'execute', 'validateOutput'],
  finalize: ['releaseSemaphore', 'releaseQuota', 'applyUI', 'finalize'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'tools:call-tool': FlowRunOptions<
      CallToolFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'tools:call-tool' as const;
const { Stage } = FlowHooksOf<'tools:call-tool'>(name);

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class CallToolFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('CallToolFlow');

  @Stage('parseInput')
  async parseInput() {
    this.logger.verbose('parseInput:start');

    let method!: string;
    // NOTE: `any` is intentional - Zod parsing validates these values
    // Using unknown would require redundant type guards after schema validation
    let params: any;
    let ctx: any;
    try {
      const inputData = inputSchema.parse(this.rawInput);
      method = inputData.request.method;
      params = inputData.request.params;
      ctx = inputData.ctx;
    } catch (e) {
      throw new InvalidInputError('Invalid Input', e instanceof z.ZodError ? e.issues : undefined);
    }

    if (method !== 'tools/call') {
      this.logger.warn(`parseInput: invalid method "${method}"`);
      throw new InvalidMethodError(method, 'tools/call');
    }

    // Find the tool early to get its owner ID for hook filtering
    const { name } = params;
    const activeTools = this.scope.tools.getTools(true);
    const tool = activeTools.find((entry) => {
      return entry.fullName === name || entry.name === name;
    });

    // Store tool owner ID in state for hook filtering
    const toolOwnerId = tool?.owner?.id;

    this.state.set({ input: params, authInfo: ctx.authInfo, _toolOwnerId: toolOwnerId });
    this.logger.verbose('parseInput:done');
  }

  @Stage('findTool')
  async findTool() {
    this.logger.verbose('findTool:start');
    // TODO: add support for session based tools
    const activeTools = this.scope.tools.getTools(true);
    this.logger.info(`findTool: discovered ${activeTools.length} active tool(s) (including hidden)`);

    const { name } = this.state.required.input;
    // Agent invocations (use-agent:*) are routed to agents:call-agent flow
    // by the call-tool-request handler, so they won't reach here
    const tool = activeTools.find((entry) => {
      return entry.fullName === name || entry.name === name;
    });

    if (!tool) {
      this.logger.warn(`findTool: tool "${name}" not found`);
      throw new ToolNotFoundError(name);
    }

    this.logger = this.logger.child(`CallToolFlow(${name})`);
    this.state.set('tool', tool);
    this.logger.info(`findTool: tool "${name}" found`);
    this.logger.verbose('findTool:done');
  }

  /**
   * Check if the tool's parent app is authorized.
   * For progressive authorization, tools from unauthorized apps
   * return an AuthorizationRequiredError with an auth_url.
   */
  @Stage('checkToolAuthorization')
  async checkToolAuthorization() {
    this.logger.verbose('checkToolAuthorization:start');
    const { tool, authInfo } = this.state;

    // Get authorization from authInfo.extra if available
    const authorization = authInfo?.extra?.['authorization'] as
      | {
          authorizedAppIds?: string[];
          authorizedApps?: Record<string, unknown>;
        }
      | undefined;

    // No auth context = public mode, skip authorization check
    if (!authorization) {
      this.logger.verbose('checkToolAuthorization:skip (no auth context)');
      return;
    }

    // Get app ID from tool owner (uses existing lineage system)
    const appId = tool?.owner?.id;
    if (!appId) {
      // Tool has no owner = global tool, skip app-level authorization check
      this.logger.verbose('checkToolAuthorization:skip (no owner)');
      return;
    }

    // Check if app is authorized using existing session structure
    const isAppAuthorized =
      authorization.authorizedAppIds?.includes(appId) || appId in (authorization.authorizedApps || {});

    if (!isAppAuthorized) {
      // Get incremental auth configuration from scope's auth options
      const apps = this.scope.apps.getApps();
      const app = apps.find((a) => a.metadata.id === appId);
      const authOptions = this.scope.auth?.options;

      // Determine skippedAppBehavior:
      // 1. Only applies in orchestrated mode with incrementalAuth configured
      // 2. Default to 'anonymous' if not configured (allow anonymous fallback)
      let skippedBehavior: 'anonymous' | 'require-auth' = 'anonymous';

      if (authOptions && isOrchestratedMode(authOptions)) {
        // Orchestrated mode - check incrementalAuth config
        const incrementalConfig = authOptions.incrementalAuth;
        if (incrementalConfig) {
          // If incremental auth is disabled, always require auth
          if (incrementalConfig.enabled === false) {
            skippedBehavior = 'require-auth';
          } else {
            skippedBehavior = incrementalConfig.skippedAppBehavior || 'anonymous';
          }
        }
        // If incrementalAuth not configured, default is enabled with 'anonymous' behavior
      }
      // For public/transparent modes, default 'anonymous' behavior applies

      if (skippedBehavior === 'anonymous' && app?.metadata?.auth?.mode === 'public') {
        // App supports anonymous - continue with anonymous access
        this.logger.verbose(`checkToolAuthorization: using anonymous for ${appId}`);
        return;
      }

      // Require explicit authorization - build auth URL
      const authUrl = this.buildProgressiveAuthUrl(appId, tool?.fullName || '');

      this.logger.info(`checkToolAuthorization: authorization required for app "${appId}"`);
      throw new AuthorizationRequiredError({
        appId,
        toolId: tool?.fullName || tool?.name || 'unknown',
        authUrl,
        message: `Authorization required for ${appId}. Please authorize to use ${tool?.fullName || tool?.name}.`,
      });
    }

    this.logger.verbose('checkToolAuthorization:done');
  }

  /**
   * Build the URL for progressive/incremental authorization
   */
  private buildProgressiveAuthUrl(appId: string, toolId: string): string {
    const baseUrl = this.scope.fullPath || '';
    return `${baseUrl}/oauth/authorize?app=${encodeURIComponent(appId)}&tool=${encodeURIComponent(toolId)}`;
  }

  @Stage('createToolCallContext')
  async createToolCallContext() {
    this.logger.verbose('createToolCallContext:start');
    const { ctx } = this.input;
    const { tool, input } = this.state.required;

    try {
      const context = tool.create(input.arguments, ctx);
      const toolHooks = this.scope.hooks.getClsHooks(tool.record.provide).map((hook) => {
        hook.run = async () => {
          return context[hook.metadata.method]();
        };
        return hook;
      });

      this.appendContextHooks(toolHooks);
      context.mark('createToolCallContext');
      this.state.set('toolContext', context);
      this.logger.verbose('createToolCallContext:done');
    } catch (error) {
      this.logger.error('createToolCallContext: failed to create context', error);
      throw new ToolExecutionError(tool.metadata.name, error instanceof Error ? error : undefined);
    }
  }

  @Stage('acquireQuota')
  async acquireQuota() {
    this.logger.verbose('acquireQuota:start');
    // used for rate limiting
    this.state.toolContext?.mark('acquireQuota');
    this.logger.verbose('acquireQuota:done');
  }

  @Stage('acquireSemaphore')
  async acquireSemaphore() {
    this.logger.verbose('acquireSemaphore:start');
    // used for concurrency control
    this.state.toolContext?.mark('acquireSemaphore');
    this.logger.verbose('acquireSemaphore:done');
  }

  @Stage('validateInput')
  async validateInput() {
    this.logger.verbose('validateInput:start');
    const { tool, input } = this.state.required;
    const { toolContext } = this.state;
    if (!toolContext) {
      return;
    }
    toolContext.mark('validateInput');

    try {
      toolContext.input = tool.parseInput(input);
      this.logger.verbose('validateInput:done');
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new InvalidInputError('Invalid tool input', err.issues);
      }

      this.logger.error('validateInput: failed to parse input', err);
      throw new InvalidInputError('Unknown error occurred when trying to parse input');
    }
  }

  @Stage('execute')
  async execute() {
    this.logger.verbose('execute:start');
    const toolContext = this.state.toolContext;
    if (!toolContext) {
      return;
    }
    toolContext.mark('execute');

    try {
      toolContext.output = await toolContext.execute(toolContext.input);
      this.logger.verbose('execute:done');
    } catch (error) {
      this.logger.error('execute: tool execution failed', error);
      throw new ToolExecutionError(
        this.state.tool?.metadata.name || 'unknown',
        error instanceof Error ? error : undefined,
      );
    }
  }

  @Stage('validateOutput')
  async validateOutput() {
    this.logger.verbose('validateOutput:start');
    const { toolContext } = this.state;
    if (!toolContext) {
      return;
    }
    toolContext.mark('validateOutput');

    // Store the RAW output for plugins (cache, PII, etc.) to inspect
    this.state.set('rawOutput', toolContext.output);

    this.logger.verbose('validateOutput:done');
  }

  @Stage('releaseSemaphore')
  async releaseSemaphore() {
    this.logger.verbose('releaseSemaphore:start');
    // release concurrency control
    this.state.toolContext?.mark('releaseSemaphore');
    this.logger.verbose('releaseSemaphore:done');
  }

  @Stage('releaseQuota')
  async releaseQuota() {
    this.logger.verbose('releaseQuota:start');
    // release rate limiting
    this.state.toolContext?.mark('releaseQuota');
    this.logger.verbose('releaseQuota:done');
  }

  /**
   * Apply UI rendering to the tool response.
   * This stage handles all UI-related logic including platform detection,
   * serving mode resolution, and content formatting.
   */
  @Stage('applyUI')
  async applyUI() {
    this.logger.verbose('applyUI:start');
    const { tool, rawOutput, input } = this.state;

    // Skip UI for agent tool calls (structured data only)
    const ctx = this.input.ctx;
    if (ctx?._skipUI) {
      this.logger.verbose('applyUI:skip (agent context - structured data only)');
      return;
    }

    // Skip if no tool or no UI config
    if (!tool || !hasUIConfig(tool.metadata)) {
      this.logger.verbose('applyUI:skip (no UI config)');
      return;
    }

    try {
      // Cast scope to Scope to access toolUI and notifications
      const scope = this.scope as Scope;

      // Get session info for platform detection from authInfo (already in state from parseInput)
      const { authInfo } = this.state;
      const sessionId = authInfo?.sessionId;
      const requestId: string = randomUUID();

      // Get platform type: first check sessionIdPayload (detected from user-agent),
      // then fall back to notification service (detected from MCP clientInfo),
      // finally default to 'unknown' (conservative: skip UI for unknown clients)
      const platformType =
        authInfo?.sessionIdPayload?.platformType ??
        (sessionId ? scope.notifications.getPlatformType(sessionId) : undefined) ??
        'unknown';

      // Resolve the effective serving mode based on configuration and client capabilities
      // Default is 'auto' which selects the best mode for the platform
      const configuredMode = tool.metadata.ui.servingMode ?? 'auto';
      const resolvedMode = resolveServingMode({
        configuredMode,
        platformType,
      });

      // If client doesn't support UI (e.g., Gemini, unknown, or forced mode not available)
      // skip UI rendering entirely
      if (!resolvedMode.supportsUI || resolvedMode.effectiveMode === null) {
        this.logger.verbose('applyUI: Skipping UI (client does not support it)', {
          tool: tool.metadata.name,
          platform: platformType,
          configuredMode,
          reason: resolvedMode.reason,
        });
        return;
      }

      const servingMode = resolvedMode.effectiveMode;
      const useStructuredContent = resolvedMode.useStructuredContent;
      let htmlContent: string | undefined;
      let uiMeta: Record<string, unknown> = {};

      if (servingMode === 'static') {
        // For static mode: no additional rendering needed
        // Widget was already registered at server startup
        this.logger.verbose('applyUI: UI using static mode (structured data only)', {
          tool: tool.metadata.name,
          platform: platformType,
        });
      } else if (servingMode === 'hybrid') {
        // For hybrid mode: build the component payload
        const componentPayload = scope.toolUI.buildHybridComponentPayload({
          toolName: tool.metadata.name,
          template: tool.metadata.ui.template,
          uiConfig: tool.metadata.ui,
        });

        if (componentPayload) {
          uiMeta = {
            'ui/component': componentPayload,
            'ui/type': componentPayload.type,
          };
        }

        this.logger.verbose('applyUI: UI using hybrid mode (structured data + component)', {
          tool: tool.metadata.name,
          platform: platformType,
          hasComponent: !!componentPayload,
          componentType: componentPayload?.type,
          componentHash: componentPayload?.hash,
        });
      } else {
        // For inline mode (default): render HTML with data embedded
        const uiRenderResult = await scope.toolUI.renderAndRegisterAsync({
          toolName: tool.metadata.name,
          requestId,
          input:
            input?.arguments && typeof input.arguments === 'object' && !Array.isArray(input.arguments)
              ? (input.arguments as Record<string, unknown>)
              : {},
          output: rawOutput,
          structuredContent: undefined,
          uiConfig: tool.metadata.ui,
          platformType,
        });

        // Handle graceful degradation: rendering failed in production
        if (isUIRenderFailure(uiRenderResult)) {
          this.logger.warn('applyUI: UI rendering failed (graceful degradation)', {
            tool: tool.metadata.name,
            reason: uiRenderResult.reason,
            platform: platformType,
          });
          // Proceed without UI - tool result will not have ui/html metadata
          htmlContent = undefined;
          uiMeta = {};
        } else {
          // Extract HTML from platform-specific meta key
          const htmlKey =
            platformType === 'openai' ? 'openai/html' : platformType === 'ext-apps' ? 'ui/html' : 'frontmcp/html';
          htmlContent = uiRenderResult?.meta?.[htmlKey] as string | undefined;
          // Fallback to ui/html for compatibility
          if (!htmlContent) {
            htmlContent = uiRenderResult?.meta?.['ui/html'] as string | undefined;
          }
          uiMeta = uiRenderResult.meta || {};
        }
      }

      // Build the response content using the extracted utility
      const uiResult = buildToolResponseContent({
        rawOutput,
        htmlContent,
        servingMode,
        useStructuredContent,
        platformType,
      });

      // Store UI result and metadata in state for finalize stage
      this.state.set('uiResult', uiResult);
      this.state.set('uiMeta', uiMeta);

      this.logger.verbose('applyUI: UI processed', {
        tool: tool.metadata.name,
        platform: platformType,
        servingMode,
        useStructuredContent,
        format: uiResult.format,
        contentCleared: uiResult.contentCleared,
      });
    } catch (error) {
      // UI rendering failure should not fail the tool call
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const uiConfig = tool.metadata.ui;

      this.logger.error('applyUI: UI rendering failed', {
        tool: tool.metadata.name,
        error: errorMessage,
        stack: errorStack,
        templateType: uiConfig?.template
          ? typeof uiConfig.template === 'function'
            ? 'react-component'
            : typeof uiConfig.template === 'string'
            ? uiConfig.template.endsWith('.tsx') || uiConfig.template.endsWith('.jsx')
              ? 'react-file'
              : 'html-file'
            : 'unknown'
          : 'none',
      });

      // In debug mode, also log to console for immediate visibility
      if (process.env['DEBUG'] || process.env['NODE_ENV'] === 'development') {
        console.error('[FrontMCP] UI Rendering Error:', {
          tool: tool.metadata.name,
          error: errorMessage,
          stack: errorStack,
        });
      }
    }

    this.logger.verbose('applyUI:done');
  }

  /**
   * Finalize the tool response.
   * Validates output, applies UI result from applyUI stage, and sends the response.
   *
   * Note: This stage runs even when execute fails (as part of cleanup).
   * If rawOutput is undefined, it means an error occurred during execution
   * and the error will be propagated by the flow framework - we should not
   * throw a new error here.
   */
  @Stage('finalize')
  async finalize() {
    this.logger.verbose('finalize:start');
    const { tool, rawOutput, uiResult, uiMeta } = this.state;

    if (!tool) {
      // No tool found - this is an early failure, just skip finalization
      this.logger.verbose('finalize: skipping (no tool in state)');
      return;
    }

    if (rawOutput === undefined) {
      // No output means execute stage failed - skip finalization
      // The original error will be propagated by the flow framework
      this.logger.verbose('finalize: skipping (no output - execute stage likely failed)');
      return;
    }

    // Parse and construct the MCP-compliant output using safeParseOutput
    const parseResult = tool.safeParseOutput(rawOutput);

    if (!parseResult.success) {
      this.logger.error('finalize: output validation failed', {
        tool: tool.metadata.name,
        errors: parseResult.error,
      });
      throw new InvalidOutputError();
    }

    const result = parseResult.data;

    // Preserve any _meta from rawOutput (e.g., cache plugin adds cache: 'hit')
    const rawMeta = (rawOutput as Record<string, unknown>)?.['_meta'] as Record<string, unknown> | undefined;
    if (rawMeta) {
      result._meta = { ...result._meta, ...rawMeta };
    }

    // Apply UI result if available (from applyUI stage)
    if (uiResult) {
      result.content = uiResult.content;
      // Set structuredContent from UI result (contains raw tool output)
      // Cast to Record<string, unknown> since MCP protocol expects object type
      if (uiResult.structuredContent !== undefined && uiResult.structuredContent !== null) {
        result.structuredContent = uiResult.structuredContent as Record<string, unknown>;
      }
      if (uiMeta) {
        result._meta = { ...result._meta, ...uiMeta };
      }
    }

    // Log the final result being sent
    this.logger.info('finalize: sending response', {
      tool: tool.metadata.name,
      hasContent: Array.isArray(result.content) && result.content.length > 0,
      contentLength: Array.isArray(result.content) ? result.content.length : 0,
      hasStructuredContent: result.structuredContent !== undefined,
      hasMeta: result._meta !== undefined,
      metaKeys: result._meta ? Object.keys(result._meta) : [],
      isError: result.isError,
    });

    // Respond with the properly formatted MCP result
    this.respond(result);
    this.logger.verbose('finalize:done');
  }
}
