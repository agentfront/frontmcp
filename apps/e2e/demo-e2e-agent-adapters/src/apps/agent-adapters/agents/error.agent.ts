import { z } from '@frontmcp/lazy-zod';
import { Agent, AgentContext, OpenAIAdapter } from '@frontmcp/sdk';

import { createErrorOpenAIMock } from '../mocks/error-openai-mock';
import { FailingTool } from '../tools/failing.tool';

const errorMock = createErrorOpenAIMock();

@Agent({
  id: 'error-agent',
  name: 'error-agent',
  description: 'Agent that exercises error handling via a failing tool',
  systemInstructions: 'You are a helpful assistant. Use tools when needed.',
  inputSchema: {
    query: z.string().describe('The query to process'),
  },
  llm: {
    adapter: new OpenAIAdapter({
      model: 'gpt-4o',
      client: errorMock as never,
    }),
  },
  tools: [FailingTool],
})
export class ErrorAgent extends AgentContext {}
