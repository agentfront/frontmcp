import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const outputSchema = z.object({
  workspaces: z.array(z.string()),
});

type Output = z.output<typeof outputSchema>;

/**
 * Drives the roots arm of MRTR — `roots/list` is likewise only reachable
 * through an `InputRequiredResult` under 2026-07-28.
 */
@Tool({
  name: 'list-workspaces',
  description: 'Lists the workspace roots the client exposes',
  inputSchema: {},
  outputSchema,
})
export default class ListWorkspacesTool extends ToolContext {
  async execute(): Promise<Output> {
    const roots = await this.listRoots();
    return { workspaces: roots.map((root) => root.uri) };
  }
}
