import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = z
  .object({
    prompt: z.string().describe('Prompt to show user'),
  })
  .strict();

const outputSchema = z.object({
  message: z.string(),
  userInput: z.string().optional(),
  received: z.boolean(),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'get-user-input',
  description: 'Demonstrates text input elicitation. Asks user to provide text input.',
  inputSchema,
  outputSchema,
})
export default class GetUserInputTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: Input): Promise<Output> {
    const result = await this.elicit(
      input.prompt,
      z.object({
        userInput: z.string().describe('Your response'),
      }),
    );

    if (result.status === 'accept' && result.content?.userInput) {
      return {
        message: `User provided: ${result.content.userInput}`,
        userInput: result.content.userInput,
        received: true,
      };
    }

    return {
      message: 'User declined to provide input',
      received: false,
    };
  }
}
