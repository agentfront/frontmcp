// file: libs/sdk/src/agent/agent-execution-loop.ts

import {
  AgentLlmAdapter,
  AgentPrompt,
  AgentMessage,
  AgentToolDefinition,
  AgentToolCall,
  AgentCompletion,
  AgentCompletionOptions,
  supportsStreaming,
  FrontMcpLogger,
} from '../common';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for the agent execution loop.
 */
export interface AgentExecutionLoopConfig {
  /**
   * LLM adapter for making completions.
   */
  adapter: AgentLlmAdapter;

  /**
   * System instructions for the agent.
   */
  systemInstructions: string;

  /**
   * Available tools for the agent to use.
   */
  tools: AgentToolDefinition[];

  /**
   * Maximum number of iterations (tool call rounds).
   * @default 10
   */
  maxIterations?: number;

  /**
   * Timeout for the entire execution in milliseconds.
   * @default 120000 (2 minutes)
   */
  timeout?: number;

  /**
   * Completion options (temperature, maxTokens, etc.).
   */
  completionOptions?: AgentCompletionOptions;

  /**
   * Logger for debugging.
   */
  logger?: FrontMcpLogger;

  /**
   * Callback when a tool call is made.
   */
  onToolCall?: (toolCall: AgentToolCall) => void;

  /**
   * Callback when a tool result is received.
   */
  onToolResult?: (toolCall: AgentToolCall, result: unknown, error?: Error) => void;

  /**
   * Callback for streaming content.
   */
  onContent?: (content: string) => void;

  /**
   * Callback for each iteration.
   */
  onIteration?: (iteration: number, message: AgentMessage) => void;

  /**
   * Callback when LLM request starts.
   */
  onLlmStart?: (iteration: number, maxIterations: number) => void;

  /**
   * Callback when LLM response is received (with usage stats).
   */
  onLlmComplete?: (iteration: number, usage?: { promptTokens?: number; completionTokens?: number }) => void;

  /**
   * Callback when tool calls are extracted from LLM response.
   */
  onToolsIdentified?: (count: number, names: string[]) => void;

  /**
   * Callback before a tool starts execution.
   */
  onToolStart?: (toolCall: AgentToolCall, index: number, total: number) => void;

  /**
   * Callback when agent execution is complete.
   */
  onComplete?: (content: string | null, error?: Error) => void;
}

/**
 * Result of an agent execution.
 */
export interface AgentExecutionResult {
  /**
   * Final response content from the agent.
   */
  content: string | null;

  /**
   * All messages in the conversation.
   */
  messages: AgentMessage[];

  /**
   * Number of iterations (tool call rounds) performed.
   */
  iterations: number;

  /**
   * Total token usage.
   */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens?: number;
  };

  /**
   * Whether the execution completed successfully.
   */
  success: boolean;

  /**
   * Error if execution failed.
   */
  error?: Error;

  /**
   * Duration in milliseconds.
   */
  durationMs: number;
}

/**
 * Handler function for executing tools.
 */
export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<unknown>;

// ============================================================================
// Execution Loop
// ============================================================================

/**
 * Agent execution loop for processing LLM interactions.
 *
 * The loop:
 * 1. Sends the current prompt to the LLM
 * 2. Processes tool calls if any
 * 3. Adds tool results to the conversation
 * 4. Repeats until the LLM responds with text or max iterations
 *
 * @example
 * ```typescript
 * const loop = new AgentExecutionLoop({
 *   adapter: myLlmAdapter,
 *   systemInstructions: 'You are a helpful assistant.',
 *   tools: [searchTool, calculateTool],
 * });
 *
 * const result = await loop.run(
 *   'What is the weather in Paris?',
 *   async (name, args) => {
 *     // Execute the tool and return result
 *     return toolRegistry.execute(name, args);
 *   },
 * );
 *
 * console.log(result.content);
 * ```
 */
export class AgentExecutionLoop {
  private readonly config: Required<Pick<AgentExecutionLoopConfig, 'maxIterations' | 'timeout'>> &
    AgentExecutionLoopConfig;

  constructor(config: AgentExecutionLoopConfig) {
    this.config = {
      maxIterations: 10,
      timeout: 120000,
      ...config,
    };
  }

