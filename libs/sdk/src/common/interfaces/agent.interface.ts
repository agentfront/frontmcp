import { ProviderRegistryInterface } from './internal';
import { ToolInputType, ToolOutputType, AgentMetadata, AgentType } from '../metadata';
import { FlowControl } from './flow.interface';
import { ExecutionContextBase, ExecutionContextBaseArgs } from './execution-context.interface';
import type { AIPlatformType, ClientInfo, McpLoggingLevel } from '../../notification';
import {
  AgentLlmAdapter,
  AgentPrompt,
  AgentToolDefinition,
  AgentCompletion,
  AgentCompletionChunk,
  AgentCompletionOptions,
  AgentToolCall,
} from './llm-adapter.interface';
import { AgentInputOf, AgentOutputOf } from '../decorators';
import { AgentExecutionLoop, ToolExecutor } from '../../agent/agent-execution-loop';
import { ElicitResult, ElicitOptions, performElicit } from '../../elicitation';
import { ZodType } from 'zod';

// Re-export AgentType for convenience (defined in agent.metadata.ts)
export { AgentType };

// ============================================================================
// Agent Context Arguments
// ============================================================================

/**
 * History entry for tracking input/output changes during execution.
 */
type HistoryEntry<T> = {
  at: number;
  stage?: string;
  value: T | undefined;
  note?: string;
};

/**
 * Constructor arguments for AgentContext.
 */
export type AgentCtorArgs<In> = ExecutionContextBaseArgs & {
  metadata: AgentMetadata;
  input: In;
  llmAdapter: AgentLlmAdapter;
  agentScope?: ProviderRegistryInterface;
  /** Tool definitions available to this agent */
  toolDefinitions?: AgentToolDefinition[];
  /** Function to execute tools - provided by AgentInstance */
  toolExecutor?: ToolExecutor;
  /** Progress token from the request's _meta, used for progress notifications */
  progressToken?: string | number;
};

// ============================================================================
// Agent Context Base Class
// ============================================================================

/**
 * Abstract base class for agent execution contexts.
 *
 * Agents are autonomous units with their own LLM provider, isolated scope,
 * and the ability to be invoked as tools by other agents or the parent app.
 *
 * Override the protected methods to customize agent behavior:
 * - `completion()` - Override for custom LLM completion logic
 * - `streamCompletion()` - Override for custom streaming logic
 * - `executeTool()` - Override for custom tool execution logic
 *
 * @example
 * ```typescript
 * // Default behavior - works automatically (no execute() needed!)
 * @Agent({
 *   name: 'research-agent',
 *   description: 'Researches topics',
 *   systemInstructions: 'You are a research assistant. Search and summarize topics.',
 *   llm: { adapter: 'openai', model: 'gpt-4-turbo', apiKey: { env: 'OPENAI_API_KEY' } },
 *   tools: [WebSearchTool],
 * })
 * export default class ResearchAgent extends AgentContext {}
 *
 * // Custom behavior - override execute() only when needed
 * @Agent({ ... })
 * export default class CustomAgent extends AgentContext {
 *   async execute(input: Input): Promise<Output> {
 *     // Custom pre-processing
 *     const result = await super.execute(input);  // Call default loop
 *     // Custom post-processing
 *     return result;
 *   }
 * }
 * ```
 */
export class AgentContext<
  InSchema extends ToolInputType = ToolInputType,
  OutSchema extends ToolOutputType = ToolOutputType,
  In = AgentInputOf<{ inputSchema: InSchema }>,
  Out = AgentOutputOf<{ outputSchema: OutSchema }>,
