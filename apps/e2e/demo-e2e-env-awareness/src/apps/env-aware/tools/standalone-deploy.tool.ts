import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = { msg: z.string().default('ping') };

/**
 * Tool constrained to standalone deployment (non-serverless).
 * e2e tests run standalone, so this should be visible.
 */
@Tool({
  name: 'standalone_deploy_tool',
  description: 'Tool only available in standalone deployment',
  inputSchema,
  availableWhen: { deployment: ['standalone'] },
})
export default class StandaloneDeployTool extends ToolContext {
  async execute(input: { msg: string }) {
    return `standalone: ${input.msg}`;
  }
}
