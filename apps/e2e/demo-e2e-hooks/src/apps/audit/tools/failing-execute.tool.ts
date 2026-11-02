import { z } from '@frontmcp/lazy-zod';
import { PublicMcpError, Tool, ToolContext } from '@frontmcp/sdk';

const outputSchema = z.object({ posted: z.boolean() });

type Output = z.infer<typeof outputSchema>;

@Tool({
  name: 'failing-execute',
  description: 'Fails while it runs',
  inputSchema: {},
  outputSchema,
})
export default class FailingExecuteTool extends ToolContext {
  async execute(): Promise<Output> {
    throw new PublicMcpError('The ledger is unreachable');
  }
}
