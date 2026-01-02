/**
 * Unit tests for AgentExecutionLoop
 */

import 'reflect-metadata';
import { AgentExecutionLoop, AgentMaxIterationsError, ToolExecutor } from '../agent-execution-loop';
import { AgentLlmAdapter, AgentCompletion } from '../../common';

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
});
