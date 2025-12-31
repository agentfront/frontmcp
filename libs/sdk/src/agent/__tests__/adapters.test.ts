/**
 * Unit tests for LLM Adapters
 */

import 'reflect-metadata';
import { LangChainAdapter, createAdapter, LlmAdapterError } from '../adapters';
import {
  AgentLlmBuiltinConfig,
  AgentLlmAdapterConfig,
  AgentLlmAdapter,
  AgentPrompt,
  AgentToolDefinition,
} from '../../common';

describe('LLM Adapters', () => {
  describe('LangChainAdapter', () => {
    // Mock LangChain model
    const createMockModel = () => ({
      invoke: jest.fn(),
      stream: jest.fn(),
    });

    it('should create adapter with LangChain model', () => {
      const mockModel = createMockModel();
      const adapter = new LangChainAdapter({ model: mockModel });
      expect(adapter).toBeDefined();
    });

    it('should make completion request with correct format', async () => {
      const mockModel = createMockModel();
      mockModel.invoke.mockResolvedValueOnce({
        content: 'Hello!',
        response_metadata: {
          finish_reason: 'stop',
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        },
      });

      const adapter = new LangChainAdapter({ model: mockModel });
      const prompt: AgentPrompt = {
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'Hi' }],
      };

      const result = await adapter.completion(prompt);

      expect(mockModel.invoke).toHaveBeenCalled();
      expect(result.content).toBe('Hello!');
      expect(result.finishReason).toBe('stop');
      expect(result.usage?.promptTokens).toBe(10);
      expect(result.usage?.completionTokens).toBe(5);
    });

    it('should handle tool calls in response', async () => {
      const mockModel = createMockModel();
      mockModel.invoke.mockResolvedValueOnce({
        content: '',
        tool_calls: [
          {
            id: 'call-1',
            name: 'get_weather',
            args: { city: 'Paris' },
          },
        ],
        response_metadata: {
          finish_reason: 'tool_calls',
        },
      });

      const adapter = new LangChainAdapter({ model: mockModel });
      const tools: AgentToolDefinition[] = [
        {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object', properties: { city: { type: 'string' } } },
        },
      ];

      const result = await adapter.completion({ messages: [{ role: 'user', content: 'Weather in Paris?' }] }, tools);

      expect(result.finishReason).toBe('tool_calls');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls?.[0].name).toBe('get_weather');
      expect(result.toolCalls?.[0].arguments).toEqual({ city: 'Paris' });
    });

    it('should include tools in invoke options', async () => {
      const mockModel = createMockModel();
      mockModel.invoke.mockResolvedValueOnce({
        content: 'I can help with that!',
        response_metadata: { finish_reason: 'stop' },
      });

      const adapter = new LangChainAdapter({ model: mockModel });
      const tools: AgentToolDefinition[] = [
        {
          name: 'calculator',
          description: 'Calculate math',
          parameters: { type: 'object', properties: { expression: { type: 'string' } } },
        },
      ];

      await adapter.completion({ messages: [{ role: 'user', content: 'What is 2+2?' }] }, tools);

      expect(mockModel.invoke).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          tools: expect.arrayContaining([
            expect.objectContaining({
              type: 'function',
              function: expect.objectContaining({
                name: 'calculator',
                description: 'Calculate math',
              }),
            }),
          ]),
        }),
      );
    });

    it('should handle LLM errors', async () => {
      const mockModel = createMockModel();
      mockModel.invoke.mockRejectedValueOnce(new Error('API rate limit exceeded'));

      const adapter = new LangChainAdapter({ model: mockModel });

      await expect(adapter.completion({ messages: [{ role: 'user', content: 'Hi' }] })).rejects.toThrow(
        LlmAdapterError,
      );
    });

    it('should convert system message correctly', async () => {
      const mockModel = createMockModel();
      mockModel.invoke.mockResolvedValueOnce({
        content: 'Response',
        response_metadata: { finish_reason: 'stop' },
      });

      const adapter = new LangChainAdapter({ model: mockModel });
      await adapter.completion({
        system: 'You are a helpful assistant',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      // Check that system message is first
      const callArgs = mockModel.invoke.mock.calls[0][0];
      expect(callArgs[0]._getType()).toBe('system');
      expect(callArgs[1]._getType()).toBe('human');
    });

    it('should handle assistant messages with tool calls', async () => {
      const mockModel = createMockModel();
      mockModel.invoke.mockResolvedValueOnce({
        content: 'Final response',
        response_metadata: { finish_reason: 'stop' },
      });

      const adapter = new LangChainAdapter({ model: mockModel });
      await adapter.completion({
        messages: [
          { role: 'user', content: 'Calculate 2+2' },
          {
            role: 'assistant',
            content: null,
            toolCalls: [{ id: 'call-1', name: 'calculator', arguments: { expr: '2+2' } }],
          },
          { role: 'tool', content: '4', toolCallId: 'call-1', name: 'calculator' },
        ],
      });

      const callArgs = mockModel.invoke.mock.calls[0][0];
      expect(callArgs[1]._getType()).toBe('ai');
      expect(callArgs[2]._getType()).toBe('tool');
    });

    it('should map finish reasons correctly', async () => {
      const mockModel = createMockModel();

      const finishReasons = [
        { input: 'stop', expected: 'stop' },
        { input: 'end_turn', expected: 'stop' },
        { input: 'length', expected: 'length' },
        { input: 'max_tokens', expected: 'length' },
        { input: 'tool_calls', expected: 'tool_calls' },
        { input: 'tool_use', expected: 'tool_calls' },
        { input: 'content_filter', expected: 'content_filter' },
      ];

      const adapter = new LangChainAdapter({ model: mockModel });

      for (const { input, expected } of finishReasons) {
        mockModel.invoke.mockResolvedValueOnce({
          content: 'Response',
          response_metadata: { finish_reason: input },
        });

        const result = await adapter.completion({
          messages: [{ role: 'user', content: 'Test' }],
        });

        expect(result.finishReason).toBe(expected);
      }
    });

    describe('streaming', () => {
      it('should fall back to non-streaming when stream not available', async () => {
        const mockModel = {
          invoke: jest.fn().mockResolvedValue({
            content: 'Streamed response',
            response_metadata: { finish_reason: 'stop' },
          }),
          // No stream method
        };

        const adapter = new LangChainAdapter({ model: mockModel });
        const chunks: unknown[] = [];

        for await (const chunk of adapter.streamCompletion({
          messages: [{ role: 'user', content: 'Hi' }],
        })) {
          chunks.push(chunk);
        }

        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toEqual(
          expect.objectContaining({
            type: 'done',
            completion: expect.objectContaining({
              content: 'Streamed response',
              finishReason: 'stop',
            }),
          }),
        );
      });

      it('should stream content chunks', async () => {
        const mockModel = createMockModel();

        async function* mockStream() {
          yield { content: 'Hello' };
          yield { content: ' World' };
          yield { content: '!' };
          yield { response_metadata: { finish_reason: 'stop' } };
        }

        mockModel.stream.mockReturnValue(mockStream());

        const adapter = new LangChainAdapter({ model: mockModel });
        const chunks: unknown[] = [];

        for await (const chunk of adapter.streamCompletion({
          messages: [{ role: 'user', content: 'Hi' }],
        })) {
          chunks.push(chunk);
        }

        expect(chunks.filter((c) => (c as { type: string }).type === 'content')).toHaveLength(3);
        expect(chunks[chunks.length - 1]).toEqual(
          expect.objectContaining({
            type: 'done',
            completion: expect.objectContaining({
              content: 'Hello World!',
              finishReason: 'stop',
            }),
          }),
        );
      });

      it('should handle streaming tool calls', async () => {
        const mockModel = createMockModel();

        async function* mockStream() {
          yield {
            tool_calls: [{ id: 'call-1', name: 'get_weather', args: { city: 'Paris' } }],
          };
          yield { response_metadata: { finish_reason: 'tool_calls' } };
        }

        mockModel.stream.mockReturnValue(mockStream());

        const adapter = new LangChainAdapter({ model: mockModel });
        const chunks: unknown[] = [];

        for await (const chunk of adapter.streamCompletion({
          messages: [{ role: 'user', content: 'Weather?' }],
        })) {
          chunks.push(chunk);
        }

        const doneChunk = chunks.find((c) => (c as { type: string }).type === 'done');
        expect(doneChunk).toEqual(
          expect.objectContaining({
            type: 'done',
            completion: expect.objectContaining({
              finishReason: 'tool_calls',
              toolCalls: expect.arrayContaining([
                expect.objectContaining({
                  id: 'call-1',
                  name: 'get_weather',
                  arguments: { city: 'Paris' },
                }),
              ]),
            }),
          }),
        );
      });
    });
  });

  describe('createAdapter', () => {
    it('should throw deprecation error for OpenAI string shortcut', () => {
      const config: AgentLlmBuiltinConfig = {
        adapter: 'openai',
        model: 'gpt-4-turbo',
        apiKey: 'test-key',
      };

      expect(() => createAdapter(config)).toThrow(LlmAdapterError);
      expect(() => createAdapter(config)).toThrow(/deprecated/i);
    });

    it('should throw deprecation error for Anthropic string shortcut', () => {
      const config: AgentLlmBuiltinConfig = {
        adapter: 'anthropic',
        model: 'claude-3-opus-20240229',
        apiKey: 'test-key',
      };

      expect(() => createAdapter(config)).toThrow(LlmAdapterError);
      expect(() => createAdapter(config)).toThrow(/deprecated/i);
    });

    it('should throw deprecation error for OpenRouter string shortcut', () => {
      const config: AgentLlmBuiltinConfig = {
        adapter: 'openrouter',
        model: 'anthropic/claude-3-opus',
        apiKey: 'test-key',
      };

      expect(() => createAdapter(config)).toThrow(LlmAdapterError);
      expect(() => createAdapter(config)).toThrow(/deprecated/i);
    });

    it('should throw deprecation error for LangChain string shortcut', () => {
      const config: AgentLlmBuiltinConfig = {
        adapter: 'langchain',
        model: 'gpt-4-turbo',
        apiKey: 'test-key',
      };

      expect(() => createAdapter(config)).toThrow(LlmAdapterError);
      expect(() => createAdapter(config)).toThrow(/deprecated/i);
    });

    it('should use provided adapter instance directly', () => {
      const customAdapter: AgentLlmAdapter = {
        completion: jest.fn(),
      };

      const config: AgentLlmAdapterConfig = {
        adapter: customAdapter,
      };

      const adapter = createAdapter(config);
      expect(adapter).toBe(customAdapter);
    });

    it('should use LangChainAdapter instance directly', () => {
      const mockModel = {
        invoke: jest.fn(),
        stream: jest.fn(),
      };

      const langChainAdapter = new LangChainAdapter({ model: mockModel });
      const config: AgentLlmAdapterConfig = {
        adapter: langChainAdapter,
      };

      const adapter = createAdapter(config);
      expect(adapter).toBe(langChainAdapter);
    });

    it('should call factory function when provided', () => {
      const mockAdapter: AgentLlmAdapter = {
        completion: jest.fn(),
      };

      const factory = jest.fn().mockReturnValue(mockAdapter);

      const config: AgentLlmAdapterConfig = {
        adapter: factory,
      };

      const adapter = createAdapter(config);
      expect(factory).toHaveBeenCalled();
      expect(adapter).toBe(mockAdapter);
    });

    it('should pass provider resolver to factory function', () => {
      const mockAdapter: AgentLlmAdapter = {
        completion: jest.fn(),
      };

      const factory = jest.fn().mockReturnValue(mockAdapter);
      const mockProviderResolver = {
        get: jest.fn(),
        tryGet: jest.fn(),
      };

      const config: AgentLlmAdapterConfig = {
        adapter: factory,
      };

      createAdapter(config, { providerResolver: mockProviderResolver });
      expect(factory).toHaveBeenCalledWith(mockProviderResolver);
    });

    it('should resolve adapter from DI token', () => {
      const mockAdapter: AgentLlmAdapter = {
        completion: jest.fn(),
      };

      const token = Symbol('LLM_ADAPTER');
      const mockProviderResolver = {
        get: jest.fn().mockReturnValue(mockAdapter),
        tryGet: jest.fn(),
      };

      const adapter = createAdapter(token, { providerResolver: mockProviderResolver });
      expect(mockProviderResolver.get).toHaveBeenCalledWith(token);
      expect(adapter).toBe(mockAdapter);
    });

    it('should throw when DI token not found', () => {
      const token = Symbol('MISSING_ADAPTER');
      const mockProviderResolver = {
        get: jest.fn().mockReturnValue(undefined),
        tryGet: jest.fn(),
      };

      expect(() => createAdapter(token, { providerResolver: mockProviderResolver })).toThrow(LlmAdapterError);
    });

    it('should throw when DI token used without resolver', () => {
      const token = Symbol('LLM_ADAPTER');

      expect(() => createAdapter(token)).toThrow(LlmAdapterError);
      expect(() => createAdapter(token)).toThrow(/ProviderResolver required/);
    });

    it('should handle direct adapter instance passed without wrapper', () => {
      const directAdapter: AgentLlmAdapter = {
        completion: jest.fn(),
      };

      // Pass adapter directly (not wrapped in { adapter: ... })
      const adapter = createAdapter(directAdapter as unknown as AgentLlmAdapterConfig);
      expect(adapter).toBe(directAdapter);
    });
  });
});
