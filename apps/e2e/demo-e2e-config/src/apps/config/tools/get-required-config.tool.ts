import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {
  key: z.string().describe('Environment variable key to retrieve (must exist)'),
};

const outputSchema = z.object({
  key: z.string(),
  value: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
});

type Input = z.input<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'get-required-config',
  description: 'Get a required environment variable (throws if not found)',
  inputSchema,
  outputSchema,
})
export default class GetRequiredConfigTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    try {
      const value = this.config.getRequired(input.key);
      return {
        key: input.key,
        value,
        success: true,
      };
    } catch (err) {
      return {
        key: input.key,
        value: '',
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
