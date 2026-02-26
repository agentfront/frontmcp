import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {
  message: z.string().describe('Message to process'),
  delay: z.number().int().min(0).default(0).describe('Optional delay in ms to simulate work'),
};

const outputSchema = z
  .object({
    processed: z.boolean(),
    message: z.string(),
    processedAt: z.string(),
  })
  .strict();

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'audited-tool',
  description: 'A tool that is audited by the audit plugin hooks',
  inputSchema,
  outputSchema,
})
export default class AuditedTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    // Simulate work
    if (input.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, input.delay));
    }

    return {
      processed: true,
      message: `Processed: ${input.message}`,
      processedAt: new Date().toISOString(),
    };
  }
}
