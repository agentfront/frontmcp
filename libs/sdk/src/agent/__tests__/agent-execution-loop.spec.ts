/**
 * Unit tests for AgentExecutionLoop
 */

import 'reflect-metadata';

import {
  type AgentCompletion,
  type AgentCompletionChunk,
  type AgentCompletionOptions,
  type AgentLlmAdapter,
} from '../../common';
import { AgentLlmError, AgentLoopExceededError, AgentTimeoutError, PublicMcpError } from '../../errors';
import {
  AgentExecutionLoop,
  type AgentExecutionResult,
  type AgentStreamEvent,
  type ToolExecutor,
} from '../agent-execution-loop';

// Mock LLM adapter factory
function createMockAdapter(responses: AgentCompletion[]): AgentLlmAdapter {
  let callIndex = 0;

  return {
    completion: jest.fn().mockImplementation(async () => {
      const response = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return response;
    }),
    streamCompletion: undefined,
  };
}

// Mock tool executor
function createMockToolExecutor(results: Record<string, unknown>): ToolExecutor {
  return jest.fn().mockImplementation(async (name: string) => {
    return results[name] ?? { error: `Unknown tool: ${name}` };
  });
}

describe('AgentExecutionLoop', () => {
  describe('Timeout', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('clears its timeout timer when a run finishes', async () => {
      jest.useFakeTimers();
      const loop = new AgentExecutionLoop({
        adapter: createMockAdapter([{ content: 'Done', finishReason: 'stop' }]),
        systemInstructions: 'You are a helpful assistant.',
        tools: [],
        timeout: 60_000,
      });

      const result = await loop.run('Hi', jest.fn());

      expect(result.success).toBe(true);
      // A timer left behind keeps the process (or a test worker) alive for the whole timeout.
      expect(jest.getTimerCount()).toBe(0);
    });

    it('clears its timeout timer when a run fails', async () => {
      jest.useFakeTimers();
      const adapter: AgentLlmAdapter = {
        completion: jest.fn().mockRejectedValue(new Error('model down')),
        streamCompletion: undefined,
      };
      const loop = new AgentExecutionLoop({ adapter, systemInstructions: 'x', tools: [], timeout: 60_000 });

      const result = await loop.run('Hi', jest.fn());

      expect(result.success).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('Basic Execution', () => {
    it('should execute a simple prompt without tool calls', async () => {
      const adapter = createMockAdapter([
        {
          content: 'Hello! How can I help you?',
          finishReason: 'stop',
        },
      ]);

      const loop = new AgentExecutionLoop({
        adapter,
        systemInstructions: 'You are a helpful assistant.',
        tools: [],
      });

      const result = await loop.run('Hi there!', jest.fn());

      expect(result.success).toBe(true);
      expect(result.content).toBe('Hello! How can I help you?');
      expect(result.iterations).toBe(1);
      expect(result.messages).toHaveLength(2); // user + assistant
    });

    it('should include system instructions in prompt', async () => {
      const mockCompletion = jest.fn().mockResolvedValue({
        content: 'Response',
        finishReason: 'stop',
      });

      const adapter: AgentLlmAdapter = {
        completion: mockCompletion,
      };

      const loop = new AgentExecutionLoop({
        adapter,
        systemInstructions: 'You are a test assistant.',
        tools: [],
      });

      await loop.run('Hello', jest.fn());

      expect(mockCompletion).toHaveBeenCalledWith(
        expect.objectContaining({
          system: 'You are a test assistant.',
          messages: expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'Hello' })]),
        }),
        undefined,
        { signal: expect.any(AbortSignal) },
      );
    });
  });

  describe('Tool Calling', () => {
    it('should execute tool calls and continue conversation', async () => {
      const adapter = createMockAdapter([
        // First response: tool call
        {
          content: null,
          finishReason: 'tool_calls',
          toolCalls: [{ id: 'call-1', name: 'get_weather', arguments: { city: 'Paris' } }],
        },
        // Second response: final answer
        {
          content: 'The weather in Paris is sunny!',
          finishReason: 'stop',
        },
      ]);

      const toolExecutor = createMockToolExecutor({
        get_weather: { temperature: 22, condition: 'sunny' },
      });

      const loop = new AgentExecutionLoop({
        adapter,
        systemInstructions: 'You are a weather assistant.',
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather for a city',
            parameters: {
              type: 'object' as const,
              properties: { city: { type: 'string' } },
            },
          },
        ],
      });

      const result = await loop.run('What is the weather in Paris?', toolExecutor);

      expect(result.success).toBe(true);
      expect(result.content).toBe('The weather in Paris is sunny!');
      expect(result.iterations).toBe(2);
      expect(toolExecutor).toHaveBeenCalledWith('get_weather', { city: 'Paris' });
    });

    it('should handle multiple tool calls in sequence', async () => {
      const adapter = createMockAdapter([
        // First response: first tool call
        {
          content: null,
          finishReason: 'tool_calls',
          toolCalls: [{ id: 'call-1', name: 'tool_a', arguments: {} }],
        },
        // Second response: second tool call
        {
          content: null,
          finishReason: 'tool_calls',
          toolCalls: [{ id: 'call-2', name: 'tool_b', arguments: {} }],
        },
        // Third response: final answer
        {
          content: 'Done with both tools!',
          finishReason: 'stop',
        },
      ]);

      const toolExecutor = createMockToolExecutor({
        tool_a: { result: 'A' },
        tool_b: { result: 'B' },
      });

      const loop = new AgentExecutionLoop({
        adapter,
        systemInstructions: 'You are a multi-tool assistant.',
        tools: [
          { name: 'tool_a', description: 'Tool A', parameters: { type: 'object' as const } },
          { name: 'tool_b', description: 'Tool B', parameters: { type: 'object' as const } },
        ],
      });

      const result = await loop.run('Use both tools', toolExecutor);

      expect(result.success).toBe(true);
      expect(result.iterations).toBe(3);
      expect(toolExecutor).toHaveBeenCalledTimes(2);
    });

    it('should handle tool execution errors gracefully', async () => {
      const adapter = createMockAdapter([
        // Tool call
        {
          content: null,
          finishReason: 'tool_calls',
          toolCalls: [{ id: 'call-1', name: 'failing_tool', arguments: {} }],
        },
        // Response after error
        {
          content: 'I encountered an error with the tool.',
          finishReason: 'stop',
        },
      ]);

      const toolExecutor = jest.fn().mockRejectedValue(new Error('Tool failed!'));

      const loop = new AgentExecutionLoop({
        adapter,
        systemInstructions: 'Handle errors gracefully.',
        tools: [{ name: 'failing_tool', description: 'A tool that fails', parameters: { type: 'object' as const } }],
      });

      const result = await loop.run('Call the failing tool', toolExecutor);

      expect(result.success).toBe(true);
      expect(result.content).toBe('I encountered an error with the tool.');
      // Tool error should be included in conversation
      expect(result.messages.some((m) => m.content?.includes('Tool failed!'))).toBe(true);
    });
  });

  describe('Iteration Limits', () => {
    it('should respect maxIterations limit', async () => {
      // Adapter always returns tool calls (never stops)
      const adapter = createMockAdapter([
        {
          content: null,
          finishReason: 'tool_calls',
          toolCalls: [{ id: 'call-1', name: 'infinite_tool', arguments: {} }],
        },
      ]);

      const toolExecutor = createMockToolExecutor({
        infinite_tool: { continue: true },
      });

      const loop = new AgentExecutionLoop({
        adapter,
        systemInstructions: 'Test',
        tools: [{ name: 'infinite_tool', description: 'Never stops', parameters: { type: 'object' as const } }],
        maxIterations: 3,
      });

      const result = await loop.run('Start infinite loop', toolExecutor);

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(AgentLoopExceededError);
      expect(result.error).toMatchObject({ code: 'AGENT_LOOP_EXCEEDED', maxIterations: 3 });
      expect(result.iterations).toBe(3);
    });

    it('should use default maxIterations of 10', async () => {
      const adapter = createMockAdapter([
        {
          content: null,
          finishReason: 'tool_calls',
          toolCalls: [{ id: 'call-1', name: 'loop_tool', arguments: {} }],
        },
      ]);

      const toolExecutor = createMockToolExecutor({
        loop_tool: { repeat: true },
      });

      const loop = new AgentExecutionLoop({
        adapter,
        systemInstructions: 'Test default iterations',
        tools: [{ name: 'loop_tool', description: 'Loops', parameters: { type: 'object' as const } }],
        // maxIterations not specified, should default to 10
      });

      const result = await loop.run('Loop forever', toolExecutor);

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(AgentLoopExceededError);
    });
  });

  describe('Callbacks', () => {
    it('should call onToolCall callback', async () => {
      const adapter = createMockAdapter([
        {
          content: null,
          finishReason: 'tool_calls',
          toolCalls: [{ id: 'call-1', name: 'tracked_tool', arguments: { x: 1 } }],
        },
        {
          content: 'Done',
          finishReason: 'stop',
        },
      ]);

      const onToolCall = jest.fn();

      const loop = new AgentExecutionLoop({
        adapter,
        systemInstructions: 'Test callbacks',
        tools: [{ name: 'tracked_tool', description: 'Tracked', parameters: { type: 'object' as const } }],
        onToolCall,
      });

      await loop.run('Track this', createMockToolExecutor({ tracked_tool: {} }));

      expect(onToolCall).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'call-1',
          name: 'tracked_tool',
          arguments: { x: 1 },
        }),
      );
    });

    it('should call onToolResult callback', async () => {
      const adapter = createMockAdapter([
        {
          content: null,
          finishReason: 'tool_calls',
          toolCalls: [{ id: 'call-1', name: 'result_tool', arguments: {} }],
        },
        {
          content: 'Done',
          finishReason: 'stop',
        },
      ]);

      const onToolResult = jest.fn();
      const toolResult = { data: 'result' };

      const loop = new AgentExecutionLoop({
        adapter,
        systemInstructions: 'Test callbacks',
        tools: [{ name: 'result_tool', description: 'Returns result', parameters: { type: 'object' as const } }],
        onToolResult,
      });

      await loop.run('Get result', createMockToolExecutor({ result_tool: toolResult }));

      expect(onToolResult).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'result_tool' }),
        toolResult,
        undefined, // no error
      );
    });

    it('should call onIteration callback', async () => {
      const adapter = createMockAdapter([
        {
          content: 'First response',
          finishReason: 'stop',
        },
      ]);

      const onIteration = jest.fn();

      const loop = new AgentExecutionLoop({
        adapter,
        systemInstructions: 'Test iteration',
        tools: [],
        onIteration,
      });

      await loop.run('Hello', jest.fn());

      expect(onIteration).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          role: 'assistant',
          content: 'First response',
        }),
      );
    });
  });

  describe('Token Usage Tracking', () => {
    it('should accumulate token usage across iterations', async () => {
      const adapter = createMockAdapter([
        {
          content: null,
          finishReason: 'tool_calls',
          toolCalls: [{ id: 'call-1', name: 'usage_tool', arguments: {} }],
          usage: { promptTokens: 100, completionTokens: 50 },
        },
        {
          content: 'Final answer',
          finishReason: 'stop',
          usage: { promptTokens: 150, completionTokens: 75 },
        },
      ]);

      const loop = new AgentExecutionLoop({
        adapter,
        systemInstructions: 'Track usage',
        tools: [{ name: 'usage_tool', description: 'For usage tracking', parameters: { type: 'object' as const } }],
      });

      const result = await loop.run('Track tokens', createMockToolExecutor({ usage_tool: {} }));

      expect(result.usage).toBeDefined();
      expect(result.usage?.promptTokens).toBe(250); // 100 + 150
      expect(result.usage?.completionTokens).toBe(125); // 50 + 75
      expect(result.usage?.totalTokens).toBe(375); // 250 + 125
    });
  });

  describe('Existing Messages', () => {
    it('should continue from existing conversation', async () => {
      const mockCompletion = jest.fn().mockResolvedValue({
        content: 'Continuing the conversation...',
        finishReason: 'stop',
      });

      const adapter: AgentLlmAdapter = {
        completion: mockCompletion,
      };

      const existingMessages = [
        { role: 'user' as const, content: 'Hello' },
        { role: 'assistant' as const, content: 'Hi there!' },
      ];

      const loop = new AgentExecutionLoop({
        adapter,
        systemInstructions: 'Continue conversation',
        tools: [],
      });

      const result = await loop.run('Tell me more', jest.fn(), existingMessages);

      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(4); // 2 existing + 1 new user + 1 assistant
      expect(result.messages[0].content).toBe('Hello');
      expect(result.messages[1].content).toBe('Hi there!');
      expect(result.messages[2].content).toBe('Tell me more');
    });
  });

  describe('Duration Tracking', () => {
    it('should track execution duration', async () => {
      const adapter = createMockAdapter([
        {
          content: 'Quick response',
          finishReason: 'stop',
        },
      ]);

      const loop = new AgentExecutionLoop({
        adapter,
        systemInstructions: 'Test duration',
        tools: [],
      });

      const result = await loop.run('Hi', jest.fn());

      expect(result.durationMs).toBeDefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Stopping the run', () => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const lookupCall = (id: string) => ({ id, name: 'lookup', arguments: {} });
    const askForLookups = (...ids: string[]): AgentCompletion => ({
      content: null,
      finishReason: 'tool_calls',
      toolCalls: ids.map(lookupCall),
    });

    it('starts no model request and no tool call after the timeout fires', async () => {
      const completion = jest.fn(async () => {
        await wait(60);
        return askForLookups('c1');
      });
      const toolExecutor = jest.fn().mockResolvedValue('found');
      const loop = new AgentExecutionLoop({
        adapter: { completion },
        agentId: 'triage',
        systemInstructions: 'x',
        tools: [],
        timeout: 20,
      });

      const result = await loop.run('Hi', toolExecutor);
      await wait(120);

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(AgentTimeoutError);
      expect(result.error).toMatchObject({ code: 'AGENT_TIMEOUT', agentId: 'triage', timeoutMs: 20 });
      expect(result.error?.message).toBe('Agent "triage" execution timed out after 20ms');
      expect(completion).toHaveBeenCalledTimes(1);
      expect(toolExecutor).not.toHaveBeenCalled();
    });

    it('runs none of the remaining tool calls after the timeout fires', async () => {
      const completion = jest.fn().mockResolvedValue(askForLookups('c1', 'c2'));
      const toolExecutor = jest.fn(async () => {
        await wait(60);
        return 'found';
      });
      const loop = new AgentExecutionLoop({ adapter: { completion }, systemInstructions: 'x', tools: [], timeout: 20 });

      const result = await loop.run('Hi', toolExecutor);
      await wait(120);

      expect(result.error).toBeInstanceOf(AgentTimeoutError);
      expect(toolExecutor).toHaveBeenCalledTimes(1);
      expect(completion).toHaveBeenCalledTimes(1);
    });

    it('passes each model request a signal that aborts when the timeout fires', async () => {
      const completion = jest.fn(async (..._args: [unknown, unknown, AgentCompletionOptions?]) => {
        await wait(60);
        return { content: 'late', finishReason: 'stop' as const };
      });
      const loop = new AgentExecutionLoop({
        adapter: { completion },
        systemInstructions: 'x',
        tools: [],
        timeout: 20,
        completionOptions: { temperature: 0.1 },
      });

      await loop.run('Hi', jest.fn());

      const options = completion.mock.calls[0][2];
      expect(options).toMatchObject({ temperature: 0.1 });
      expect(options?.signal?.aborted).toBe(true);
      expect(options?.signal?.reason).toBeInstanceOf(AgentTimeoutError);
    });

    it('stops when the signal it was given aborts, and fails with its reason', async () => {
      const controller = new AbortController();
      const cancelled = new Error('The call was cancelled');
      const completion = jest.fn(async () => {
        controller.abort(cancelled);
        return askForLookups('c1');
      });
      const toolExecutor = jest.fn();
      const loop = new AgentExecutionLoop({
        adapter: { completion },
        systemInstructions: 'x',
        tools: [],
        signal: controller.signal,
      });

      const result = await loop.run('Hi', toolExecutor);
      await wait(20);

      expect(result.error).toBe(cancelled);
      expect(toolExecutor).not.toHaveBeenCalled();
    });

    it('fails with AgentLlmError when a model request fails, keeping the cause', async () => {
      const cause = new Error('model down');
      const loop = new AgentExecutionLoop({
        adapter: { completion: jest.fn().mockRejectedValue(cause) },
        agentId: 'triage',
        systemInstructions: 'x',
        tools: [],
      });

      const result = await loop.run('Hi', jest.fn());

      expect(result.error).toBeInstanceOf(AgentLlmError);
      expect(result.error).toMatchObject({ code: 'AGENT_LLM_ERROR', agentId: 'triage', originalError: cause });
    });

    it('keeps a FrontMCP error a model request fails with as it is', async () => {
      const refusal = new PublicMcpError('Model quota used up', 'MODEL_QUOTA', 429);
      const loop = new AgentExecutionLoop({
        adapter: { completion: jest.fn().mockRejectedValue(refusal) },
        systemInstructions: 'x',
        tools: [],
      });

      const result = await loop.run('Hi', jest.fn());

      expect(result.error).toBe(refusal);
    });

    it.each([
      ['the timeout fires', AgentTimeoutError, () => wait(60).then(() => askForLookups('c1'))],
      ['a model request fails', AgentLlmError, () => Promise.reject(new Error('model down'))],
      ['the model keeps calling tools', AgentLoopExceededError, () => Promise.resolve(askForLookups('c1'))],
    ])('tells onComplete once, with the error, when %s', async (_case, errorClass, reply) => {
      const onComplete = jest.fn();
      const loop = new AgentExecutionLoop({
        adapter: { completion: jest.fn(reply) },
        systemInstructions: 'x',
        tools: [],
        timeout: 20,
        maxIterations: 2,
        onComplete,
      });

      await loop.run('Hi', jest.fn().mockResolvedValue('found'));

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith(null, expect.any(errorClass));
    });

    it('runs no tool when onToolStart aborts the signal it was given', async () => {
      const controller = new AbortController();
      const cancelled = new Error('The call was cancelled');
      const toolExecutor = jest.fn().mockResolvedValue('found');
      const loop = new AgentExecutionLoop({
        adapter: { completion: jest.fn().mockResolvedValue(askForLookups('c1')) },
        systemInstructions: 'x',
        tools: [],
        signal: controller.signal,
        onToolStart: () => controller.abort(cancelled),
      });

      const result = await loop.run('Hi', toolExecutor);

      expect(result.error).toBe(cancelled);
      expect(toolExecutor).not.toHaveBeenCalled();
    });

    it.each([
      ['run', (loop: AgentExecutionLoop) => loop.run('Hi', jest.fn())],
      [
        'runStreaming',
        async (loop: AgentExecutionLoop) => {
          for await (const _event of loop.runStreaming('Hi', jest.fn()));
        },
      ],
    ])('stops following the signal it was given once %s ends', async (_mode, runOnce) => {
      const controller = new AbortController();
      let requestSignal: AbortSignal | undefined;
      const completion = jest.fn(async (_prompt: unknown, _tools: unknown, options?: AgentCompletionOptions) => {
        requestSignal = options?.signal;
        return { content: 'Done', finishReason: 'stop' as const };
      });
      const loop = new AgentExecutionLoop({
        adapter: { completion },
        systemInstructions: 'x',
        tools: [],
        signal: controller.signal,
      });

      await runOnce(loop);
      controller.abort(new Error('request ended'));

      expect(requestSignal?.aborted).toBe(false);
    });

    describe('streamed', () => {
      async function drainStream(stream: AsyncGenerator<AgentStreamEvent, AgentExecutionResult>) {
        for (let step = await stream.next(); ; step = await stream.next()) {
          if (step.done) return step.value;
        }
      }

      it('starts no tool call and no model request after the timeout fires', async () => {
        const streamCompletion = jest.fn(async function* (): AsyncGenerator<AgentCompletionChunk> {
          await wait(60);
          yield { type: 'done', completion: askForLookups('c1') };
        });
        const toolExecutor = jest.fn().mockResolvedValue('found');
        const loop = new AgentExecutionLoop({
          adapter: { completion: jest.fn(), streamCompletion },
          systemInstructions: 'x',
          tools: [],
          timeout: 20,
        });

        const result = await drainStream(loop.runStreaming('Hi', toolExecutor));
        await wait(120);

        expect(result.error).toBeInstanceOf(AgentTimeoutError);
        expect(streamCompletion).toHaveBeenCalledTimes(1);
        expect(toolExecutor).not.toHaveBeenCalled();
      });

      it('starts no tool when the signal aborts while the consumer holds tool_start', async () => {
        const controller = new AbortController();
        const cancelled = new Error('The call was cancelled');
        const toolExecutor = jest.fn().mockResolvedValue('found');
        const loop = new AgentExecutionLoop({
          adapter: { completion: jest.fn().mockResolvedValue(askForLookups('c1')) },
          systemInstructions: 'x',
          tools: [],
          signal: controller.signal,
        });
        const events: AgentStreamEvent['type'][] = [];

        for await (const event of loop.runStreaming('Hi', toolExecutor)) {
          events.push(event.type);
          if (event.type === 'tool_start') controller.abort(cancelled);
        }

        expect(toolExecutor).not.toHaveBeenCalled();
        expect(events.slice(-2)).toEqual(['error', 'done']);
      });

      it('passes the streamed request a signal that aborts when the timeout fires', async () => {
        let requestSignal: AbortSignal | undefined;
        const loop = new AgentExecutionLoop({
          adapter: {
            completion: jest.fn(),
            streamCompletion: async function* (_prompt, _tools, options): AsyncGenerator<AgentCompletionChunk> {
              requestSignal = options?.signal;
              await wait(60);
              yield { type: 'done', completion: { content: 'late', finishReason: 'stop' } };
            },
          },
          systemInstructions: 'x',
          tools: [],
          timeout: 20,
        });

        await drainStream(loop.runStreaming('Hi', jest.fn()));

        expect(requestSignal?.aborted).toBe(true);
      });

      it('fails with AgentLlmError when the stream fails, and tells onComplete', async () => {
        const onComplete = jest.fn();
        const loop = new AgentExecutionLoop({
          adapter: {
            completion: jest.fn(),
            streamCompletion: async function* (): AsyncGenerator<AgentCompletionChunk> {
              yield { type: 'content', content: 'Thin' };
              throw new Error('stream reset');
            },
          },
          systemInstructions: 'x',
          tools: [],
          onComplete,
        });

        const result = await drainStream(loop.runStreaming('Hi', jest.fn()));

        expect(result.error).toBeInstanceOf(AgentLlmError);
        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(onComplete).toHaveBeenCalledWith(null, result.error);
      });
    });
  });

  describe('runStreaming', () => {
    /** An adapter that streams one scripted reply per call. */
    function streamingAdapter(replies: AgentCompletionChunk[][]): AgentLlmAdapter {
      let call = 0;
      return {
        completion: jest.fn(),
        streamCompletion: jest.fn(async function* () {
          const reply = replies[Math.min(call++, replies.length - 1)];
          for (const chunk of reply) yield chunk;
        }),
      };
    }

    async function drain(
      stream: AsyncGenerator<AgentStreamEvent, AgentExecutionResult>,
    ): Promise<{ events: AgentStreamEvent[]; result: AgentExecutionResult }> {
      const events: AgentStreamEvent[] = [];
      for (let step = await stream.next(); ; step = await stream.next()) {
        if (step.done) return { events, result: step.value };
        events.push(step.value);
      }
    }

    afterEach(() => {
      jest.useRealTimers();
    });

    it('yields the text as it arrives and returns the run result, as its last event does', async () => {
      const onIteration = jest.fn();
      const loop = new AgentExecutionLoop({
        adapter: streamingAdapter([
          [
            { type: 'content', content: 'Hel' },
            { type: 'content', content: 'lo' },
            {
              type: 'done',
              completion: { content: 'Hello', finishReason: 'stop', usage: { promptTokens: 3, completionTokens: 2 } },
            },
          ],
        ]),
        systemInstructions: 'x',
        tools: [],
        onIteration,
      });

      const { events, result } = await drain(loop.runStreaming('Hi', jest.fn()));

      expect(events.filter((event) => event.type === 'content')).toEqual([
        { type: 'content', content: 'Hel' },
        { type: 'content', content: 'lo' },
      ]);
      expect(result).toMatchObject({
        content: 'Hello',
        iterations: 1,
        success: true,
        usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
      });
      expect(events[events.length - 1]).toEqual({ type: 'done', result });
      expect(onIteration).toHaveBeenCalledWith(1, { role: 'assistant', content: 'Hello' });
    });

    it('runs the tool calls of the completion the stream ends with, with their complete arguments', async () => {
      const toolExecutor = jest.fn().mockResolvedValue({ tide: 'noon' });
      const loop = new AgentExecutionLoop({
        adapter: streamingAdapter([
          [
            { type: 'content', content: 'Checking. ' },
            // Announced before its arguments are known
            { type: 'tool_call', toolCall: { id: 'c1', name: 'lookup', arguments: {} } },
            {
              type: 'done',
              completion: {
                content: 'Checking. ',
                finishReason: 'tool_calls',
                toolCalls: [{ id: 'c1', name: 'lookup', arguments: { topic: 'tides' } }],
              },
            },
          ],
          [
            { type: 'content', content: 'At noon.' },
            { type: 'done', completion: { content: 'At noon.', finishReason: 'stop' } },
          ],
        ]),
        systemInstructions: 'x',
        tools: [{ name: 'lookup', parameters: { type: 'object' } }],
      });

      const { events, result } = await drain(loop.runStreaming('When is high tide?', toolExecutor));

      expect(toolExecutor).toHaveBeenCalledWith('lookup', { topic: 'tides' });
      expect(events.map((event) => event.type)).toEqual([
        'iteration',
        'content',
        'tool_call',
        'tool_start',
        'tool_end',
        'iteration',
        'content',
        'done',
      ]);
      expect(result.content).toBe('At noon.');
      expect(result.iterations).toBe(2);
      expect(result.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    });

    it('puts together the tool calls a stream announces when it ends without a completion', async () => {
      const toolExecutor = jest.fn().mockResolvedValue('ok');
      const loop = new AgentExecutionLoop({
        adapter: streamingAdapter([
          [
            { type: 'tool_call', toolCall: { id: 'c1', name: 'lookup' } },
            { type: 'tool_call', toolCall: { id: 'c1', name: undefined, arguments: { topic: 'tides' } } },
            { type: 'tool_call', toolCall: { id: 'c2' } },
          ],
          [{ type: 'content', content: 'Done.' }],
        ]),
        systemInstructions: 'x',
        tools: [],
      });

      const { result } = await drain(loop.runStreaming('Go', toolExecutor));

      expect(toolExecutor.mock.calls).toEqual([
        ['lookup', { topic: 'tides' }],
        ['', {}],
      ]);
      expect(result.content).toBe('Done.');
    });

    it('yields the text of a reply that arrives in one piece as one chunk', async () => {
      const adapter: AgentLlmAdapter = {
        completion: jest.fn(),
        // An adapter that can't really stream: its stream only ends with the completion
        streamCompletion: async function* () {
          yield { type: 'done', completion: { content: 'All at once', finishReason: 'stop' } };
        },
      };
      const loop = new AgentExecutionLoop({ adapter, systemInstructions: 'x', tools: [] });

      const { events, result } = await drain(loop.runStreaming('Hi', jest.fn()));

      expect(events.filter((event) => event.type === 'content')).toEqual([{ type: 'content', content: 'All at once' }]);
      expect(result.content).toBe('All at once');
    });

    it('calls completion() of an adapter without streamCompletion(), and yields its text and usage', async () => {
      const adapter = createMockAdapter([
        {
          content: null,
          finishReason: 'tool_calls',
          toolCalls: [{ id: 'c1', name: 'lookup', arguments: {} }],
          usage: { promptTokens: 1, completionTokens: 1 },
        },
        { content: 'Done', finishReason: 'stop', usage: { promptTokens: 2, completionTokens: 2 } },
      ]);
      const loop = new AgentExecutionLoop({ adapter, systemInstructions: 'x', tools: [] });

      const { events, result } = await drain(loop.runStreaming('Hi', jest.fn().mockResolvedValue('found')));

      expect(adapter.completion).toHaveBeenCalledTimes(2);
      expect(events.filter((event) => event.type === 'content')).toEqual([{ type: 'content', content: 'Done' }]);
      expect(result.usage).toEqual({ promptTokens: 3, completionTokens: 3, totalTokens: 6 });
    });

    it('passes a tool failure to the model as the tool result', async () => {
      const loop = new AgentExecutionLoop({
        adapter: streamingAdapter([
          [
            {
              type: 'done',
              completion: {
                content: null,
                finishReason: 'tool_calls',
                toolCalls: [{ id: 'c1', name: 'lookup', arguments: {} }],
              },
            },
          ],
          [{ type: 'done', completion: { content: 'Sorry', finishReason: 'stop' } }],
        ]),
        systemInstructions: 'x',
        tools: [],
      });

      const { events, result } = await drain(
        loop.runStreaming('Hi', jest.fn().mockRejectedValue(new Error('lookup is down'))),
      );

      const toolEnd = events.find((event) => event.type === 'tool_end');
      expect(toolEnd).toMatchObject({ result: { error: 'lookup is down' }, error: new Error('lookup is down') });
      expect(result.messages[2]).toMatchObject({ role: 'tool', content: '{"error":"lookup is down"}' });
      expect(result.content).toBe('Sorry');
    });

    it('fails with the maximum iterations error when the model keeps calling tools', async () => {
      const loop = new AgentExecutionLoop({
        adapter: streamingAdapter([
          [
            {
              type: 'done',
              completion: {
                content: null,
                finishReason: 'tool_calls',
                toolCalls: [{ id: 'c1', name: 'lookup', arguments: {} }],
              },
            },
          ],
        ]),
        systemInstructions: 'x',
        tools: [],
        maxIterations: 2,
      });

      const { events, result } = await drain(loop.runStreaming('Hi', jest.fn().mockResolvedValue('again')));

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(AgentLoopExceededError);
      expect(events.slice(-2).map((event) => event.type)).toEqual(['error', 'done']);
    });

    it('fails with the timeout error when the run takes longer than its timeout', async () => {
      const adapter: AgentLlmAdapter = {
        completion: jest.fn(),
        streamCompletion: async function* () {
          yield { type: 'content', content: 'Thinking' };
          await new Promise(() => undefined);
        },
      };
      const loop = new AgentExecutionLoop({
        adapter,
        agentId: 'triage',
        systemInstructions: 'x',
        tools: [],
        timeout: 20,
      });

      const { events, result } = await drain(loop.runStreaming('Hi', jest.fn()));

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(AgentTimeoutError);
      expect(result.error?.message).toBe('Agent "triage" execution timed out after 20ms');
      expect(events.map((event) => event.type)).toEqual(['iteration', 'content', 'error', 'done']);
    });

    it('clears its timer for every step', async () => {
      jest.useFakeTimers();
      const loop = new AgentExecutionLoop({
        adapter: streamingAdapter([[{ type: 'content', content: 'Hi' }]]),
        systemInstructions: 'x',
        tools: [],
        timeout: 60_000,
      });

      const { result } = await drain(loop.runStreaming('Hi', jest.fn()));

      expect(result.success).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
