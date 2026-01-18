import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = z
  .object({
    action: z.string().describe('Action to confirm'),
  })
  .strict();

const outputSchema = z.object({
  message: z.string(),
  confirmed: z.boolean(),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'confirm-action',
  description: 'Demonstrates simple confirmation elicitation. Asks user to confirm an action before proceeding.',
  inputSchema,
  outputSchema,
})
export default class ConfirmActionTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    const result = await this.elicit(
      `Do you want to proceed with: ${input.action}?`,
      z.object({
        confirmed: z.boolean().describe('Confirm action'),
      }),
    );

    if (result.status === 'accept' && result.content?.confirmed) {
      return {
        message: `Action "${input.action}" confirmed and executed`,
        confirmed: true,
      };
    }

    return {
      message: `Action "${input.action}" was cancelled`,
      confirmed: false,
    };
  }
}
