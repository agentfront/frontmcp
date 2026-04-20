import { z } from '@frontmcp/lazy-zod';
import { Agent, AgentContext, AnthropicAdapter } from '@frontmcp/sdk';

import { createAnthropicMock } from '../mocks/anthropic-mock';
import { AddNumbersTool } from '../tools/add-numbers.tool';
import { GetDataTool } from '../tools/get-data.tool';

const anthropicMock = createAnthropicMock();

@Agent({
  id: 'anthropic-agent',
  name: 'anthropic-agent',
  description: 'Agent using Anthropic adapter with mock client',
  systemInstructions: 'You are a helpful assistant. Use tools when needed.',
  inputSchema: {
    query: z.string().describe('The query to process'),
  },
  llm: {
    adapter: new AnthropicAdapter({
      model: 'claude-sonnet-4-20250514',
      client: anthropicMock as never,
    }),
  },
  tools: [GetDataTool, AddNumbersTool],
})
export class AnthropicAgent extends AgentContext {}
