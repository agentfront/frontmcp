import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import '@frontmcp/plugin-remember'; // Import for this.remember types

const inputSchema = {
  key: z.string().describe('Key to check'),
  scope: z.enum(['session', 'user', 'tool', 'global']).optional().default('session').describe('Scope to check in'),
};

const outputSchema = z.object({
  key: z.string(),
  scope: z.string(),
  exists: z.boolean(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'check-memory',
  description: 'Check if a memory exists',
  inputSchema,
  outputSchema,
})
export default class CheckMemoryTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    const exists = await this.remember.knows(input.key, {
      scope: input.scope,
    });

    return {
      key: input.key,
      scope: input.scope,
      exists,
    };
  }
}
