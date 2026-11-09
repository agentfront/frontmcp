// file: libs/sdk/src/agent/agent-execution-loop.ts

import {
  supportsStreaming,
  type AgentCompletion,
  type AgentCompletionOptions,
  type AgentLlmAdapter,
  type AgentMessage,
  type AgentPrompt,
  type AgentToolCall,
  type AgentToolDefinition,
  type FrontMcpLogger,
} from '../common';
import { AgentLlmError, AgentLoopExceededError, AgentTimeoutError, McpError } from '../errors';
import { linkedAbortController } from '../utils/abort.utils';

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
   * The id of the agent the loop runs for, named by the errors it fails with.
   * @default 'agent'
   */
  agentId?: string;

  /**
   * Timeout for the entire execution in milliseconds. When it passes, the run fails with
   * `AgentTimeoutError`, and no model request or tool call starts after it.
   * @default 120000 (2 minutes)
   */
  timeout?: number;

  /**
   * Stops the run when it aborts, as the timeout does: the run fails with the signal's reason.
   */
  signal?: AbortSignal;

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
   * Callback when agent execution is complete, or has failed, whatever the reason.
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
    const stop = this.startStopSignal();

    try {
      const result = await Promise.race([
        this.executeLoop(messages, toolExecutor, stop.signal, {
          onIteration: (iter, msg) => {
            iterations = iter;
            this.config.onIteration?.(iter, msg);
          },
          onUsage: (prompt, completion) => {
            totalPromptTokens += prompt;
            totalCompletionTokens += completion;
          },
        }),
        stop.stopped,
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
    } catch (caught) {
      const error = caught as Error;
      this.config.onComplete?.(null, error);
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
        error,
        durationMs: Date.now() - startTime,
      };
    } finally {
      stop.end();
    }
  }

  /**
   * Run the execution loop with streaming.
   *
   * Yields the model's text as it arrives (`content`), the tool calls it makes and runs
   * (`tool_call`, `tool_start`, `tool_end`), each iteration and its token usage, and finally a `done`
   * event with the same result {@link run} returns, which is also the generator's return value. A run
   * that fails yields `error` and then a `done` event whose result has `success: false`.
   *
   * The model is streamed through the adapter's `streamCompletion()` when it has one, and called
   * through `completion()` otherwise. Tool calls are taken from the completion the stream ends with
   * (its `done` chunk), which holds their complete arguments; the `tool_call` chunks before it only
   * announce them. The whole run is bounded by `timeout` and `signal`, as {@link run} is.
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
  ): AsyncGenerator<AgentStreamEvent, AgentExecutionResult> {
    const startTime = Date.now();
    const messages: AgentMessage[] = [...existingMessages, { role: 'user', content: userMessage }];

    let iterations = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    const result = (content: string | null, error?: Error): AgentExecutionResult => ({
      content,
      messages,
      iterations,
      usage: {
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        totalTokens: totalPromptTokens + totalCompletionTokens,
      },
      success: error === undefined,
      ...(error && { error }),
      durationMs: Date.now() - startTime,
    });

    const stop = this.startStopSignal();
    const events = this.executeLoopStreaming(messages, toolExecutor, stop.signal);
    try {
      for (;;) {
        const step = await Promise.race([events.next(), stop.stopped]);
        if (step.done) {
          const done = result(step.value.content);
          yield { type: 'done', result: done };
          return done;
        }
        const event = step.value;
        if (event.type === 'iteration') iterations = event.iteration;
        if (event.type === 'usage') {
          totalPromptTokens += event.promptTokens;
          totalCompletionTokens += event.completionTokens;
        }
        yield event;
      }
    } catch (caught) {
      // A stopped step ends at its next model request or tool call; its result is dropped
      void events.return({ content: null }).catch(() => undefined);
      const error = caught as Error;
      this.config.onComplete?.(null, error);
      const failed = result(null, error);
      yield { type: 'error', error };
      yield { type: 'done', result: failed };
      return failed;
    } finally {
      stop.end();
    }
  }

  /**
   * The signal that stops a run: it aborts with `AgentTimeoutError` when the timeout passes, or with the
   * reason of the config's `signal`. `stopped` rejects with that reason; `end()` clears the timer.
   */
  private startStopSignal(): { signal: AbortSignal; stopped: Promise<never>; end: () => void } {
    const controller = linkedAbortController(this.config.signal);
    const timer = setTimeout(
      () => controller.abort(new AgentTimeoutError(this.agentId, this.config.timeout)),
      this.config.timeout,
    );
    const stopped = new Promise<never>((_, reject) => {
      if (controller.signal.aborted) reject(controller.signal.reason);
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
    });
    stopped.catch(() => undefined);
    return { signal: controller.signal, stopped, end: () => clearTimeout(timer) };
  }

  private get agentId(): string {
    return this.config.agentId ?? 'agent';
  }

  /** A model request, which the stop signal aborts: it fails with `AgentLlmError` unless the run was stopped. */
  private async requestCompletion(prompt: AgentPrompt, signal: AbortSignal): Promise<AgentCompletion> {
    try {
      const completion = await this.config.adapter.completion(
        prompt,
        this.toolsForModel(),
        this.completionOptions(signal),
      );
      signal.throwIfAborted();
      return completion;
    } catch (error) {
      throw this.modelError(error, signal);
    }
  }

  private toolsForModel(): AgentToolDefinition[] | undefined {
    return this.config.tools.length > 0 ? this.config.tools : undefined;
  }

  private completionOptions(signal: AbortSignal): AgentCompletionOptions {
    return { ...this.config.completionOptions, signal };
  }

  /** What a failed model request fails the run with: the stop reason, a FrontMCP error as it is, or `AgentLlmError`. */
  private modelError(error: unknown, signal: AbortSignal): Error {
    if (signal.aborted) return signal.reason as Error;
    if (error instanceof McpError) return error;
    return new AgentLlmError(this.agentId, error instanceof Error ? error : new Error(String(error)));
  }

  private loopExceededError(): AgentLoopExceededError {
    return new AgentLoopExceededError(this.agentId, this.config.maxIterations);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async executeLoop(
    messages: AgentMessage[],
    toolExecutor: ToolExecutor,
    signal: AbortSignal,
    callbacks: {
      onIteration: (iteration: number, message: AgentMessage) => void;
      onUsage: (promptTokens: number, completionTokens: number) => void;
    },
  ): Promise<{ content: string | null }> {
    for (let iteration = 1; iteration <= this.config.maxIterations; iteration++) {
      signal.throwIfAborted();
      this.config.logger?.debug(`Agent loop iteration ${iteration}/${this.config.maxIterations}`);

      // Notify LLM start
      this.config.onLlmStart?.(iteration, this.config.maxIterations);

      // Build prompt
      const prompt: AgentPrompt = {
        system: this.config.systemInstructions,
        messages,
      };

      // Call LLM
      const completion = await this.requestCompletion(prompt, signal);

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
          signal.throwIfAborted();
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
          signal.throwIfAborted();

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

    throw this.loopExceededError();
  }

  private async *executeLoopStreaming(
    messages: AgentMessage[],
    toolExecutor: ToolExecutor,
    signal: AbortSignal,
  ): AsyncGenerator<AgentStreamEvent, { content: string | null }> {
    for (let iteration = 1; iteration <= this.config.maxIterations; iteration++) {
      signal.throwIfAborted();
      this.config.logger?.debug(`Agent loop iteration ${iteration}/${this.config.maxIterations}`);

      // Notify LLM start
      this.config.onLlmStart?.(iteration, this.config.maxIterations);

      yield { type: 'iteration', iteration };

      // Build prompt
      const prompt: AgentPrompt = {
        system: this.config.systemInstructions,
        messages,
      };

      // Stream the model's reply (or get it in one piece from an adapter that can't stream)
      const completion = yield* this.streamCompletion(prompt, signal);

      // Notify LLM complete
      this.config.onLlmComplete?.(iteration, completion.usage);

      if (completion.finishReason === 'tool_calls' && completion.toolCalls?.length) {
        const toolCalls = completion.toolCalls;
        // Notify tool calls identified
        this.config.onToolsIdentified?.(
          toolCalls.length,
          toolCalls.map((tc) => tc.name),
        );

        // Add assistant message with tool calls
        const assistantMessage: AgentMessage = {
          role: 'assistant',
          content: completion.content,
          toolCalls,
        };
        messages.push(assistantMessage);
        this.config.onIteration?.(iteration, assistantMessage);

        // Execute tool calls
        const totalTools = toolCalls.length;
        for (let toolIndex = 0; toolIndex < totalTools; toolIndex++) {
          signal.throwIfAborted();
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
          signal.throwIfAborted();

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
          content: completion.content,
        };
        messages.push(assistantMessage);
        this.config.onIteration?.(iteration, assistantMessage);
        this.config.onComplete?.(completion.content, undefined);
        return { content: completion.content };
      }
    }

    throw this.loopExceededError();
  }

  /**
   * One reply of the model, streamed: yields its text as it arrives, the tool calls it announces and its
   * usage, and returns the whole completion. The completion the adapter's stream ends with (`done`) is
   * authoritative: it holds the tool calls with their complete arguments, which the `tool_call` chunks
   * announce before they are known. A reply that arrives in one piece (an adapter without
   * `streamCompletion()`, or one whose stream only ends with `done`) yields its text as one chunk.
   */
  private async *streamCompletion(
    prompt: AgentPrompt,
    signal: AbortSignal,
  ): AsyncGenerator<AgentStreamEvent, AgentCompletion> {
    try {
      return yield* this.streamModelReply(prompt, signal);
    } catch (error) {
      throw this.modelError(error, signal);
    }
  }

  private async *streamModelReply(
    prompt: AgentPrompt,
    signal: AbortSignal,
  ): AsyncGenerator<AgentStreamEvent, AgentCompletion> {
    const adapter = this.config.adapter;
    const tools = this.toolsForModel();
    const options = this.completionOptions(signal);

    let streamedText = '';
    let completion: AgentCompletion;
    if (supportsStreaming(adapter)) {
      const announced = new Map<string, Partial<AgentToolCall> & { id: string }>();
      let done: AgentCompletion | undefined;
      for await (const chunk of adapter.streamCompletion(prompt, tools, options)) {
        signal.throwIfAborted();
        if (chunk.type === 'content' && chunk.content) {
          streamedText += chunk.content;
          yield { type: 'content', content: chunk.content };
          this.config.onContent?.(chunk.content);
        } else if (chunk.type === 'tool_call' && chunk.toolCall) {
          announced.set(chunk.toolCall.id, { ...announced.get(chunk.toolCall.id), ...definedFields(chunk.toolCall) });
          yield { type: 'tool_call', toolCall: chunk.toolCall };
        } else if (chunk.type === 'done' && chunk.completion) {
          done = chunk.completion;
        }
      }
      // Without a `done` chunk, the reply is what the stream carried
      const toolCalls =
        done?.toolCalls ??
        [...announced.values()].map((call) => ({
          id: call.id,
          name: call.name ?? '',
          arguments: call.arguments ?? {},
        }));
      completion = {
        content: streamedText || (done?.content ?? null),
        finishReason: done?.finishReason ?? (toolCalls.length > 0 ? 'tool_calls' : 'stop'),
        ...(toolCalls.length > 0 && { toolCalls }),
        ...(done?.usage && { usage: done.usage }),
      };
    } else {
      completion = await adapter.completion(prompt, tools, options);
    }
    signal.throwIfAborted();

    if (!streamedText && completion.content) {
      yield { type: 'content', content: completion.content };
      this.config.onContent?.(completion.content);
    }
    if (completion.usage) {
      yield {
        type: 'usage',
        promptTokens: completion.usage.promptTokens,
        completionTokens: completion.usage.completionTokens,
      };
    }
    return completion;
  }
}

/** The fields of a streamed tool call that the chunk sets: a later chunk adds to an earlier one. */
function definedFields(toolCall: Partial<AgentToolCall> & { id: string }): Partial<AgentToolCall> & { id: string } {
  return Object.fromEntries(
    Object.entries(toolCall).filter(([, value]) => value !== undefined),
  ) as Partial<AgentToolCall> & { id: string };
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
