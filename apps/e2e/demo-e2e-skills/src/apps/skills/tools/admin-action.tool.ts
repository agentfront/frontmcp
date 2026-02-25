import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {
  action: z.string().describe('The admin action to perform'),
};

const outputSchema = {
  result: z.string(),
  success: z.boolean(),
};

type Input = z.input<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<z.ZodObject<typeof outputSchema>>;

/**
 * Admin action tool that is NOT included in any skill's allowlist.
 * Used to test tool authorization - should be blocked when a skill is active in strict mode.
 */
@Tool({
  name: 'admin_action',
  description: 'Admin action not allowed by any skill - used for authorization testing',
  inputSchema,
  outputSchema,
  tags: ['admin', 'test'],
})
export class AdminActionTool extends ToolContext<typeof inputSchema, typeof outputSchema, Input, Output> {
  async execute(input: Input): Promise<Output> {
    // Mock implementation for testing
    return {
      result: `Admin action "${input.action}" executed successfully`,
      success: true,
    };
  }
}