> extends ExecutionContextBase<Out> {
  protected readonly agentId: string;
  protected readonly agentName: string;
  readonly metadata: AgentMetadata;

  /** The LLM adapter for this agent */
  protected readonly llmAdapter: AgentLlmAdapter;

  /** Agent-scoped provider registry (if isolated scope is enabled) */
  protected readonly agentScope?: ProviderRegistryInterface;

  /** System instructions for the agent's LLM */
  protected readonly systemInstructions: string;

  /** Tool definitions available to this agent */
  protected readonly toolDefinitions: AgentToolDefinition[];

  /** Function to execute tools - provided by AgentInstance */
  protected readonly toolExecutor?: ToolExecutor;

  // ---- Internal fields for fallback elicitation support
  /** @internal Agent name for fallback elicitation - set by CallAgentFlow */
  _agentNameInternal?: string;
  /** @internal Agent input for fallback elicitation - set by CallAgentFlow */
  _agentInputInternal?: unknown;

  // ---- INPUT storages (backing fields)
  private _rawInput?: Partial<In> | any;
  private _input?: In;

  // ---- OUTPUT storages (backing fields)
  private _outputDraft?: Partial<Out> | any;
  private _output?: Out;

  // ---- histories
  private readonly _inputHistory: HistoryEntry<In>[] = [];
  private readonly _outputHistory: HistoryEntry<Out>[] = [];

  // ---- Progress token from request's _meta (for progress notifications)
  private readonly _progressToken?: string | number;

  constructor(args: AgentCtorArgs<In>) {
    const { metadata, input, providers, logger, llmAdapter, agentScope, toolDefinitions, toolExecutor, progressToken } =
      args;
    super({
      providers,
      logger: logger.child(`agent:${metadata.id ?? metadata.name}`),
      authInfo: args.authInfo,
    });
    this.agentName = metadata.name;
    this.agentId = metadata.id ?? metadata.name;
    this.metadata = metadata;
    this._input = input;
    this.llmAdapter = llmAdapter;
    this.agentScope = agentScope;
    this.systemInstructions = metadata.systemInstructions ?? '';
    this.toolDefinitions = toolDefinitions ?? [];
    this.toolExecutor = toolExecutor;
    this._progressToken = progressToken;
  }

  /**
   * Execute the agent with the given input.
   *
   * **Default behavior:** Runs the agent execution loop automatically:
   * - Sends input + system instructions to the LLM
   * - Executes tool calls as needed
   * - Sends notifications on tool calls and output
   * - Returns the final response
   *
   * **Override this method** only when you need custom behavior:
   * - Custom pre/post processing
   * - Custom response formatting
   * - Multi-step workflows
   *
   * @example
   * ```typescript
   * // Custom behavior - call super.execute() for default loop
   * async execute(input: Input): Promise<Output> {
   *   this.notify('Starting custom agent...', 'info');
   *   const result = await super.execute(input);
   *   return { ...result, customField: 'added' };
   * }
   * ```
   */
  async execute(input: In): Promise<Out> {
    return this.runAgentLoop(input);
  }

  /**
   * Run the agent execution loop.
   *
   * This is the default implementation that:
   * 1. Builds prompt from input + system instructions
   * 2. Sends to LLM with available tools
   * 3. Executes tool calls and loops until final response
   * 4. Sends notifications on tool calls and output
   */
  protected async runAgentLoop(input: In): Promise<Out> {
    // Build user message from input
    const userMessage = this.buildUserMessage(input);

    // Determine if auto progress is enabled
    const enableAutoProgress =
      this.metadata.execution?.enableAutoProgress === true && this.metadata.execution?.enableNotifications !== false;
    const maxIterations = this.metadata.execution?.maxIterations ?? 10;

    // Track progress state for monotonic updates
    let currentProgress = 0;

    // Create execution loop
    const loop = new AgentExecutionLoop({
      adapter: this.llmAdapter,
      systemInstructions: this.systemInstructions,
      tools: this.toolDefinitions,
      maxIterations,
      timeout: this.metadata.execution?.timeout ?? 120000,
      logger: this.logger,

      // Auto progress callbacks (only when enabled)
      onLlmStart: enableAutoProgress
        ? (iteration: number, maxIter: number) => {
            // Each iteration gets ~8% of progress (80% total for 10 iterations)
            currentProgress = Math.round(((iteration - 1) / maxIter) * 80);
            this.progress(currentProgress, 100, `Starting LLM call (iteration ${iteration}/${maxIter})`);
          }
        : undefined,

      onLlmComplete: enableAutoProgress
        ? (iteration: number, usage?: { promptTokens?: number; completionTokens?: number }) => {
            currentProgress = Math.round(((iteration - 0.5) / maxIterations) * 80);
            const usageStr = usage ? ` (${usage.promptTokens ?? 0}P + ${usage.completionTokens ?? 0}C tokens)` : '';
            this.progress(currentProgress, 100, `LLM response received${usageStr}`);
          }
        : undefined,

      onToolsIdentified: enableAutoProgress
        ? (count: number, names: string[]) => {
            this.notify(`Identified ${count} tool call(s): ${names.join(', ')}`, 'info');
          }
        : undefined,

      onToolStart: enableAutoProgress
        ? (toolCall: AgentToolCall, index: number, total: number) => {
            const toolProgress = currentProgress + Math.round(((index + 1) / total) * 10);
            this.progress(toolProgress, 100, `Executing tool ${index + 1}/${total}: ${toolCall.name}`);
          }
        : undefined,

      onComplete: enableAutoProgress
        ? (content: string | null, error?: Error) => {
            if (error) {
              this.progress(100, 100, `Agent failed: ${error.message}`);
            } else {
              this.progress(100, 100, 'Agent completed');
            }
          }
        : undefined,

      // Standard notification callbacks (always active when notifications enabled)
      onToolCall: (toolCall: AgentToolCall) => {
        if (this.metadata.execution?.enableNotifications !== false) {
          this.notify(`Calling tool: ${toolCall.name}`, 'info');
        }
        this.logger.debug(`Tool call: ${toolCall.name}`, { args: toolCall.arguments });
      },

      onToolResult: (toolCall: AgentToolCall, result: unknown, error?: Error) => {
        if (error) {
          if (this.metadata.execution?.enableNotifications !== false) {
            this.notify(`Tool ${toolCall.name} failed: ${error.message}`, 'error');
          }
          this.logger.error(`Tool ${toolCall.name} failed`, error);
        } else {
          this.logger.debug(`Tool ${toolCall.name} completed`, { result });
        }
      },

      onContent: (content: string) => {
        // Stream content as notifications if enabled
        if (this.metadata.execution?.enableNotifications !== false) {
          this.logger.debug(`Content received: ${content.slice(0, 100)}...`);
        }
      },
    });

    // Create tool executor that uses the provided executor or falls back to executeTool
    const executor: ToolExecutor = this.toolExecutor ?? (async (name, args) => this.executeTool(name, args));

    // Run the loop
    const result = await loop.run(userMessage, executor);

    if (!result.success && result.error) {
      throw result.error;
    }

    // Parse the LLM response as output
    return this.parseAgentResponse(result.content) as Out;
  }

  /**
   * Build the user message from input.
   * Override this to customize how input is formatted for the LLM.
   */
  protected buildUserMessage(input: In): string {
    if (typeof input === 'string') {
      return input;
    }
    // For object inputs, include the query/message/prompt field if present
    const inputObj = input as Record<string, unknown>;
    if (inputObj['query']) return String(inputObj['query']);
    if (inputObj['message']) return String(inputObj['message']);
    if (inputObj['prompt']) return String(inputObj['prompt']);
    if (inputObj['input']) return String(inputObj['input']);
    // Fallback: stringify the entire input
    return JSON.stringify(input);
  }

  /**
   * Parse the LLM response into the expected output format.
   * Override this to customize response parsing.
   */
  protected parseAgentResponse(content: string | null): Out {
    if (content === null) {
      return { response: '' } as Out;
    }

    // Try to parse as JSON if it looks like JSON
    if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
      try {
        return JSON.parse(content) as Out;
      } catch {
        // Not valid JSON, return as text response
      }
    }

    // Return as a simple response object
    return { response: content } as Out;
  }

  // ============================================================================
  // Input/Output Properties
  // ============================================================================

  public get input(): In {
    return this._input as In;
  }

  public set input(v: In | undefined) {
    this._input = v;
    this._inputHistory.push({
      at: Date.now(),
      stage: this.activeStage,
      value: v,
    });
  }

  public get inputHistory(): ReadonlyArray<HistoryEntry<In>> {
    return this._inputHistory;
  }

  public get output(): Out | undefined {
    return this._output;
  }

  public set output(v: Out | undefined) {
    this._output = v;
    this._outputHistory.push({ at: Date.now(), stage: this.activeStage, value: v });
  }

  public get outputHistory(): ReadonlyArray<HistoryEntry<Out>> {
    return this._outputHistory;
  }

  // ============================================================================
  // LLM Methods (Overridable)
  // ============================================================================

  /**
   * Generate a completion from the LLM.
   *
   * Override this method to add custom pre/post processing:
   *
   * @example
   * ```typescript
   * protected override async completion(prompt, tools, options) {
   *   console.log('Pre-processing...');
   *   const result = await super.completion(prompt, tools, options);
   *   console.log('Post-processing...');
   *   return result;
   * }
   * ```
   */
  protected async completion(
    prompt: AgentPrompt,
    tools?: AgentToolDefinition[],
    options?: AgentCompletionOptions,
  ): Promise<AgentCompletion> {
    return this.llmAdapter.completion(prompt, tools, options);
  }

  /**
   * Stream a completion from the LLM.
   *
   * Override this method to add custom streaming logic.
   */
  protected async *streamCompletion(
    prompt: AgentPrompt,
    tools?: AgentToolDefinition[],
    options?: AgentCompletionOptions,
  ): AsyncGenerator<AgentCompletionChunk> {
    if (!this.llmAdapter.streamCompletion) {
      // Fallback: wrap non-streaming completion as a single chunk
      const result = await this.completion(prompt, tools, options);
      yield { type: 'done', completion: result };
      return;
    }
    yield* this.llmAdapter.streamCompletion(prompt, tools, options);
  }

  /**
   * Execute a tool by name with the given arguments.
   *
   * Override this method to add custom tool execution logic:
   * - Logging
   * - Caching
   * - Error handling
   * - Tool call interception
   */
  protected async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    // This will be implemented by AgentInstance which has access to ToolRegistry
    throw new Error(`Tool execution not available. Tool: ${name}`);
  }

  /**
   * Invoke another agent by ID.
   *
   * Only available if `swarm.canSeeOtherAgents` is true or the target agent
   * is in `swarm.visibleAgents`.
   */
  protected async invokeAgent(agentId: string, input: unknown): Promise<unknown> {
    // This will be implemented by AgentInstance which has access to AgentRegistry
    throw new Error(`Agent invocation not available. Agent: ${agentId}`);
  }

  // ============================================================================
  // Notification Methods
  // ============================================================================

  /**
   * Send a notification message to the current session.
   * Uses 'notifications/message' per MCP 2025-11-25 spec.
   *
   * Use this to report progress during long-running operations.
   *
   * @param message - The notification message (string) or structured data (object)
   * @param level - Log level: 'debug', 'info', 'warning', or 'error' (default: 'info')
   * @returns true if the notification was sent, false if session unavailable
   *
   * @example
   * ```typescript
   * async execute(input: Input): Promise<Output> {
   *   await this.notify('Starting agent processing...', 'info');
   *   await this.notify({ step: 1, total: 5, status: 'in_progress' });
   *   // ... processing
   *   return result;
   * }
   * ```
   */
  protected async notify(message: string | Record<string, unknown>, level: McpLoggingLevel = 'info'): Promise<boolean> {
    // Log locally
    const logMessage = typeof message === 'string' ? message : JSON.stringify(message);
    if (level === 'error') {
      this.logger.error(logMessage);
    } else if (level === 'warning') {
      this.logger.warn(logMessage);
    } else {
      this.logger.info(logMessage);
    }

    // Send to client
    const sessionId = this.authInfo.sessionId;
    if (!sessionId) {
      return false;
    }

    const data = typeof message === 'string' ? { message } : message;
    return this.scope.notifications.sendLogMessageToSession(sessionId, level, this.agentName, data);
  }

  /**
   * Send a progress notification to the current session.
   * Uses 'notifications/progress' per MCP 2025-11-25 spec.
   *
   * Only works if the client requested progress updates by including a
   * progressToken in the request's _meta field. If no progressToken was
   * provided, this method logs a debug message and returns false.
   *
   * @param progress - Current progress value (should increase monotonically)
   * @param total - Total progress value (optional)
   * @param message - Progress message (optional)
   * @returns true if the notification was sent, false if no progressToken or session
   *
   * @example
   * ```typescript
   * async execute(input: Input): Promise<Output> {
   *   for (let i = 0; i < 10; i++) {
   *     await this.progress(i + 1, 10, `Step ${i + 1} of 10`);
   *     await doWork();
   *   }
   *   return result;
   * }
   * ```
   */
  protected async progress(progress: number, total?: number, message?: string): Promise<boolean> {
    if (!this._progressToken) {
      this.logger.debug('Cannot send progress: no progressToken in request');
      return false;
    }

    const sessionId = this.authInfo.sessionId;
    if (!sessionId) {
      this.logger.warn('Cannot send progress: no session ID');
      return false;
    }

    return this.scope.notifications.sendProgressNotification(sessionId, this._progressToken, progress, total, message);
  }

  /**
   * Request interactive input from the user during agent execution.
   *
   * Sends an elicitation request to the client for user input. The client
   * presents the message and a form (or URL) to collect user response.
   *
   * Only one elicit per session is allowed. A new elicit will cancel any pending one.
   * On timeout, an ElicitationTimeoutError is thrown to kill agent execution.
   *
   * For clients that don't support elicitation, the framework automatically handles
   * the fallback flow using the sendElicitationResult tool.
   *
   * @param message - Prompt message to display to user
   * @param requestedSchema - Zod schema defining expected input structure
   * @param options - Mode ('form'|'url'), ttl (default 5min), elicitationId (for URL mode)
   * @returns ElicitResult with status and typed content
   * @throws ElicitationNotSupportedError if client doesn't support elicitation and no fallback available
   * @throws ElicitationFallbackRequired (internal) triggers fallback flow for non-supporting clients
   * @throws ElicitationTimeoutError if request times out (kills execution)
   *
   * @example
   * ```typescript
   * async execute(input: Input): Promise<Output> {
   *   const result = await this.elicit('Confirm action?', z.object({
   *     confirmed: z.boolean(),
   *     reason: z.string().optional()
   *   }));
   *
   *   if (result.status !== 'accept') {
   *     return { cancelled: true };
   *   }
   *   // result.content is typed { confirmed: boolean, reason?: string }
   *   return { confirmed: result.content!.confirmed };
   * }
   * ```
   */
  protected async elicit<S extends ZodType>(
    message: string,
    requestedSchema: S,
    options?: ElicitOptions,
  ): Promise<ElicitResult<S extends ZodType<infer O> ? O : unknown>> {
    return performElicit(
      {
        sessionId: this.authInfo.sessionId,
        getClientCapabilities: (sid) => this.scope.notifications.getClientCapabilities(sid),
        tryGetContext: () => this.tryGetContext(),
        entryName: this._agentNameInternal ?? this.agentName,
        entryInput: this._agentInputInternal ?? this.input,
        elicitationEnabled: this.scope.metadata.elicitation?.enabled === true,
      },
      message,
      requestedSchema,
      options,
    );
  }

  /**
   * Respond with the final output and end execution.
   *
   * This sets the output and throws to exit the flow immediately.
   */
  respond(value: Out): never {
    this.output = value;
    FlowControl.respond<Out>(value);
  }

  // ============================================================================
  // Platform Detection API
  // ============================================================================

  /**
   * Get the detected AI platform type for the current session.
   */
  get platform(): AIPlatformType {
    const payloadPlatform = this.authInfo.sessionIdPayload?.platformType;
    if (payloadPlatform && payloadPlatform !== 'unknown') {
      return payloadPlatform;
    }
    const sessionId = this.authInfo.sessionId;
    if (!sessionId) {
      return 'unknown';
    }
    return this.scope.notifications.getPlatformType(sessionId);
  }

  /**
   * Get the client info (name and version) for the current session.
   */
  get clientInfo(): ClientInfo | undefined {
    const sessionId = this.authInfo.sessionId;
    if (!sessionId) {
      return undefined;
    }
    return this.scope.notifications.getClientInfo(sessionId);
  }
}
