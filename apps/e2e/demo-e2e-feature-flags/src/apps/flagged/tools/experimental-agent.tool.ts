import { z } from 'zod';

import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  task: z.string().describe('Task to perform'),
};

const outputSchema = z.object({
  result: z.string(),
  flagKey: z.string(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'experimental-agent',
  description: 'Experimental tool gated behind experimental-agent flag (disabled)',
  inputSchema,
  outputSchema,
  featureFlag: 'experimental-agent',
})
export default class ExperimentalAgentTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    return {
      result: `Executed: ${input.task}`,
      flagKey: 'experimental-agent',
    };
  }
}
