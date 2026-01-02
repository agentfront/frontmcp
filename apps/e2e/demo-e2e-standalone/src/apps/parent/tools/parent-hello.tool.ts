import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = z.object({
  name: z.string().default('World'),
});

const outputSchema = z.object({
  message: z.string(),
  scope: z.literal('parent'),
});

type Input = z.output<typeof inputSchema>;
type Output = z.output<typeof outputSchema>;

@Tool({
  name: 'parent-hello',
  description: 'A simple hello tool in the parent/root scope',
  inputSchema,
  outputSchema,
})
export default class ParentHelloTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    const { name } = input;
    return {
      message: `Hello, ${name}! This is from the parent/root scope.`,
      scope: 'parent',
    };
  }
}
