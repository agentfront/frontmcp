import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { finallyLog } from '../data/finally-log';

const inputSchema = {
  toolName: z.string().describe('The tool whose calls to list'),
};

const outputSchema = z.object({
  entries: z.array(z.object({ stage: z.string(), outcome: z.string() })),
});

type Input = z.infer<z.ZodObject<typeof inputSchema>>;
type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'get-finally-log',
  description: 'How the execute and finalize stages of the calls of one tool ended, as its Finally hooks saw them',
  inputSchema,
  outputSchema,
})
export default class GetFinallyLogTool extends ToolContext {
  async execute(input: Input): Promise<Output> {
    const entries = finallyLog.entriesFor(input.toolName).map(({ stage, outcome }) => ({ stage, outcome }));
    return { entries };
  }
}
