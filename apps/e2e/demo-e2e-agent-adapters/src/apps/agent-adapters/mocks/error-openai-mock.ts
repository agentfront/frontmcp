import type OpenAI from 'openai';

type ChatCompletion = OpenAI.Chat.Completions.ChatCompletion;
type ChatCompletionCreateParamsNonStreaming = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

/**
 * Creates a mock OpenAI client that triggers the failing-tool.
 *
 * Turn 1: Returns tool_calls for failing-tool
 * Turn 2: Returns text incorporating the error message
 */
export function createErrorOpenAIMock() {
  const client = {
    chat: {
      completions: {
        create: async (params: ChatCompletionCreateParamsNonStreaming): Promise<ChatCompletion> => {
          const messages = params.messages;
          const hasToolResults = messages.some((m) => m.role === 'tool');

          if (!hasToolResults) {
            // First call: trigger failing-tool
            return {
              id: 'chatcmpl-error-1',
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
                        id: 'call_error_1',
                        type: 'function',
                        function: {
                          name: 'failing-tool',
                          arguments: JSON.stringify({ input: 'test' }),
                        },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                  logprobs: null,
                },
              ],
              usage: {
                prompt_tokens: 40,
                completion_tokens: 15,
                total_tokens: 55,
              },
            } as ChatCompletion;
          }

          // Second call: extract error from tool result and report it
          const toolMsg = messages.find((m) => m.role === 'tool');
          const toolContent = toolMsg && 'content' in toolMsg ? String(toolMsg.content) : '';

          return {
            id: 'chatcmpl-error-2',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'gpt-4o',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: JSON.stringify({ answer: `Tool failed: ${toolContent}` }),
                  refusal: null,
                },
                finish_reason: 'stop',
                logprobs: null,
              },
            ],
            usage: {
              prompt_tokens: 60,
              completion_tokens: 20,
              total_tokens: 80,
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
