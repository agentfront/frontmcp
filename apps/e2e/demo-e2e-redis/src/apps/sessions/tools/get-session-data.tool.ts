import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import { resolveDemoSessionId } from '../../resolve-session-id';
import { getSessionStore } from '../data/session.store';

const inputSchema = {
  key: z.string().describe('Key to retrieve'),
};

const outputSchema = z.object({
  found: z.boolean(),
  key: z.string(),
  value: z.string().nullable(),
});

@Tool({
  name: 'get-session-data',
  description: 'Retrieve data from the session',
  inputSchema,
  outputSchema,
})
export default class GetSessionDataTool extends ToolContext {
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    // Prefer FrontMcpContext.sessionId (always available in public mode) over authInfo.sessionId
    const ctx = this.tryGetContext();
    const sessionId = resolveDemoSessionId(ctx?.sessionId, this.getAuthInfo().sessionId);
    const store = getSessionStore(sessionId);

    const value = store.get(input.key);

    return {
      found: value !== null,
      key: input.key,
      value,
    };
  }
}
