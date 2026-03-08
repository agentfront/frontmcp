import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {};

const outputSchema = z.object({
  status: z.string(),
  flagKey: z.string(),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'default-true',
  description: 'Tool with object-style featureFlag ref and defaultValue: true for a non-existent flag',
  inputSchema,
  outputSchema,
  featureFlag: { key: 'nonexistent-flag', defaultValue: true },
})
export default class DefaultTrueTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(_input: Input): Promise<Output> {
    return {
      status: 'accessible via defaultValue',
      flagKey: 'nonexistent-flag',
    };
  }
}
