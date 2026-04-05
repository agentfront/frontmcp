import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = { msg: z.string().default('ping') };

/**
 * Tool constrained to serverless deployment.
 * e2e tests run standalone, so this should NOT be visible.
 */
@Tool({
  name: 'serverless_only_tool',
  description: 'Tool only available in serverless deployment (should be filtered)',
  inputSchema,
  availableWhen: { deployment: ['serverless'] },
})
export default class ServerlessOnlyTool extends ToolContext {
  async execute(input: { msg: string }) {
    return `serverless: ${input.msg}`;
  }
}
