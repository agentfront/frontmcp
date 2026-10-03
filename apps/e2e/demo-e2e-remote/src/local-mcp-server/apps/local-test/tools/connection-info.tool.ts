import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

const outputSchema = z.object({
  /** Whether the caller reached this tool through an MCP session (`initialize` era). */
  session: z.boolean(),
});

/**
 * Reports how the caller is connected. MCP 2026-07-28 requests carry no session,
 * so a gateway proxying with that revision sees `session: false`.
 */
@Tool({
  name: 'connection-info',
  description: 'Reports whether the request arrived through an MCP session',
  inputSchema: {},
  outputSchema,
})
export default class ConnectionInfoTool extends ToolContext {
  async execute(): Promise<z.infer<typeof outputSchema>> {
    return { session: this.context.verifiedSessionId !== undefined };
  }
}
