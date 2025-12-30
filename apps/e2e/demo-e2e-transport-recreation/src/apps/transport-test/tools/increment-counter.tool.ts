import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';

const inputSchema = z
  .object({
    amount: z.number().int().min(1).default(1).describe('Amount to increment by'),
  })
  .strict();

const outputSchema = z.object({
  sessionId: z.string(),
  previousValue: z.number(),
  newValue: z.number(),
  incrementedBy: z.number(),
});

// In-memory counters per session (simulates persistent session state)
const sessionCounters = new Map<string, number>();

@Tool({
  name: 'increment-counter',
  description: 'Increment a session-scoped counter to verify state continuity',
  inputSchema,
  outputSchema,
})
export default class IncrementCounterTool extends ToolContext<typeof inputSchema, typeof outputSchema> {
  async execute(input: z.infer<typeof inputSchema>): Promise<z.infer<typeof outputSchema>> {
    const sessionId = this.authInfo.sessionId ?? 'no-session';
    const amount = input.amount ?? 1;

    // Get current value
    const previousValue = sessionCounters.get(sessionId) ?? 0;
    const newValue = previousValue + amount;

    // Update counter
    sessionCounters.set(sessionId, newValue);

    return {
      sessionId,
      previousValue,
      newValue,
      incrementedBy: amount,
    };
  }
}