  /**
   * Run the execution loop with a user message.
   *
   * @param userMessage - The user's input message
   * @param toolExecutor - Function to execute tools
   * @param existingMessages - Optional existing conversation history
   * @returns Execution result
   */
  async run(
    userMessage: string,
    toolExecutor: ToolExecutor,
    existingMessages: AgentMessage[] = [],
  ): Promise<AgentExecutionResult> {
    const startTime = Date.now();
    const messages: AgentMessage[] = [...existingMessages, { role: 'user', content: userMessage }];

    let iterations = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    try {
      // Set up timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Agent execution timed out after ${this.config.timeout}ms`)),
          this.config.timeout,
        );
      });

      // Run the loop with timeout
      const result = await Promise.race([
        this.executeLoop(messages, toolExecutor, {
          onIteration: (iter, msg) => {
            iterations = iter;
            this.config.onIteration?.(iter, msg);
          },
          onUsage: (prompt, completion) => {
            totalPromptTokens += prompt;
            totalCompletionTokens += completion;
          },
        }),
        timeoutPromise,
      ]);

      return {
        content: result.content,
        messages,
        iterations,
        usage: {
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          totalTokens: totalPromptTokens + totalCompletionTokens,
        },
        success: true,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        content: null,
        messages,
        iterations,
        usage: {
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          totalTokens: totalPromptTokens + totalCompletionTokens,
        },
        success: false,
        error: error as Error,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Run the execution loop with streaming.
   *
   * @param userMessage - The user's input message
   * @param toolExecutor - Function to execute tools
   * @param existingMessages - Optional existing conversation history
   * @returns AsyncGenerator yielding chunks and final result
   */
  async *runStreaming(
    userMessage: string,
    toolExecutor: ToolExecutor,
    existingMessages: AgentMessage[] = [],
  ): AsyncGenerator<AgentStreamEvent> {
    const startTime = Date.now();
    const messages: AgentMessage[] = [...existingMessages, { role: 'user', content: userMessage }];

    let iterations = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    try {
      for await (const event of this.executeLoopStreaming(messages, toolExecutor)) {
        if (event.type === 'iteration') {
          iterations = event.iteration;
        }
        if (event.type === 'usage') {
          totalPromptTokens += event.promptTokens;
          totalCompletionTokens += event.completionTokens;
        }
        yield event;
      }

      // Yield final result
      const lastAssistantMessage = [...messages].reverse().find((m) => m.role === 'assistant' && m.content);

      yield {
        type: 'done',
        result: {
          content: lastAssistantMessage?.content ?? null,
          messages,
          iterations,
          usage: {
            promptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens,
            totalTokens: totalPromptTokens + totalCompletionTokens,
          },
          success: true,
          durationMs: Date.now() - startTime,
        },
      };
    } catch (error) {
      yield {
        type: 'error',
        error: error as Error,
      };

      yield {
        type: 'done',
        result: {
          content: null,
          messages,
          iterations,
          usage: {
            promptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens,
            totalTokens: totalPromptTokens + totalCompletionTokens,
          },
          success: false,
          error: error as Error,
          durationMs: Date.now() - startTime,
        },
      };
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async executeLoop(
    messages: AgentMessage[],
    toolExecutor: ToolExecutor,
    callbacks: {
      onIteration: (iteration: number, message: AgentMessage) => void;
      onUsage: (promptTokens: number, completionTokens: number) => void;
    },
  ): Promise<{ content: string | null }> {
    for (let iteration = 1; iteration <= this.config.maxIterations; iteration++) {
      this.config.logger?.debug(`Agent loop iteration ${iteration}/${this.config.maxIterations}`);

      // Notify LLM start
      this.config.onLlmStart?.(iteration, this.config.maxIterations);

      // Build prompt
      const prompt: AgentPrompt = {
        system: this.config.systemInstructions,
        messages,
      };

      // Call LLM
      const completion = await this.config.adapter.completion(
        prompt,
        this.config.tools.length > 0 ? this.config.tools : undefined,
        this.config.completionOptions,
      );

      // Notify LLM complete with usage
      this.config.onLlmComplete?.(iteration, completion.usage);

      // Track usage
      if (completion.usage) {
        callbacks.onUsage(completion.usage.promptTokens, completion.usage.completionTokens);
      }

      // Process response
      if (completion.finishReason === 'tool_calls' && completion.toolCalls?.length) {
        // Notify tool calls identified
        this.config.onToolsIdentified?.(
          completion.toolCalls.length,
          completion.toolCalls.map((tc) => tc.name),
        );

        // Add assistant message with tool calls
        const assistantMessage: AgentMessage = {
          role: 'assistant',
          content: completion.content,
          toolCalls: completion.toolCalls,
        };
        messages.push(assistantMessage);
        callbacks.onIteration(iteration, assistantMessage);

        // Execute tool calls
        const totalTools = completion.toolCalls.length;
        for (let toolIndex = 0; toolIndex < totalTools; toolIndex++) {
          const toolCall = completion.toolCalls[toolIndex];
          this.config.onToolStart?.(toolCall, toolIndex, totalTools);
          this.config.onToolCall?.(toolCall);

          let result: unknown;
          let error: Error | undefined;

          try {
            result = await toolExecutor(toolCall.name, toolCall.arguments);
          } catch (e) {
            error = e as Error;
            result = { error: error.message };
          }

          this.config.onToolResult?.(toolCall, result, error);

          // Add tool result message
          const toolMessage: AgentMessage = {
            role: 'tool',
            content: typeof result === 'string' ? result : JSON.stringify(result),
            toolCallId: toolCall.id,
            name: toolCall.name,
          };
          messages.push(toolMessage);
        }
      } else {
        // Final response - add to messages and return
        const assistantMessage: AgentMessage = {
          role: 'assistant',
          content: completion.content,
        };
        messages.push(assistantMessage);
        callbacks.onIteration(iteration, assistantMessage);

        this.config.onContent?.(completion.content ?? '');
        this.config.onComplete?.(completion.content, undefined);

        return { content: completion.content };
      }
    }

    // Max iterations reached
    const error = new AgentMaxIterationsError(
      `Agent reached maximum iterations (${this.config.maxIterations}) without completing`,
      this.config.maxIterations,
    );
    this.config.onComplete?.(null, error);
    throw error;
  }

  private async *executeLoopStreaming(
    messages: AgentMessage[],
    toolExecutor: ToolExecutor,
  ): AsyncGenerator<AgentStreamEvent> {
    const adapter = this.config.adapter;

    for (let iteration = 1; iteration <= this.config.maxIterations; iteration++) {
      this.config.logger?.debug(`Agent loop iteration ${iteration}/${this.config.maxIterations}`);

      // Notify LLM start
      this.config.onLlmStart?.(iteration, this.config.maxIterations);

      yield { type: 'iteration', iteration };

      // Build prompt
      const prompt: AgentPrompt = {
        system: this.config.systemInstructions,
        messages,
      };

      // Check if streaming is supported
      if (supportsStreaming(adapter)) {
        // Stream the response
        let content = '';
        const toolCalls: AgentToolCall[] = [];
        let finishReason: AgentCompletion['finishReason'] = 'stop';
        let completionUsage: { promptTokens?: number; completionTokens?: number } | undefined;

        for await (const chunk of adapter.streamCompletion(
          prompt,
          this.config.tools.length > 0 ? this.config.tools : undefined,
          this.config.completionOptions,
        )) {
          if (chunk.type === 'content' && chunk.content) {
            content += chunk.content;
            yield { type: 'content', content: chunk.content };
            this.config.onContent?.(chunk.content);
          }

          if (chunk.type === 'tool_call' && chunk.toolCall) {
            // Update or add tool call
            const existing = toolCalls.find((tc) => tc.id === chunk.toolCall!.id);
            if (existing) {
              Object.assign(existing, chunk.toolCall);
            } else {
              toolCalls.push(chunk.toolCall as AgentToolCall);
            }
            yield { type: 'tool_call', toolCall: chunk.toolCall };
          }

          if (chunk.type === 'done' && chunk.completion) {
            finishReason = chunk.completion.finishReason;
            if (chunk.completion.usage) {
              completionUsage = chunk.completion.usage;
              yield {
                type: 'usage',
                promptTokens: chunk.completion.usage.promptTokens,
                completionTokens: chunk.completion.usage.completionTokens,
              };
            }
          }
        }

        // Notify LLM complete
        this.config.onLlmComplete?.(iteration, completionUsage);

        // Process the accumulated response
        if (finishReason === 'tool_calls' && toolCalls.length > 0) {
          // Notify tool calls identified
          this.config.onToolsIdentified?.(
            toolCalls.length,
            toolCalls.map((tc) => tc.name),
          );

          // Add assistant message with tool calls
          const assistantMessage: AgentMessage = {
            role: 'assistant',
            content: content || null,
            toolCalls,
          };
          messages.push(assistantMessage);

          // Execute tool calls
          const totalTools = toolCalls.length;
          for (let toolIndex = 0; toolIndex < totalTools; toolIndex++) {
            const toolCall = toolCalls[toolIndex];
            this.config.onToolStart?.(toolCall, toolIndex, totalTools);
            this.config.onToolCall?.(toolCall);
            yield { type: 'tool_start', toolCall };

            let result: unknown;
            let error: Error | undefined;

            try {
              result = await toolExecutor(toolCall.name, toolCall.arguments);
            } catch (e) {
              error = e as Error;
              result = { error: error.message };
            }

            this.config.onToolResult?.(toolCall, result, error);
            yield { type: 'tool_end', toolCall, result, error };

            // Add tool result message
            const toolMessage: AgentMessage = {
              role: 'tool',
              content: typeof result === 'string' ? result : JSON.stringify(result),
              toolCallId: toolCall.id,
              name: toolCall.name,
            };
            messages.push(toolMessage);
          }
        } else {
          // Final response
          const assistantMessage: AgentMessage = {
            role: 'assistant',
            content: content || null,
          };
          messages.push(assistantMessage);
          this.config.onComplete?.(content || null, undefined);
          return;
        }
      } else {
        // Non-streaming fallback
        const completion = await adapter.completion(
          prompt,
          this.config.tools.length > 0 ? this.config.tools : undefined,
          this.config.completionOptions,
        );

        // Notify LLM complete
        this.config.onLlmComplete?.(iteration, completion.usage);

        if (completion.usage) {
          yield {
            type: 'usage',
            promptTokens: completion.usage.promptTokens,
            completionTokens: completion.usage.completionTokens,
          };
        }

        if (completion.finishReason === 'tool_calls' && completion.toolCalls?.length) {
          // Notify tool calls identified
          this.config.onToolsIdentified?.(
            completion.toolCalls.length,
            completion.toolCalls.map((tc) => tc.name),
          );

          // Add assistant message with tool calls
          const assistantMessage: AgentMessage = {
            role: 'assistant',
            content: completion.content,
            toolCalls: completion.toolCalls,
          };
          messages.push(assistantMessage);

          // Execute tool calls
          const totalTools = completion.toolCalls.length;
          for (let toolIndex = 0; toolIndex < totalTools; toolIndex++) {
            const toolCall = completion.toolCalls[toolIndex];
            this.config.onToolStart?.(toolCall, toolIndex, totalTools);
            this.config.onToolCall?.(toolCall);
            yield { type: 'tool_start', toolCall };

            let result: unknown;
            let error: Error | undefined;

            try {
              result = await toolExecutor(toolCall.name, toolCall.arguments);
            } catch (e) {
              error = e as Error;
              result = { error: error.message };
            }

            this.config.onToolResult?.(toolCall, result, error);
            yield { type: 'tool_end', toolCall, result, error };

            // Add tool result message
            const toolMessage: AgentMessage = {
              role: 'tool',
              content: typeof result === 'string' ? result : JSON.stringify(result),
              toolCallId: toolCall.id,
              name: toolCall.name,
            };
            messages.push(toolMessage);
          }
        } else {
          // Final response
          if (completion.content) {
            yield { type: 'content', content: completion.content };
            this.config.onContent?.(completion.content);
          }

          const assistantMessage: AgentMessage = {
            role: 'assistant',
            content: completion.content,
          };
          messages.push(assistantMessage);
          this.config.onComplete?.(completion.content, undefined);
          return;
        }
      }
    }

    // Max iterations reached
    const error = new AgentMaxIterationsError(
      `Agent reached maximum iterations (${this.config.maxIterations}) without completing`,
      this.config.maxIterations,
    );
    this.config.onComplete?.(null, error);
    throw error;
  }
}

// ============================================================================
// Stream Event Types
// ============================================================================

/**
 * Events emitted during streaming execution.
 */
export type AgentStreamEvent =
  | { type: 'iteration'; iteration: number }
  | { type: 'content'; content: string }
  | { type: 'tool_call'; toolCall: Partial<AgentToolCall> & { id: string } }
  | { type: 'tool_start'; toolCall: AgentToolCall }
  | { type: 'tool_end'; toolCall: AgentToolCall; result: unknown; error?: Error }
  | { type: 'usage'; promptTokens: number; completionTokens: number }
  | { type: 'error'; error: Error }
  | { type: 'done'; result: AgentExecutionResult };

// ============================================================================
// Errors
// ============================================================================

/**
 * Error thrown when agent reaches maximum iterations.
 */
export class AgentMaxIterationsError extends Error {
  constructor(
    message: string,
    public readonly maxIterations: number,
  ) {
    super(message);
    this.name = 'AgentMaxIterationsError';
  }
}

// AgentTimeoutError is exported from ../../errors/agent.errors.ts
