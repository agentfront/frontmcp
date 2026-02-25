import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
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
export default class GetSessionDataTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: z.input<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    // Use shared context session ID so data can be retrieved across tool calls
    const sessionId = this.getAuthInfo().sessionId ?? 'mock-session-default';
    const store = getSessionStore(sessionId);

    const value = store.get(input.key);

    return {
      found: value !== null,
      key: input.key,
      value,
    };
  }
}
