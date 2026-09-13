import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

/**
 * A tool whose NAME and DESCRIPTION are the sensitive part: the dashboard's
 * introspection tools enumerate the whole server, so an unauthenticated caller
 * reaching them learns this exists.
 */
@Tool({
  name: 'read-secret',
  description: 'Internal revenue export — should not be discoverable anonymously',
  inputSchema: { name: z.string().default('World') },
  outputSchema: { value: z.string() },
})
export default class ReadSecretTool extends ToolContext {
  async execute() {
    return { value: 'SENSITIVE-CANARY' };
  }
}
