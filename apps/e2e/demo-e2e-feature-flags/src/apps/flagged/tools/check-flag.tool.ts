import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {
  flagKey: z.string().describe('Feature flag key to check programmatically'),
};

const outputSchema = z.object({
  flagKey: z.string(),
  isEnabled: z.boolean(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'check-flag',
  description: 'Programmatically check a feature flag via this.featureFlags',
  inputSchema,
  outputSchema,
})
export default class CheckFlagTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    const isEnabled = await this.featureFlags.isEnabled(input.flagKey);
    return {
      flagKey: input.flagKey,
      isEnabled,
    };
  }
}
