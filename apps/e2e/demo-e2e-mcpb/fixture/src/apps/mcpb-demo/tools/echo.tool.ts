import { z } from 'zod';

import { Tool, ToolContext } from '@frontmcp/sdk';

@Tool({
  name: 'echo',
  description: 'Echo a message back verbatim',
  inputSchema: {
    message: z.string(),
  },
})
export default class EchoTool extends ToolContext {
  async execute(input: { message: string }) {
    return { message: input.message };
  }
}
