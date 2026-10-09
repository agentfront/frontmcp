/**
 * Unit tests for AgentExecutionLoop
 */

import 'reflect-metadata';

import { type AgentCompletion, type AgentCompletionChunk, type AgentLlmAdapter } from '../../common';
import {
  AgentExecutionLoop,
  AgentMaxIterationsError,
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
        undefined,
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
      expect(result.error).toBeInstanceOf(AgentMaxIterationsError);
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
      expect(result.error).toBeInstanceOf(AgentMaxIterationsError);
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
      expect(result.error).toBeInstanceOf(AgentMaxIterationsError);
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
      const loop = new AgentExecutionLoop({ adapter, systemInstructions: 'x', tools: [], timeout: 20 });

      const { events, result } = await drain(loop.runStreaming('Hi', jest.fn()));

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Agent execution timed out after 20ms');
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
