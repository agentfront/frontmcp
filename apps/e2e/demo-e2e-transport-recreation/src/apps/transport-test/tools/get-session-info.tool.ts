import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = {};

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
  async execute(_input: Record<string, never>): Promise<z.infer<typeof outputSchema>> {
    // Prefer FrontMcpContext.sessionId (set when context exists) over authInfo.sessionId
    // (may be undefined in public mode). Matches increment-counter pattern.
    const ctx = this.tryGetContext();
    const authInfo = this.getAuthInfo();
    const sessionId = ctx?.sessionId ?? authInfo.sessionId ?? 'no-session';
    const hasSession = !!sessionId && sessionId !== 'no-session';

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
