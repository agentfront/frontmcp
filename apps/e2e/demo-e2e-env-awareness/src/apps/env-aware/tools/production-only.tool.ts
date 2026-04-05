import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = { msg: z.string().default('ping') };

/**
 * Tool constrained to NODE_ENV=production.
 * In default e2e runs (NODE_ENV=test) this should be filtered.
 * When the server is started with NODE_ENV=production, this should be visible.
 */
@Tool({
  name: 'production_only_tool',
  description: 'Tool only available when NODE_ENV=production',
  inputSchema,
  availableWhen: { env: ['production'] },
})
export default class ProductionOnlyTool extends ToolContext {
  async execute(input: { msg: string }) {
    return `production: ${input.msg}`;
  }
}
