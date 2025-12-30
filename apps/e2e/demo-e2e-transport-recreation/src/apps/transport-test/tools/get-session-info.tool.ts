import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = z.object({}).strict();

const outputSchema = z.object({
  sessionId: z.string(),
  hasSession: z.boolean(),
  requestCount: z.number(),
});

// In-memory request counters per session (simulates session state)
const sessionRequestCounts = new Map<string, number>();

@Tool({
  name: 'get-session-info',
  description: 'Get current session information and request count',
  inputSchema,
  outputSchema,
})
export default class GetSessionInfoTool extends ToolContext {
  async execute(_input: z.input<typeof inputSchema>): Promise<z.infer<typeof outputSchema>> {
    const authInfo = this.getAuthInfo();
    const sessionId = authInfo.sessionId ?? 'no-session';
    const hasSession = !!authInfo.sessionId;

    // Get current count and increment
    const currentCount = sessionRequestCounts.get(sessionId) ?? 0;
    const newCount = currentCount + 1;
    sessionRequestCounts.set(sessionId, newCount);

    return {
      sessionId,
      hasSession,
      requestCount: newCount,
    };
  }
}
