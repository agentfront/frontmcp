import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {};

const outputSchema = z.object({
  count: z.number(),
  keys: z.array(z.string()),
  sample: z.record(z.string(), z.string()),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'get-all-config',
  description: 'Get all environment variables (returns count, keys, and a sample)',
  inputSchema,
  outputSchema,
})
export default class GetAllConfigTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(_input: Input): Promise<Output> {
    const all = this.config.getAll();
    const keys = Object.keys(all);

    // Return only our test variables to avoid exposing system env
    const testKeys = ['DATABASE_URL', 'API_KEY', 'PORT', 'DEBUG', 'APP_NAME', 'LOCAL_ONLY_VAR'];
    const sample: Record<string, string> = {};
    for (const key of testKeys) {
      if (all[key]) {
        sample[key] = all[key];
      }
    }

    return {
      count: keys.length,
      keys: testKeys.filter((k) => keys.includes(k)),
      sample,
    };
  }
}
