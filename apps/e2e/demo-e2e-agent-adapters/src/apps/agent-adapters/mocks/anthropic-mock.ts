import type Anthropic from '@anthropic-ai/sdk';

type Message = Anthropic.Message;
type MessageCreateParamsNonStreaming = Anthropic.MessageCreateParamsNonStreaming;

/**
 * Creates a mock Anthropic client.
 *
 * Turn 1: Returns tool_use block for get-data({key:"anthropic-key"})
 * Turn 2: Returns text block with final response
 */
export function createAnthropicMock() {
  const client = {
    messages: {
      create: async (params: MessageCreateParamsNonStreaming): Promise<Message> => {
        const hasToolResults = params.messages.some(
          (m) =>
            m.role === 'user' &&
            Array.isArray(m.content) &&
            (m.content as Array<Record<string, unknown>>).some((b) => b.type === 'tool_result'),
        );

        if (!hasToolResults) {
          // First call: return tool_use
          return {
            id: 'msg-mock-1',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-4-20250514',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_mock_1',
                name: 'get-data',
                input: { key: 'anthropic-key' },
              },
            ],
            stop_reason: 'tool_use',
            stop_sequence: null,
            usage: {
              input_tokens: 45,
              output_tokens: 18,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          } as unknown as Message;
        }

        // Second call: extract tool result and return text
        let toolContent = '';
        for (const m of params.messages) {
          if (m.role === 'user' && Array.isArray(m.content)) {
            for (const block of m.content as Array<Record<string, unknown>>) {
              if (block.type === 'tool_result' && typeof block.content === 'string') {
                toolContent = block.content;
              }
            }
          }
        }

        return {
          id: 'msg-mock-2',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-20250514',
          content: [
            {
              type: 'text',
              text: JSON.stringify({ answer: `Got data: ${toolContent}` }),
            },
          ],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 70,
            output_tokens: 25,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        } as unknown as Message;
      },
    },
  };

  return client;
}
