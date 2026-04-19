import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  key: z.string().describe('Environment variable key to check'),
};

const outputSchema = z
  .object({
    key: z.string(),
    exists: z.boolean(),
    isNumber: z.boolean(),
    numberValue: z.number().nullable(),
    booleanValue: z.boolean().nullable(),
  })
  .strict();

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'check-config',
  description: 'Check if a config key exists and get typed values',
  inputSchema,
  outputSchema,
})
export default class CheckConfigTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    const exists = this.config.has(input.key);
    const numberValue = this.config.getNumber(input.key);
    const booleanValue = this.config.getBoolean(input.key);

    return {
      key: input.key,
      exists,
      isNumber: !isNaN(numberValue),
      numberValue: isNaN(numberValue) ? null : numberValue,
      booleanValue: exists ? booleanValue : null,
    };
  }
}
