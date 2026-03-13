import type OpenAI from 'openai';

type Response = OpenAI.Responses.Response;
type ResponseCreateParamsNonStreaming = OpenAI.Responses.ResponseCreateParamsNonStreaming;

/**
 * Creates a mock OpenAI client for Responses API.
 *
 * Turn 1: Returns function_call output for get-data({key:"responses-key"})
 * Turn 2: Returns message output with text
 */
export function createOpenAIResponsesMock() {
  const client = {
    chat: {
      completions: {
        create: async (): Promise<never> => {
          throw new Error('Not used');
        },
      },
    },
    responses: {
      create: async (params: ResponseCreateParamsNonStreaming): Promise<Response> => {
        const input = params.input;
        const hasFunctionOutput =
          Array.isArray(input) && input.some((i: unknown) => (i as { type?: string }).type === 'function_call_output');

        if (!hasFunctionOutput) {
          // First call: return function_call
          return {
            id: 'resp-mock-1',
            object: 'response',
            created_at: Math.floor(Date.now() / 1000),
            model: 'gpt-4o',
            status: 'completed',
            output: [
              {
                type: 'function_call',
                id: 'fc_mock_1',
                call_id: 'call_resp_1',
                name: 'get-data',
                arguments: JSON.stringify({ key: 'responses-key' }),
                status: 'completed',
              },
            ],
            incomplete_details: null,
            usage: {
              input_tokens: 40,
              output_tokens: 15,
              total_tokens: 55,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens_details: { reasoning_tokens: 0 },
            },
          } as unknown as Response;
        }

        // Second call: extract function output and return message
        const funcOutput = Array.isArray(input)
          ? input.find((i: unknown) => (i as { type?: string }).type === 'function_call_output')
          : undefined;
        const outputContent = funcOutput && 'output' in funcOutput ? String(funcOutput.output) : '';

        return {
          id: 'resp-mock-2',
          object: 'response',
          created_at: Math.floor(Date.now() / 1000),
          model: 'gpt-4o',
          status: 'completed',
          output: [
            {
              type: 'message',
              id: 'msg_mock_1',
              role: 'assistant',
              status: 'completed',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({ answer: `Got data: ${outputContent}` }),
                  annotations: [],
                },
              ],
            },
          ],
          incomplete_details: null,
          usage: {
            input_tokens: 60,
            output_tokens: 25,
            total_tokens: 85,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        } as unknown as Response;
      },
    },
  };

  return client;
}
