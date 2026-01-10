import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = z
  .object({
    key: z.string().describe('Environment variable key to retrieve'),
    defaultValue: z.string().optional().describe('Default value if key is not found'),
  })
  .strict();

const outputSchema = z.object({
  key: z.string(),
  value: z.string().nullable(),
  found: z.boolean(),
  defaultUsed: z.boolean(),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'get-config',
  description: 'Get an environment variable value with optional default',
  inputSchema,
  outputSchema,
})
export default class GetConfigTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    const value = this.config.get(input.key, input.defaultValue);
    const found = this.config.has(input.key);

    return {
      key: input.key,
      value: value ?? null,
      found,
      defaultUsed: !found && input.defaultValue !== undefined,
    };
  }
}
