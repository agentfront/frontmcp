import type OpenAI from 'openai';

type ChatCompletion = OpenAI.Chat.Completions.ChatCompletion;
type ChatCompletionCreateParamsNonStreaming = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

/**
 * Creates a mock OpenAI client that returns TWO tool_calls in a single turn.
 *
 * Turn 1: Returns get-data({key:"multi-key"}) + add-numbers({a:7,b:3})
 * Turn 2: Returns combined final result
 */
export function createMultiToolOpenAIMock() {
  const client = {
    chat: {
      completions: {
        create: async (params: ChatCompletionCreateParamsNonStreaming): Promise<ChatCompletion> => {
          const messages = params.messages;
          const hasToolResults = messages.some((m) => m.role === 'tool');

          if (!hasToolResults) {
            // First call: return TWO tool_calls
            return {
              id: 'chatcmpl-multi-1',
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
                        id: 'call_multi_1',
                        type: 'function',
                        function: {
                          name: 'get-data',
                          arguments: JSON.stringify({ key: 'multi-key' }),
                        },
                      },
                      {
                        id: 'call_multi_2',
                        type: 'function',
                        function: {
                          name: 'add-numbers',
                          arguments: JSON.stringify({ a: 7, b: 3 }),
                        },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                  logprobs: null,
                },
              ],
              usage: {
                prompt_tokens: 60,
                completion_tokens: 30,
                total_tokens: 90,
              },
            } as ChatCompletion;
          }

          // Second call: collect all tool results
          const toolResults: string[] = [];
          for (const m of messages) {
            if (m.role === 'tool' && 'content' in m) {
              toolResults.push(String(m.content));
            }
          }

          return {
            id: 'chatcmpl-multi-2',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'gpt-4o',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: JSON.stringify({ answer: `Combined: ${toolResults.join(' | ')}` }),
                  refusal: null,
                },
                finish_reason: 'stop',
                logprobs: null,
              },
            ],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 40,
              total_tokens: 140,
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
