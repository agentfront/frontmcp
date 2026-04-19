import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = { msg: z.string().default('ping') };

/**
 * Tool constrained to NODE_ENV=development.
 * In default e2e runs (NODE_ENV=test) this should be filtered.
 * When the server is started with NODE_ENV=development, this should be visible.
 */
@Tool({
  name: 'development_only_tool',
  description: 'Tool only available when NODE_ENV=development',
  inputSchema,
  availableWhen: { env: ['development'] },
})
export default class DevelopmentOnlyTool extends ToolContext {
  async execute(input: { msg: string }) {
    return `development: ${input.msg}`;
  }
}
