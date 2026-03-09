import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { getSessionStore } from '../../sessions/data/session.store';

const inputSchema = {
  action: z.enum(['set', 'get']).describe('Action to perform'),
  marker: z.string().describe('Unique marker value for isolation test'),
};

const outputSchema = z
  .object({
    success: z.boolean(),
    sessionId: z.string().nullable(),
    action: z.string(),
    marker: z.string(),
    retrievedMarker: z.string().nullable(),
    isIsolated: z.boolean().optional(),
    message: z.string(),
  })
  .strict();

@Tool({
  name: 'session-isolation',
  description: 'Test session isolation between different clients',
  inputSchema,
  outputSchema,
})
export default class SessionIsolationTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>): Promise<z.infer<typeof outputSchema>> {
    const sessionId = this.getAuthInfo().sessionId ?? 'mock-session-default';
    const store = getSessionStore(sessionId);

    if (input.action === 'set') {
      store.set('__isolation_marker__', input.marker);
      return {
        success: true,
        sessionId,
        action: 'set',
        marker: input.marker,
        retrievedMarker: null,
        message: `Set isolation marker "${input.marker}" for session ${sessionId}`,
      };
    } else {
      const retrievedMarker = store.get('__isolation_marker__');
      const isIsolated = retrievedMarker !== input.marker;

      return {
        success: true,
        sessionId,
        action: 'get',
        marker: input.marker,
        retrievedMarker,
        isIsolated,
        message: retrievedMarker
          ? `Retrieved marker "${retrievedMarker}" (expected "${input.marker}")`
          : 'No marker found - session is isolated',
      };
    }
  }
}
