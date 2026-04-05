import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = { msg: z.string().default('ping') };

/**
 * Tool with multiple constraints where one field fails.
 * Platform matches, but runtime is browser — AND semantics means this is filtered.
 */
@Tool({
  name: 'multi_constraint_fail_tool',
  description: 'Tool with one matching and one non-matching constraint (should be filtered)',
  inputSchema,
  availableWhen: {
    platform: [process.platform], // matches
    runtime: ['browser'], // does NOT match (we run in Node)
  },
})
export default class MultiConstraintFailTool extends ToolContext {
  async execute(input: { msg: string }) {
    return `should not run: ${input.msg}`;
  }
}
