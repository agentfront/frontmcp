import { z } from 'zod';
import { Tool, ToolContext, readDomById, readDomBySelector } from '@frontmcp/react';

const readDomInput = z.object({
  mode: z.enum(['id', 'selector']).describe('Lookup mode: "id" for getElementById, "selector" for querySelectorAll'),
  target: z.string().describe('Element ID or CSS selector'),
});

@Tool({
  name: 'read_dom',
  description: 'Read DOM elements by ID or CSS selector',
  inputSchema: readDomInput,
})
export class ReadDomTool extends ToolContext<typeof readDomInput> {
  async execute(input: z.infer<typeof readDomInput>) {
    const result = input.mode === 'id' ? readDomById(input.target) : readDomBySelector(input.target);
    const content = result.contents[0];
    return content?.text ?? 'No content';
  }
}
