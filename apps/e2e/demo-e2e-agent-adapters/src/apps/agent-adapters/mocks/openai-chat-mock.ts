import type OpenAI from 'openai';

type ChatCompletion = OpenAI.Chat.Completions.ChatCompletion;
type ChatCompletionCreateParamsNonStreaming = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

/**
 * Creates a mock OpenAI client for Chat Completions API.
 *
 * Turn 1: Returns tool_calls for get-data({key:"test-key"})
 * Turn 2: Returns final text incorporating tool results
 */
export function createOpenAIChatMock() {
  const client = {
    chat: {
      completions: {
        create: async (params: ChatCompletionCreateParamsNonStreaming): Promise<ChatCompletion> => {
          const messages = params.messages;
          const hasToolResults = messages.some((m) => m.role === 'tool');

          if (!hasToolResults) {
            // First call: return tool_calls
            return {
              id: 'chatcmpl-mock-1',
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model: 'gpt-4o',
              choices: [
                {
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: null,
                    refusal: null,
                    tool_calls: [
                      {
                        id: 'call_mock_1',
                        type: 'function',
                        function: {
                          name: 'get-data',
                          arguments: JSON.stringify({ key: 'test-key' }),
                        },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                  logprobs: null,
                },
              ],
              usage: {
                prompt_tokens: 50,
                completion_tokens: 20,
                total_tokens: 70,
              },
            } as ChatCompletion;
          }

          // Second call: extract tool result and return final text
          const toolMsg = messages.find((m) => m.role === 'tool');
          const toolContent = toolMsg && 'content' in toolMsg ? String(toolMsg.content) : '';

          return {
            id: 'chatcmpl-mock-2',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'gpt-4o',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: JSON.stringify({ answer: `Got data: ${toolContent}` }),
                  refusal: null,
                },
                finish_reason: 'stop',
                logprobs: null,
              },
            ],
            usage: {
              prompt_tokens: 80,
              completion_tokens: 30,
              total_tokens: 110,
            },
          } as ChatCompletion;
        },
      },
    },
    responses: {
      create: async (): Promise<never> => {
        throw new Error('Not used');
      },
    },
  };

  return client;
}
