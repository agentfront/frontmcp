import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {
  query: z.string().describe('Search query'),
};

const outputSchema = z.object({
  results: z.array(z.string()),
  flagKey: z.string(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'beta-search',
  description: 'Beta search tool gated behind beta-search flag (enabled)',
  inputSchema,
  outputSchema,
  featureFlag: 'beta-search',
})
export default class BetaSearchTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    return {
      results: [`Result for: ${input.query}`],
      flagKey: 'beta-search',
    };
  }
}
