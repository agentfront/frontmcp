import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {
  a: z.number().describe('First number to add'),
  b: z.number().describe('Second number to add'),
};

const outputSchema = z.object({
  result: z.number(),
  operation: z.string(),
});

type AddInput = z.infer<z.ZodObject<typeof inputSchema>>;
type AddOutput = z.infer<typeof outputSchema>;

@Tool({
  name: 'add',
  description: 'Adds two numbers together - useful for input validation testing',
  inputSchema,
  outputSchema,
})
export default class AddTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: AddInput): Promise<AddOutput> {
    return {
      result: input.a + input.b,
      operation: `${input.a} + ${input.b} = ${input.a + input.b}`,
    };
  }
}
