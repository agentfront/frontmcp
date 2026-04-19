import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = { msg: z.string().default('ping') };

/**
 * Tool constrained to browser runtime.
 * Since e2e tests run in Node, this should NEVER be visible.
 */
@Tool({
  name: 'browser_only_tool',
  description: 'Tool only available in browser runtime (should be filtered)',
  inputSchema,
  availableWhen: { runtime: ['browser'] },
})
export default class BrowserOnlyTool extends ToolContext {
  async execute(input: { msg: string }) {
    return `browser: ${input.msg}`;
  }
}
