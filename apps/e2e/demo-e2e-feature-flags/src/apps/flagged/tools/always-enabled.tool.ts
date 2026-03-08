import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {
  message: z.string().describe('Message to echo'),
};

const outputSchema = z.object({
  message: z.string(),
  flagKey: z.string(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'always-enabled',
  description: 'Tool gated behind an always-enabled feature flag',
  inputSchema,
  outputSchema,
  featureFlag: 'always-on',
})
export default class AlwaysEnabledTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    return {
      message: `[always-enabled] ${input.message}`,
      flagKey: 'always-on',
    };
  }
}
