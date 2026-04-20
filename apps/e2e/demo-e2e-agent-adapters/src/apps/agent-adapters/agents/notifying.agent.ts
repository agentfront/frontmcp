import { z } from '@frontmcp/lazy-zod';
import { Agent, AgentContext, OpenAIAdapter } from '@frontmcp/sdk';

import { createOpenAIChatMock } from '../mocks/openai-chat-mock';
import { GetDataTool } from '../tools/get-data.tool';

const chatMock = createOpenAIChatMock();

@Agent({
  id: 'notifying-agent',
  name: 'notifying-agent',
  description: 'Agent with auto-progress and notifications enabled',
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
  tools: [GetDataTool],
  execution: {
    enableAutoProgress: true,
    enableNotifications: true,
  },
})
export class NotifyingAgent extends AgentContext {}
