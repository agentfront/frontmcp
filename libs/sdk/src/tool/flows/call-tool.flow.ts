// tools/flows/call-tool.flow.ts
import { randomUUID } from 'crypto';
import {
  Flow,
  FlowBase,
  FlowHooksOf,
  FlowPlan,
  FlowRunOptions,
  ToolContext,
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
  finalize: ['releaseSemaphore', 'releaseQuota', 'finalize'],
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

/**
 * Safely stringify a value, handling circular references and other edge cases.
 * This prevents tool calls from failing due to serialization errors.
 */
const safeStringify = (value: unknown, space?: number): string => {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      value,
      (_key, val) => {
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]';
          seen.add(val);
        }
        return val;
      },
      space,
    );
  } catch {
    return JSON.stringify({ error: 'Output could not be serialized' });
  }
};

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

  @Stage('finalize')
  async finalize() {
    this.logger.verbose('finalize:start');
    const { tool, rawOutput, input } = this.state;

    if (!tool) {
      this.logger.error('finalize: tool not found in state');
      throw new ToolExecutionError('unknown', new Error('Tool not found in state'));
    }

    if (rawOutput === undefined) {
      this.logger.error('finalize: tool output not found in state');
      throw new ToolExecutionError(tool.metadata.name, new Error('Tool output not found'));
    }

    // Parse and construct the MCP-compliant output using safeParseOutput
    const parseResult = tool.safeParseOutput(rawOutput);

    if (!parseResult.success) {
      // add support for request id in error messages
      this.logger.error('finalize: output validation failed', {
        tool: tool.metadata.name,
        errors: parseResult.error,
      });

      // Use InvalidOutputError, which hides internal details in production
      throw new InvalidOutputError();
    }

    const result = parseResult.data;

    // If tool has UI config, render and add to _meta
    if (hasUIConfig(tool.metadata)) {
      try {
        // Cast scope to Scope to access toolUI and notifications
        const scope = this.scope as Scope;

        // Get session info for platform detection from authInfo (already in state from parseInput)
        const { authInfo } = this.state;
        const sessionId = authInfo?.sessionId;
        const requestId: string = randomUUID();

        // Get platform type: first check sessionIdPayload (detected from user-agent),
        // then fall back to notification service (detected from MCP clientInfo),
        // finally default to 'openai'
        const platformType =
          authInfo?.sessionIdPayload?.platformType ??
          (sessionId ? scope.notifications.getPlatformType(sessionId) : undefined) ??
          'openai';

        // Get the serving mode (default to 'inline' for backward compatibility)
        const servingMode = tool.metadata.ui.servingMode ?? 'inline';

        if (servingMode === 'static') {
          // For static mode: return ONLY structured data
          // The static widget was already registered at server startup and advertised in tools/list
          // Widget reads tool output from platform context (e.g., window.openai.toolOutput)
          // NO UI _meta fields needed - the client uses the outputTemplate URI from tools/list

          // Return structured data as JSON text content
          result.content = [
            {
              type: 'text',
              text: safeStringify(rawOutput),
            },
          ];

          // Do NOT add any UI _meta fields - widget reads from platform context
          // The outputTemplate URI (ui://widget/{toolName}.html) was already provided in tools/list

          this.logger.verbose('finalize: UI using static mode (structured data only)', {
            tool: tool.metadata.name,
            platform: platformType,
            outputKeys:
              rawOutput && typeof rawOutput === 'object' && !Array.isArray(rawOutput) ? Object.keys(rawOutput) : [],
          });
        } else if (servingMode === 'hybrid') {
          // For hybrid mode: return structured data + transpiled component code
          // The hybrid shell (React runtime + renderer) was pre-compiled at server startup
          // and advertised via outputTemplate URI in tools/list.
          // The shell dynamically imports the component code from _meta['ui/component']
          // and renders it with toolOutput data from the platform context.

          // Build the component payload with transpiled code
          const componentPayload = scope.toolUI.buildHybridComponentPayload({
            toolName: tool.metadata.name,
            template: tool.metadata.ui.template,
            uiConfig: tool.metadata.ui,
          });

          // Return structured data as JSON text content
          result.content = [
            {
              type: 'text',
              text: safeStringify(rawOutput),
            },
          ];

          // Add component payload to _meta for the hybrid shell's dynamic renderer
          if (componentPayload) {
            result._meta = {
              ...result._meta,
              'ui/component': componentPayload,
              'ui/type': componentPayload.type,
            };
          }

          this.logger.verbose('finalize: UI using hybrid mode (structured data + component)', {
            tool: tool.metadata.name,
            platform: platformType,
            hasComponent: !!componentPayload,
            componentType: componentPayload?.type,
            componentHash: componentPayload?.hash,
            outputKeys:
              rawOutput && typeof rawOutput === 'object' && !Array.isArray(rawOutput) ? Object.keys(rawOutput) : [],
          });
        } else {
          // For inline mode (default): render HTML with data embedded in each response
          // Use async version to support React component templates via SSR
          const uiResult = await scope.toolUI.renderAndRegisterAsync({
            toolName: tool.metadata.name,
            requestId,
            input:
              input?.arguments && typeof input.arguments === 'object' && !Array.isArray(input.arguments)
                ? (input.arguments as Record<string, unknown>)
                : {},
            output: rawOutput,
            structuredContent: result.structuredContent,
            uiConfig: tool.metadata.ui,
            platformType,
          });

          // Merge UI metadata into result._meta
          result._meta = {
            ...result._meta,
            ...uiResult.meta,
          };

          // For platforms that support widgets (OpenAI, ext-apps), clear content since widget displays data
          // For Claude and other platforms, keep the text content as they don't support _meta UI fields
          const supportsWidgets = platformType === 'openai' || platformType === 'ext-apps';

          if (supportsWidgets) {
            // Clear content - widget will display from _meta['ui/html']
            result.content = [];
          } else {
            // For Claude and other platforms without widget support:
            // Return JSON data + HTML template as artifact hint
            const htmlContent = uiResult?.meta?.['ui/html'];

            if (htmlContent) {
              // Include HTML template as artifact hint for Claude
              // Claude can use this to create an HTML artifact for visual display
              result.content = [
                {
                  type: 'text',
                  text: `## Data\n\`\`\`json\n${safeStringify(
                    rawOutput,
                    2,
                  )}\n\`\`\`\n\n## Visual Template (for artifact rendering)\n\`\`\`html\n${htmlContent}\n\`\`\``,
                },
              ];
            } else {
              // Fallback: JSON only
              result.content = [
                {
                  type: 'text',
                  text: safeStringify(rawOutput, 2),
                },
              ];
            }
          }

          this.logger.verbose('finalize: UI metadata added (inline mode)', {
            tool: tool.metadata.name,
            platform: platformType,
            supportsWidgets,
            contentCleared: supportsWidgets,
            htmlHintIncluded: !supportsWidgets && !!uiResult?.meta?.['ui/html'],
          });
        }
      } catch (error) {
        // UI rendering failure should not fail the tool call
        // Log with full context to help debugging
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        const uiConfig = tool.metadata.ui;

        this.logger.error('finalize: UI rendering failed', {
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
          hasStructuredContent: result.structuredContent !== undefined,
          structuredContentKeys:
            result.structuredContent &&
            typeof result.structuredContent === 'object' &&
            result.structuredContent !== null &&
            !Array.isArray(result.structuredContent)
              ? Object.keys(result.structuredContent)
              : [],
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
