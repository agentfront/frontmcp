import { Agent, AgentContext, OpenAIAdapter } from '@frontmcp/sdk';
import { z } from 'zod';
import { createOpenAIResponsesMock } from '../mocks/openai-responses-mock';
import { GetDataTool } from '../tools/get-data.tool';

const responsesMock = createOpenAIResponsesMock();

@Agent({
  id: 'openai-responses-agent',
  name: 'openai-responses-agent',
  description: 'Agent using OpenAI Responses API adapter with mock client',
  systemInstructions: 'You are a helpful assistant. Use tools when needed.',
  inputSchema: {
    query: z.string().describe('The query to process'),
  },
  llm: {
    adapter: new OpenAIAdapter({
      model: 'gpt-4o',
      api: 'responses',
      client: responsesMock as never,
    }),
  },
  tools: [GetDataTool],
})
export class OpenAIResponsesAgent extends AgentContext {}
