import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const inputSchema = {
  text: z.string().describe('The document to measure'),
};

const outputSchema = z.object({ length: z.number(), onlyD: z.boolean() });

@Tool({
  name: 'docs-measure',
  description: "Measure a document: its length, and whether it is all the letter d, as docs-read's are",
  inputSchema,
  outputSchema,
})
export default class DocsMeasureTool extends ToolContext {
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    return { length: input.text.length, onlyD: /^d+$/.test(input.text) };
  }
}
