/**
 * Unit tests for LLM Adapters
 */

import 'reflect-metadata';
import { OpenAIAdapter, AnthropicAdapter, createAdapter, LlmAdapterError } from '../adapters';
import {
  AgentLlmBuiltinConfig,
  AgentLlmAdapterConfig,
  AgentLlmAdapter,
  AgentPrompt,
  AgentToolDefinition,
  AgentCompletion,
} from '../../common';

describe('LLM Adapters', () => {
  describe('OpenAIAdapter', () => {
    const createMockOpenAIClient = () => ({
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
      responses: {
        create: jest.fn(),
      },
    });

    it('should create adapter with client', () => {
      const mockClient = createMockOpenAIClient();
      const adapter = new OpenAIAdapter({ model: 'gpt-4o', client: mockClient as never });
      expect(adapter).toBeDefined();
    });

    it('should create adapter with apiKey', () => {
      const adapter = new OpenAIAdapter({ model: 'gpt-4o', apiKey: 'sk-test' });
      expect(adapter).toBeDefined();
    });

    it('should make completion request and parse response', async () => {
      const mockClient = createMockOpenAIClient();
      mockClient.chat.completions.create.mockResolvedValueOnce({
        choices: [
          {
            message: { role: 'assistant', content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      });

      const adapter = new OpenAIAdapter({ model: 'gpt-4o', client: mockClient as never });
      const prompt: AgentPrompt = {
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'Hi' }],
      };

      const result = await adapter.completion(prompt);

      expect(mockClient.chat.completions.create).toHaveBeenCalled();
      expect(result.content).toBe('Hello!');
      expect(result.finishReason).toBe('stop');
      expect(result.usage?.promptTokens).toBe(10);
      expect(result.usage?.completionTokens).toBe(5);
    });

    it('should handle tool calls in response', async () => {
      const mockClient = createMockOpenAIClient();
      mockClient.chat.completions.create.mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      });

      const adapter = new OpenAIAdapter({ model: 'gpt-4o', client: mockClient as never });
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

    it('should format tools in OpenAI format', async () => {
      const mockClient = createMockOpenAIClient();
      mockClient.chat.completions.create.mockResolvedValueOnce({
        choices: [
          {
            message: { role: 'assistant', content: 'I can help with that!' },
            finish_reason: 'stop',
          },
        ],
      });

      const adapter = new OpenAIAdapter({ model: 'gpt-4o', client: mockClient as never });
      const tools: AgentToolDefinition[] = [
        {
          name: 'calculator',
          description: 'Calculate math',
          parameters: { type: 'object', properties: { expression: { type: 'string' } } },
        },
      ];

      await adapter.completion({ messages: [{ role: 'user', content: 'What is 2+2?' }] }, tools);

      const callArgs = mockClient.chat.completions.create.mock.calls[0][0];
      expect(callArgs.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'function',
            function: expect.objectContaining({
              name: 'calculator',
              description: 'Calculate math',
            }),
          }),
        ]),
      );
    });

    it('should include system message in request', async () => {
      const mockClient = createMockOpenAIClient();
      mockClient.chat.completions.create.mockResolvedValueOnce({
        choices: [
          {
            message: { role: 'assistant', content: 'Response' },
            finish_reason: 'stop',
          },
        ],
      });

      const adapter = new OpenAIAdapter({ model: 'gpt-4o', client: mockClient as never });
      await adapter.completion({
        system: 'You are a helpful assistant',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const callArgs = mockClient.chat.completions.create.mock.calls[0][0];
      expect(callArgs.messages[0]).toEqual({ role: 'system', content: 'You are a helpful assistant' });
      expect(callArgs.messages[1]).toEqual({ role: 'user', content: 'Hello' });
    });

    it('should handle assistant messages with tool calls', async () => {
      const mockClient = createMockOpenAIClient();
      mockClient.chat.completions.create.mockResolvedValueOnce({
        choices: [
          {
            message: { role: 'assistant', content: 'Final response' },
            finish_reason: 'stop',
          },
        ],
      });

      const adapter = new OpenAIAdapter({ model: 'gpt-4o', client: mockClient as never });
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

      const callArgs = mockClient.chat.completions.create.mock.calls[0][0];
      expect(callArgs.messages[1].role).toBe('assistant');
      expect(callArgs.messages[1].tool_calls).toEqual([
        { id: 'call-1', type: 'function', function: { name: 'calculator', arguments: '{"expr":"2+2"}' } },
      ]);
      expect(callArgs.messages[2]).toEqual({ role: 'tool', content: '4', tool_call_id: 'call-1' });
    });

    it('should map finish reasons correctly', async () => {
      const mockClient = createMockOpenAIClient();

      const finishReasons = [
        { input: 'stop', expected: 'stop' },
        { input: 'length', expected: 'length' },
        { input: 'tool_calls', expected: 'tool_calls' },
        { input: 'content_filter', expected: 'content_filter' },
      ];

      const adapter = new OpenAIAdapter({ model: 'gpt-4o', client: mockClient as never });

      for (const { input, expected } of finishReasons) {
        mockClient.chat.completions.create.mockResolvedValueOnce({
          choices: [
            {
              message: { role: 'assistant', content: 'Response' },
              finish_reason: input,
            },
          ],
        });

        const result = await adapter.completion({
          messages: [{ role: 'user', content: 'Test' }],
        });

        expect(result.finishReason).toBe(expected);
      }
    });

    it('should handle errors', async () => {
      const mockClient = createMockOpenAIClient();
      mockClient.chat.completions.create.mockRejectedValueOnce(
        Object.assign(new Error('Rate limit exceeded'), { status: 429 }),
      );

      const adapter = new OpenAIAdapter({
        model: 'gpt-4o',
        client: mockClient as never,
        maxRetries: 0,
      });

      await expect(adapter.completion({ messages: [{ role: 'user', content: 'Hi' }] })).rejects.toThrow(
        LlmAdapterError,
      );
    });

    it('should throw when no choices returned', async () => {
      const mockClient = createMockOpenAIClient();
      mockClient.chat.completions.create.mockResolvedValueOnce({ choices: [] });

      const adapter = new OpenAIAdapter({
        model: 'gpt-4o',
        client: mockClient as never,
        maxRetries: 0,
      });

      await expect(adapter.completion({ messages: [{ role: 'user', content: 'Hi' }] })).rejects.toThrow('no choices');
    });

    describe('streaming', () => {
      it('should stream content chunks', async () => {
        const mockClient = createMockOpenAIClient();

        const streamChunks = [
          { choices: [{ delta: { content: 'Hello' }, finish_reason: null }] },
          { choices: [{ delta: { content: ' World' }, finish_reason: null }] },
          { choices: [{ delta: { content: '!' }, finish_reason: 'stop' }] },
        ];

        mockClient.chat.completions.create.mockResolvedValueOnce({
          [Symbol.asyncIterator]: async function* () {
            for (const chunk of streamChunks) yield chunk;
          },
        });

        const adapter = new OpenAIAdapter({ model: 'gpt-4o', client: mockClient as never });
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
        const mockClient = createMockOpenAIClient();

        const streamChunks = [
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-1',
                      type: 'function',
                      function: { name: 'get_weather', arguments: '{"city' },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, function: { arguments: '":"Paris"}' } }],
                },
                finish_reason: null,
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        ];

        mockClient.chat.completions.create.mockResolvedValueOnce({
          [Symbol.asyncIterator]: async function* () {
            for (const chunk of streamChunks) yield chunk;
          },
        });

        const adapter = new OpenAIAdapter({ model: 'gpt-4o', client: mockClient as never });
        const chunks: unknown[] = [];

        for await (const chunk of adapter.streamCompletion({
          messages: [{ role: 'user', content: 'Weather?' }],
        })) {
          chunks.push(chunk);
        }

        const doneChunk = chunks.find((c) => (c as { type: string }).type === 'done') as {
          type: string;
          completion: AgentCompletion;
        };
        expect(doneChunk.completion.finishReason).toBe('tool_calls');
        expect(doneChunk.completion.toolCalls).toHaveLength(1);
        expect(doneChunk.completion.toolCalls?.[0].name).toBe('get_weather');
        expect(doneChunk.completion.toolCalls?.[0].arguments).toEqual({ city: 'Paris' });
      });
    });

    describe('Responses API', () => {
      it('should create adapter with api: responses', () => {
        const mockClient = createMockOpenAIClient();
        const adapter = new OpenAIAdapter({ model: 'gpt-4o', client: mockClient as never, api: 'responses' });
        expect(adapter).toBeDefined();
      });

      it('should make completion via Responses API', async () => {
        const mockClient = createMockOpenAIClient();
        mockClient.responses.create.mockResolvedValueOnce({
          id: 'resp-1',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'Hello from Responses!' }],
            },
          ],
          status: 'completed',
          usage: { input_tokens: 10, output_tokens: 8, total_tokens: 18 },
        });

        const adapter = new OpenAIAdapter({ model: 'gpt-4o', client: mockClient as never, api: 'responses' });
        const result = await adapter.completion({
          system: 'You are helpful',
          messages: [{ role: 'user', content: 'Hi' }],
        });

        expect(mockClient.responses.create).toHaveBeenCalled();
        expect(result.content).toBe('Hello from Responses!');
        expect(result.finishReason).toBe('stop');
        expect(result.usage?.promptTokens).toBe(10);
        expect(result.usage?.completionTokens).toBe(8);
      });

      it('should handle tool calls in Responses API', async () => {
        const mockClient = createMockOpenAIClient();
        mockClient.responses.create.mockResolvedValueOnce({
          id: 'resp-2',
          output: [
            {
              type: 'function_call',
              id: 'fc-1',
              call_id: 'call-1',
              name: 'get_weather',
              arguments: '{"city":"Paris"}',
              status: 'completed',
            },
          ],
          status: 'completed',
          usage: { input_tokens: 12, output_tokens: 15, total_tokens: 27 },
        });

        const adapter = new OpenAIAdapter({ model: 'gpt-4o', client: mockClient as never, api: 'responses' });
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
        expect(result.toolCalls?.[0].id).toBe('call-1');
      });

      it('should use developer role for system messages', async () => {
        const mockClient = createMockOpenAIClient();
        mockClient.responses.create.mockResolvedValueOnce({
          id: 'resp-3',
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'OK' }] }],
          status: 'completed',
          usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
        });

        const adapter = new OpenAIAdapter({ model: 'gpt-4o', client: mockClient as never, api: 'responses' });
        await adapter.completion({
          system: 'You are a helpful assistant',
          messages: [{ role: 'user', content: 'Hello' }],
        });

        const callArgs = mockClient.responses.create.mock.calls[0][0];
        expect(callArgs.input[0]).toEqual({ role: 'developer', content: 'You are a helpful assistant' });
        expect(callArgs.input[1]).toEqual({ role: 'user', content: 'Hello' });
      });

      it('should format tools in Responses API format', async () => {
        const mockClient = createMockOpenAIClient();
        mockClient.responses.create.mockResolvedValueOnce({
          id: 'resp-4',
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Sure!' }] }],
          status: 'completed',
          usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
        });

        const adapter = new OpenAIAdapter({ model: 'gpt-4o', client: mockClient as never, api: 'responses' });
        const tools: AgentToolDefinition[] = [
          {
            name: 'calculator',
            description: 'Calculate math',
            parameters: { type: 'object', properties: { expression: { type: 'string' } } },
          },
        ];

        await adapter.completion({ messages: [{ role: 'user', content: 'What is 2+2?' }] }, tools);

        const callArgs = mockClient.responses.create.mock.calls[0][0];
        expect(callArgs.tools).toEqual([
          {
            type: 'function',
            name: 'calculator',
            description: 'Calculate math',
            parameters: { type: 'object', properties: { expression: { type: 'string' } } },
          },
        ]);
      });

      it('should convert assistant tool calls to function_call input items', async () => {
        const mockClient = createMockOpenAIClient();
        mockClient.responses.create.mockResolvedValueOnce({
          id: 'resp-5',
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '4' }] }],
          status: 'completed',
          usage: { input_tokens: 15, output_tokens: 1, total_tokens: 16 },
        });

        const adapter = new OpenAIAdapter({ model: 'gpt-4o', client: mockClient as never, api: 'responses' });
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

        const callArgs = mockClient.responses.create.mock.calls[0][0];
        expect(callArgs.input[1]).toEqual({
          type: 'function_call',
          call_id: 'call-1',
          name: 'calculator',
          arguments: '{"expr":"2+2"}',
        });
        expect(callArgs.input[2]).toEqual({
          type: 'function_call_output',
          call_id: 'call-1',
          output: '4',
        });
      });

      it('should map incomplete status to length', async () => {
        const mockClient = createMockOpenAIClient();
        mockClient.responses.create.mockResolvedValueOnce({
          id: 'resp-6',
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Partial...' }] }],
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          usage: { input_tokens: 5, output_tokens: 100, total_tokens: 105 },
        });

        const adapter = new OpenAIAdapter({ model: 'gpt-4o', client: mockClient as never, api: 'responses' });
        const result = await adapter.completion({ messages: [{ role: 'user', content: 'Write a novel' }] });

        expect(result.finishReason).toBe('length');
      });

      it('should map content_filter incomplete reason', async () => {
        const mockClient = createMockOpenAIClient();
        mockClient.responses.create.mockResolvedValueOnce({
          id: 'resp-7',
          output: [],
          status: 'incomplete',
          incomplete_details: { reason: 'content_filter' },
          usage: { input_tokens: 5, output_tokens: 0, total_tokens: 5 },
        });

        const adapter = new OpenAIAdapter({ model: 'gpt-4o', client: mockClient as never, api: 'responses' });
        const result = await adapter.completion({ messages: [{ role: 'user', content: 'Blocked content' }] });

        expect(result.finishReason).toBe('content_filter');
      });

      it('should accumulate content from multiple message items', async () => {
        const mockClient = createMockOpenAIClient();
        mockClient.responses.create.mockResolvedValueOnce({
          id: 'resp-multi',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'First part. ' }],
            },
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'Second part.' }],
            },
          ],
          status: 'completed',
          usage: { input_tokens: 10, output_tokens: 8, total_tokens: 18 },
        });

        const adapter = new OpenAIAdapter({ model: 'gpt-4o', client: mockClient as never, api: 'responses' });
        const result = await adapter.completion({
          messages: [{ role: 'user', content: 'Hi' }],
        });

        expect(result.content).toBe('First part. Second part.');
      });

      it('should throw when tool message is missing toolCallId in Responses API', async () => {
        const mockClient = createMockOpenAIClient();
        mockClient.responses.create.mockResolvedValueOnce({
          id: 'resp-err',
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'OK' }] }],
          status: 'completed',
          usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
        });

        const adapter = new OpenAIAdapter({ model: 'gpt-4o', client: mockClient as never, api: 'responses' });

        await expect(
          adapter.completion({
            messages: [
              { role: 'user', content: 'Calculate 2+2' },
              {
                role: 'assistant',
                content: null,
                toolCalls: [{ id: 'call-1', name: 'calculator', arguments: { expr: '2+2' } }],
              },
              { role: 'tool', content: '4' } as never,
            ],
          }),
        ).rejects.toThrow(LlmAdapterError);
      });

      it('should use max_output_tokens instead of max_tokens', async () => {
        const mockClient = createMockOpenAIClient();
        mockClient.responses.create.mockResolvedValueOnce({
          id: 'resp-8',
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'OK' }] }],
          status: 'completed',
          usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
        });

        const adapter = new OpenAIAdapter({
          model: 'gpt-4o',
          client: mockClient as never,
          api: 'responses',
          maxTokens: 500,
        });
        await adapter.completion({ messages: [{ role: 'user', content: 'Hi' }] });

        const callArgs = mockClient.responses.create.mock.calls[0][0];
        expect(callArgs.max_output_tokens).toBe(500);
        expect(callArgs.max_tokens).toBeUndefined();
      });

      describe('streaming', () => {
        it('should stream content via Responses API', async () => {
          const mockClient = createMockOpenAIClient();

          const events = [
            { type: 'response.output_text.delta', output_index: 0, delta: 'Hello' },
            { type: 'response.output_text.delta', output_index: 0, delta: ' World!' },
            {
              type: 'response.completed',
              response: {
                id: 'resp-s1',
                output: [
                  { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello World!' }] },
                ],
                status: 'completed',
                usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
              },
            },
          ];

          mockClient.responses.create.mockResolvedValueOnce({
            [Symbol.asyncIterator]: async function* () {
              for (const event of events) yield event;
            },
          });

          const adapter = new OpenAIAdapter({ model: 'gpt-4o', client: mockClient as never, api: 'responses' });
          const chunks: unknown[] = [];

          for await (const chunk of adapter.streamCompletion({
            messages: [{ role: 'user', content: 'Hi' }],
          })) {
            chunks.push(chunk);
          }

          expect(chunks.filter((c) => (c as { type: string }).type === 'content')).toHaveLength(2);
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

        it('should handle streaming tool calls via Responses API', async () => {
          const mockClient = createMockOpenAIClient();

          const events = [
            {
              type: 'response.output_item.added',
              output_index: 0,
              item: { type: 'function_call', call_id: 'call-1', name: 'get_weather' },
            },
            { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"city"' },
            { type: 'response.function_call_arguments.delta', output_index: 0, delta: ':"Paris"}' },
            {
              type: 'response.function_call_arguments.done',
              output_index: 0,
              call_id: 'call-1',
              name: 'get_weather',
              arguments: '{"city":"Paris"}',
            },
            {
              type: 'response.completed',
              response: {
                id: 'resp-s2',
                output: [
                  {
                    type: 'function_call',
                    call_id: 'call-1',
                    name: 'get_weather',
                    arguments: '{"city":"Paris"}',
                    status: 'completed',
                  },
                ],
                status: 'completed',
                usage: { input_tokens: 8, output_tokens: 12, total_tokens: 20 },
              },
            },
          ];

          mockClient.responses.create.mockResolvedValueOnce({
            [Symbol.asyncIterator]: async function* () {
              for (const event of events) yield event;
            },
          });

          const adapter = new OpenAIAdapter({ model: 'gpt-4o', client: mockClient as never, api: 'responses' });
          const chunks: unknown[] = [];

          for await (const chunk of adapter.streamCompletion({
            messages: [{ role: 'user', content: 'Weather?' }],
          })) {
            chunks.push(chunk);
          }

          const doneChunk = chunks.find((c) => (c as { type: string }).type === 'done') as {
            type: string;
            completion: AgentCompletion;
          };
          expect(doneChunk.completion.finishReason).toBe('tool_calls');
          expect(doneChunk.completion.toolCalls).toHaveLength(1);
          expect(doneChunk.completion.toolCalls?.[0].name).toBe('get_weather');
          expect(doneChunk.completion.toolCalls?.[0].arguments).toEqual({ city: 'Paris' });
        });
      });
    });
  });

  describe('AnthropicAdapter', () => {
    const createMockAnthropicClient = () => ({
      messages: {
        create: jest.fn(),
      },
    });

    it('should create adapter with client', () => {
      const mockClient = createMockAnthropicClient();
      const adapter = new AnthropicAdapter({ model: 'claude-sonnet-4-20250514', client: mockClient as never });
      expect(adapter).toBeDefined();
    });

    it('should create adapter with apiKey', () => {
      const adapter = new AnthropicAdapter({ model: 'claude-sonnet-4-20250514', apiKey: 'sk-ant-test' });
      expect(adapter).toBeDefined();
    });

    it('should make completion request and parse response', async () => {
      const mockClient = createMockAnthropicClient();
      mockClient.messages.create.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Hello!' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      const adapter = new AnthropicAdapter({ model: 'claude-sonnet-4-20250514', client: mockClient as never });
      const prompt: AgentPrompt = {
        system: 'You are helpful',
        messages: [{ role: 'user', content: 'Hi' }],
      };

      const result = await adapter.completion(prompt);

      expect(mockClient.messages.create).toHaveBeenCalled();
      expect(result.content).toBe('Hello!');
      expect(result.finishReason).toBe('stop');
      expect(result.usage?.promptTokens).toBe(10);
      expect(result.usage?.completionTokens).toBe(5);
    });

    it('should handle tool calls in response', async () => {
      const mockClient = createMockAnthropicClient();
      mockClient.messages.create.mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'call-1', name: 'get_weather', input: { city: 'Paris' } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 20 },
      });

      const adapter = new AnthropicAdapter({ model: 'claude-sonnet-4-20250514', client: mockClient as never });
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

    it('should format tools in Anthropic format', async () => {
      const mockClient = createMockAnthropicClient();
      mockClient.messages.create.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Sure!' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      const adapter = new AnthropicAdapter({ model: 'claude-sonnet-4-20250514', client: mockClient as never });
      const tools: AgentToolDefinition[] = [
        {
          name: 'calculator',
          description: 'Calculate math',
          parameters: { type: 'object', properties: { expression: { type: 'string' } } },
        },
      ];

      await adapter.completion({ messages: [{ role: 'user', content: 'What is 2+2?' }] }, tools);

      const callArgs = mockClient.messages.create.mock.calls[0][0];
      expect(callArgs.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'calculator',
            description: 'Calculate math',
            input_schema: expect.objectContaining({ type: 'object' }),
          }),
        ]),
      );
    });

    it('should pass system message separately', async () => {
      const mockClient = createMockAnthropicClient();
      mockClient.messages.create.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      const adapter = new AnthropicAdapter({ model: 'claude-sonnet-4-20250514', client: mockClient as never });
      await adapter.completion({
        system: 'You are a helpful assistant',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const callArgs = mockClient.messages.create.mock.calls[0][0];
      expect(callArgs.system).toBe('You are a helpful assistant');
      expect(callArgs.messages[0]).toEqual({ role: 'user', content: 'Hello' });
    });

    it('should map stop reasons correctly', async () => {
      const mockClient = createMockAnthropicClient();

      const stopReasons = [
        { input: 'end_turn', expected: 'stop' },
        { input: 'stop_sequence', expected: 'stop' },
        { input: 'max_tokens', expected: 'length' },
        { input: 'tool_use', expected: 'tool_calls' },
      ];

      const adapter = new AnthropicAdapter({ model: 'claude-sonnet-4-20250514', client: mockClient as never });

      for (const { input, expected } of stopReasons) {
        mockClient.messages.create.mockResolvedValueOnce({
          content: [{ type: 'text', text: 'Response' }],
          stop_reason: input,
          usage: { input_tokens: 10, output_tokens: 5 },
        });

        const result = await adapter.completion({
          messages: [{ role: 'user', content: 'Test' }],
        });

        expect(result.finishReason).toBe(expected);
      }
    });

    it('should handle errors', async () => {
      const mockClient = createMockAnthropicClient();
      mockClient.messages.create.mockRejectedValueOnce(Object.assign(new Error('Rate limit'), { status: 429 }));

      const adapter = new AnthropicAdapter({
        model: 'claude-sonnet-4-20250514',
        client: mockClient as never,
        maxRetries: 0,
      });

      await expect(adapter.completion({ messages: [{ role: 'user', content: 'Hi' }] })).rejects.toThrow(
        LlmAdapterError,
      );
    });

    describe('streaming', () => {
      it('should stream content chunks', async () => {
        const mockClient = createMockAnthropicClient();

        const events = [
          { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' World!' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
          { type: 'message_stop' },
        ];

        mockClient.messages.create.mockResolvedValueOnce({
          [Symbol.asyncIterator]: async function* () {
            for (const event of events) yield event;
          },
        });

        const adapter = new AnthropicAdapter({ model: 'claude-sonnet-4-20250514', client: mockClient as never });
        const chunks: unknown[] = [];

        for await (const chunk of adapter.streamCompletion({
          messages: [{ role: 'user', content: 'Hi' }],
        })) {
          chunks.push(chunk);
        }

        expect(chunks.filter((c) => (c as { type: string }).type === 'content')).toHaveLength(2);
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
        const mockClient = createMockAnthropicClient();

        const events = [
          { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0 } } },
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: 'call-1', name: 'get_weather', input: {} },
          },
          { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"city"' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: ':"Paris"}' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } },
          { type: 'message_stop' },
        ];

        mockClient.messages.create.mockResolvedValueOnce({
          [Symbol.asyncIterator]: async function* () {
            for (const event of events) yield event;
          },
        });

        const adapter = new AnthropicAdapter({ model: 'claude-sonnet-4-20250514', client: mockClient as never });
        const chunks: unknown[] = [];

        for await (const chunk of adapter.streamCompletion({
          messages: [{ role: 'user', content: 'Weather?' }],
        })) {
          chunks.push(chunk);
        }

        const doneChunk = chunks.find((c) => (c as { type: string }).type === 'done') as {
          type: string;
          completion: AgentCompletion;
        };
        expect(doneChunk.completion.finishReason).toBe('tool_calls');
        expect(doneChunk.completion.toolCalls).toHaveLength(1);
        expect(doneChunk.completion.toolCalls?.[0].name).toBe('get_weather');
        expect(doneChunk.completion.toolCalls?.[0].arguments).toEqual({ city: 'Paris' });
      });
    });
  });

  describe('BaseLlmAdapter', () => {
    it('should validate required config fields', () => {
      expect(() => new OpenAIAdapter({ model: '', apiKey: 'test' })).toThrow('model is required');

      expect(() => new OpenAIAdapter({ model: 'gpt-4o', apiKey: '' })).toThrow('apiKey is required');
    });

    it('should validate timeout and maxRetries', () => {
      expect(() => new OpenAIAdapter({ model: 'gpt-4o', apiKey: 'test', timeout: -1 })).toThrow(
        'timeout must be a positive number',
      );

      expect(() => new OpenAIAdapter({ model: 'gpt-4o', apiKey: 'test', maxRetries: -1 })).toThrow(
        'maxRetries must be a non-negative number',
      );
    });
  });

  describe('createAdapter', () => {
    it('should create adapter for OpenAI provider shorthand', () => {
      const config: AgentLlmBuiltinConfig = {
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'test-key',
      };

      const adapter = createAdapter(config);
      expect(adapter).toBeDefined();
      expect(typeof adapter.completion).toBe('function');
    });

    it('should create adapter for Anthropic provider shorthand', () => {
      const config: AgentLlmBuiltinConfig = {
        provider: 'anthropic',
        model: 'claude-3-opus-latest',
        apiKey: 'test-key',
      };

      const adapter = createAdapter(config);
      expect(adapter).toBeDefined();
      expect(typeof adapter.completion).toBe('function');
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

    it('should use OpenAIAdapter instance directly', () => {
      const mockClient = {
        chat: { completions: { create: jest.fn() } },
        responses: { create: jest.fn() },
      };

      const openaiAdapter = new OpenAIAdapter({ model: 'gpt-4o', client: mockClient as never });
      const config: AgentLlmAdapterConfig = {
        adapter: openaiAdapter,
      };

      const adapter = createAdapter(config);
      expect(adapter).toBe(openaiAdapter);
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
