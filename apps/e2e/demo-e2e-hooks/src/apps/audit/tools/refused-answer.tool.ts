import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const outputSchema = z.object({ total: z.number() });

type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'refused-answer',
  description: 'Answers with a total its own output schema refuses',
  inputSchema: {},
  outputSchema,
})
export default class RefusedAnswerTool extends ToolContext {
  async execute(): Promise<Output> {
    return { total: 'twelve' } as unknown as Output;
  }
}
