import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { getSessionStore } from '../../sessions/data/session.store';

const inputSchema = {
  key: z.string().optional().describe('Specific state key to check'),
};

const outputSchema = z
  .object({
    success: z.boolean(),
    sessionId: z.string().nullable(),
    stateFound: z.boolean(),
    stateValue: z.string().nullable(),
    allStateKeys: z.array(z.string()),
    message: z.string(),
  })
  .strict();

@Tool({
  name: 'check-session',
  description: 'Check current session and retrieve state',
  inputSchema,
  outputSchema,
})
export default class CheckSessionTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    const sessionId = this.getAuthInfo().sessionId ?? 'mock-session-default';
    const store = getSessionStore(sessionId);

    // Get all state keys
    const allKeys = store.keys('__transport_state__:*');
    const stateKeys = allKeys.map((k) => k.replace('__transport_state__:', ''));

    // Get specific state if requested
    let stateFound = false;
    let stateValue: string | null = null;
    if (input.key) {
      const value = store.get(`__transport_state__:${input.key}`);
      stateFound = value !== null;
      stateValue = value;
    }

    return {
      success: true,
      sessionId,
      stateFound,
      stateValue,
      allStateKeys: stateKeys,
      message: `Session ${sessionId} has ${stateKeys.length} state entries`,
    };
  }
}
