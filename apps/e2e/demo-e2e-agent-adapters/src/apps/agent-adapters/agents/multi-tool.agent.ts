import { z } from '@frontmcp/lazy-zod';
import { Agent, AgentContext, OpenAIAdapter } from '@frontmcp/sdk';

import { createMultiToolOpenAIMock } from '../mocks/multi-tool-openai-mock';
import { AddNumbersTool } from '../tools/add-numbers.tool';
import { GetDataTool } from '../tools/get-data.tool';

const multiToolMock = createMultiToolOpenAIMock();

@Agent({
  id: 'multi-tool-agent',
  name: 'multi-tool-agent',
  description: 'Agent that exercises multiple tool calls in a single turn',
  systemInstructions: 'You are a helpful assistant. Use multiple tools when needed.',
  inputSchema: {
    query: z.string().describe('The query to process'),
  },
  llm: {
    adapter: new OpenAIAdapter({
      model: 'gpt-4o',
      client: multiToolMock as never,
    }),
  },
  tools: [GetDataTool, AddNumbersTool],
})
export class MultiToolAgent extends AgentContext {}
