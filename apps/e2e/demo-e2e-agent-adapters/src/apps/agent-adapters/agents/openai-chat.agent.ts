import { z } from '@frontmcp/lazy-zod';
import { Agent, AgentContext, OpenAIAdapter } from '@frontmcp/sdk';

import { createOpenAIChatMock } from '../mocks/openai-chat-mock';
import { AddNumbersTool } from '../tools/add-numbers.tool';
import { GetDataTool } from '../tools/get-data.tool';

const chatMock = createOpenAIChatMock();

@Agent({
  id: 'openai-chat-agent',
  name: 'openai-chat-agent',
  description: 'Agent using OpenAI Chat Completions API adapter with mock client',
  systemInstructions: 'You are a helpful assistant. Use tools when needed.',
  inputSchema: {
    query: z.string().describe('The query to process'),
  },
  llm: {
    adapter: new OpenAIAdapter({
      model: 'gpt-4o',
      api: 'chat',
      client: chatMock as never,
    }),
  },
  tools: [GetDataTool, AddNumbersTool],
})
export class OpenAIChatAgent extends AgentContext {}
